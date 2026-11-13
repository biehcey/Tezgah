import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BLOCKED_TICK_MS } from '../core/bekletme';
import type { ServerEvent } from '../core/script-calistirma';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock, type FakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer, type TestSocket } from './test/sunucu';
import { addFakeConnection, eventually, settle } from './test/yardimcilar';

let t: TestServer;
let clock: FakeClock;

beforeEach(async () => {
  clock = createFakeClock();
  t = await startTestServer({ clock });
});
afterEach(async () => {
  await t.close();
});

const tab = () => t.socket();

const blockedEvents = (ws: TestSocket) => ws.events.filter((e): e is Extract<ServerEvent, { type: 'bekletilenler' }> => e.type === 'bekletilenler');

describe('Bekletme izleyicisi: sahte Postgres', () => {
  let fake: FakePostgres;
  /** İzleyicinin her tikte göreceği satırlar. */
  let blocked: (string | null)[][];
  const watchQueries = () => fake.queries.filter((q) => q.includes('pg_blocking_pids'));

  beforeEach(async () => {
    fake = await startFakePostgres({ password: 'gizli' });
    blocked = [];
    fake.extendedResultFor = (sql) =>
      sql.includes('pg_blocking_pids')
        ? {
            columns: ['pid', 'usename', 'application_name', 'wait_event_type', 'sorgu', 'sure_sn'],
            rows: blocked,
            command: `SELECT ${blocked.length}`,
          }
        : undefined;
  });
  afterEach(async () => {
    await fake.close();
  });

  const createConnection = () => addFakeConnection(t, fake.port);

  async function open(script: string, phase: 'kararBekleniyor' | 'okumaAcik'): Promise<TestSocket> {
    const ws = await tab();
    ws.send({ type: 'run', target: { connectionId: await createConnection(), database: 'postgres' }, script });
    await ws.waitFor(phase);
    return ws;
  }

  /** Bir tik: sahte saat ilerler, izleme sorgusu yanıtlanır. */
  async function tick() {
    const before = watchQueries().length;
    clock.advance(BLOCKED_TICK_MS);
    await eventually(() => watchQueries().length > before);
    await settle();
  }

  it('karar beklerken 5 sn’de bir çalıştırmanın pid’iyle sorar; sonuç değişince olay gönderir', async () => {
    const ws = await open('UPDATE t SET a = 1', 'kararBekleniyor');
    clock.advance(BLOCKED_TICK_MS - 1);
    await settle();
    expect(watchQueries()).toEqual([]);

    blocked = [['77', 'ali', 'psql', 'Lock', 'UPDATE t SET a = 2', '4']];
    clock.advance(1);
    await ws.waitFor('bekletilenler');
    // Sahte Postgres'in BackendKeyData pid'i 1.
    expect(fake.parameters.at(-1)).toEqual(['1']);
    expect(blockedEvents(ws).map((e) => e.oturumlar)).toEqual([
      [{ pid: 77, kullanici: 'ali', uygulama: 'psql', beklemeTuru: 'Lock', sorgu: 'UPDATE t SET a = 2', sureSn: 4 }],
    ]);

    // Aynı sonuç yeniden gönderilmez.
    await tick();
    expect(blockedEvents(ws)).toHaveLength(1);

    blocked = [['77', 'ali', 'psql', 'Lock', 'UPDATE t SET a = 2', '9']];
    await tick();
    expect(blockedEvents(ws).map((e) => e.oturumlar[0]!.sureSn)).toEqual([4, 9]);
  });

  it('transaction kapanınca boş liste gider (bitti’den önce) ve izleme durur', async () => {
    const ws = await open('UPDATE t SET a = 1', 'kararBekleniyor');
    blocked = [['77', null, null, null, '<insufficient privilege>', null]];
    await tick();
    expect(blockedEvents(ws).at(-1)!.oturumlar).toEqual([
      { pid: 77, kullanici: null, uygulama: null, beklemeTuru: null, sorgu: null, sureSn: null },
    ]);

    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
    const types = ws.events.map((e) => e.type);
    expect(types.slice(-2)).toEqual(['bekletilenler', 'bitti']);
    expect(blockedEvents(ws).at(-1)!.oturumlar).toEqual([]);

    const asked = watchQueries().length;
    clock.advance(5 * BLOCKED_TICK_MS);
    await settle();
    expect(watchQueries()).toHaveLength(asked);
  });

  it('kimse beklemiyorsa olay gitmez; kapanışta da boş liste gönderilmez', async () => {
    const ws = await open('UPDATE t SET a = 1', 'kararBekleniyor');
    await tick();
    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
    expect(blockedEvents(ws)).toEqual([]);
  });

  it('Okuma transaction’ı açıkken de izler; Karar süresi dolunca boş liste', async () => {
    const ws = await open('SELECT 1', 'okumaAcik');
    blocked = [['5', 'veli', 'app', 'Lock', 'ALTER TABLE t ADD c int', '1']];
    await tick();
    expect(blockedEvents(ws)).toHaveLength(1);

    clock.advance(30 * 60_000);
    await ws.waitFor('bitti');
    expect(blockedEvents(ws).at(-1)!.oturumlar).toEqual([]);
  });

  it('script çalışırken ve Deneme modunda izlenmez', async () => {
    fake.hangOn = (sql) => sql === 'UPDATE t SET a = 1';
    const running = await tab();
    running.send({ type: 'run', target: { connectionId: await createConnection(), database: 'postgres' }, script: 'UPDATE t SET a = 1' });
    await running.waitFor('started');
    clock.advance(BLOCKED_TICK_MS);
    await settle();
    expect(watchQueries()).toEqual([]);

    // Deneme karar beklemeden geri alınır; izlenecek açık transaction kalmaz.
    fake.hangOn = () => false;
    const deneme = await tab();
    deneme.send({ type: 'run', target: { connectionId: await createConnection(), database: 'postgres' }, script: 'UPDATE t SET a = 1', deneme: true });
    expect(await deneme.waitFor('bitti')).toMatchObject({ sonuc: 'deneme' });
    clock.advance(BLOCKED_TICK_MS);
    await settle();
    expect(watchQueries()).toEqual([]);
  });

  it('havuz doluysa tik atlanır (kuyrukta beklenmez)', async () => {
    const id = await createConnection();
    for (let i = 0; i < 5; i++) {
      const ws = await tab();
      ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'UPDATE t SET a = 1' });
      await ws.waitFor('kararBekleniyor');
    }
    // Kısa süreli sorgulara ayrılan son yer askıda bir veritabanı listesiyle dolu.
    fake.hangOn = (sql) => sql.includes('pg_database');
    // Yanıt hiç gelmez; test bitince sahte sunucu kapanırken istek düşer.
    const hanging = t.api('GET', `/api/baglantilar/${id}/veritabanlari`).catch(() => {});
    await eventually(() => fake.queries.some((q) => q.includes('pg_database')));

    clock.advance(BLOCKED_TICK_MS);
    await settle(200);
    expect(watchQueries()).toEqual([]);
    fake.dropSessions();
    await hanging;
  });
});

describePg('Bekletme izleyicisi: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const TABLE = 'tezgah_test_bekletme';
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.query(`CREATE TABLE ${TABLE} (a int)`);
    await admin.query(`INSERT INTO ${TABLE} VALUES (1)`);
  });
  afterAll(async () => {
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.end();
  });

  it('kilitte bekleyen ikinci client olay olarak gelir; rollback’te boş liste', async () => {
    const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', ...real });
    const ws = await tab();
    ws.send({ type: 'run', target: { connectionId: res.body.connection.id, database: real.database }, script: `UPDATE ${TABLE} SET a = 2` });
    await ws.waitFor('kararBekleniyor');

    const waiter = new pg.Client({ ...real, application_name: 'bekleyen-test' });
    await waiter.connect();
    const { rows } = await waiter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const waiting = waiter.query(`UPDATE ${TABLE} SET a = 3`);
    // İkinci client kilitte beklemeye başlayana kadar.
    await eventually(async () => (await admin.query(`SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`, [rows[0]!.pid])).rowCount === 1);

    clock.advance(BLOCKED_TICK_MS);
    const event = await ws.waitFor('bekletilenler');
    expect(event.oturumlar).toEqual([
      {
        pid: rows[0]!.pid,
        kullanici: real.user,
        uygulama: 'bekleyen-test',
        beklemeTuru: 'Lock',
        sorgu: `UPDATE ${TABLE} SET a = 3`,
        sureSn: expect.any(Number),
      },
    ]);

    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
    expect(blockedEvents(ws).at(-1)!.oturumlar).toEqual([]);
    await waiting;
    await waiter.end();
  });
});
