import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRecords } from '../core/calistirma-kaydi';
import { READ_ONLY_AUTOCOMMIT_MESSAGE } from '../core/yazma-kilidi';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { describePg, pgUrl, startTestServer, type TestServer, type TestSocket } from './test/sunucu';

let t: TestServer;
let ws: TestSocket;
beforeEach(async () => {
  t = await startTestServer();
  ws = await t.socket();
});
afterEach(async () => {
  ws.close();
  await t.close();
});

const runOn = (connectionId: string, database: string, script: string, yazmaModu = false) =>
  ws.send({ type: 'run', target: { connectionId, database }, script, yazmaModu });

async function recordedLocks(): Promise<unknown[]> {
  const dir = join(t.configDir, 'history');
  const files = await readdir(dir).catch(() => []);
  const texts = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
  return parseRecords(texts.join('')).map((r) => r.basladi.yazmaKilidi);
}

describe('prod yazma kilidi: sahte Postgres', () => {
  let fake: FakePostgres;
  beforeEach(async () => {
    fake = await startFakePostgres({ password: 'gizli' });
  });
  afterEach(async () => {
    await fake.close();
  });

  async function createConnection(fields: Record<string, unknown> = {}): Promise<string> {
    const res = await t.api('POST', '/api/baglantilar', {
      name: 'Canlı',
      host: '127.0.0.1',
      port: fake.port,
      user: 'postgres',
      password: 'gizli',
      sslmode: 'disable',
      envTag: 'prod',
      ...fields,
    });
    expect(res.status).toBe(201);
    return res.body.connection.id;
  }
  const run = (id: string, script: string, yazmaModu = false) => runOn(id, 'postgres', script, yazmaModu);

  async function decideRollback() {
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
  }

  it('salt okunur prod’da transaction BEGIN READ ONLY ile açılır', async () => {
    run(await createConnection(), 'UPDATE t SET a = 1');
    await decideRollback();
    expect(fake.queries[0]).toBe('BEGIN READ ONLY');
    expect(await recordedLocks()).toEqual(['salt-okunur']);
  });

  it('yazma modunda transaction BEGIN READ WRITE ile açılır; kayıtta yazma-acik', async () => {
    run(await createConnection(), 'UPDATE t SET a = 1', true);
    await decideRollback();
    expect(fake.queries[0]).toBe('BEGIN READ WRITE');
    expect(await recordedLocks()).toEqual(['yazma-acik']);
  });

  it('prod olmayan hedefte yazma modu etkisiz: düz BEGIN, kilit yok', async () => {
    run(await createConnection({ envTag: 'staging' }), 'UPDATE t SET a = 1', true);
    await decideRollback();
    expect(fake.queries[0]).toBe('BEGIN');
    expect(await recordedLocks()).toEqual([null]);
  });

  it('salt okunur prod’da Autocommit script’i sunucuya hiç gitmeden reddedilir ve kaydedilmez', async () => {
    run(await createConnection(), 'VACUUM t');
    expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'autocommit' });
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'reddedildi', mesaj: READ_ONLY_AUTOCOMMIT_MESSAGE });
    expect(fake.attempts).toEqual([]);
    expect(fake.queries).toEqual([]);
    expect(await recordedLocks()).toEqual([]);
  });

  it('yazma modunda Autocommit önce salt okunurluğu kapatır; client sonra pool’a dönmez', async () => {
    const id = await createConnection();
    run(id, 'VACUUM t', true);
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'autocommit', ozet: { uygulandi: 1 } });
    expect(fake.queries).toEqual(['SET default_transaction_read_only = off', 'VACUUM t']);
    const sessions = fake.attempts.length;

    // Ayarı değişen client atıldı: sıradaki çalıştırma yeni bir oturum açar.
    ws.events.length = 0;
    run(id, 'UPDATE t SET a = 1');
    await decideRollback();
    expect(fake.attempts.length).toBe(sessions + 1);
  });
});

describePg('prod yazma kilidi: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const TABLE = 'tezgah_test_prod';
  const INDEX = 'tezgah_test_prod_ix';
  let admin: pg.Client;
  let prodId: string;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id int PRIMARY KEY)`);
  });
  afterAll(async () => {
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.end();
  });
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLE}`);
    await admin.query(`DROP INDEX IF EXISTS ${INDEX}`);
    const res = await t.api('POST', '/api/baglantilar', { name: 'Canlı', envTag: 'prod', ...real });
    prodId = res.body.connection.id;
  });

  const run = (script: string, yazmaModu = false) => runOn(prodId, real.database, script, yazmaModu);
  const ids = async () => (await admin.query<{ id: number }>(`SELECT id FROM ${TABLE} ORDER BY id`)).rows.map((r) => r.id);

  it('salt okunurken INSERT Postgres tarafından reddedilir', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1)`);
    expect(await ws.waitFor('error')).toMatchObject({ i: 0, sqlstate: '25006' });
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: false });
    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
    expect(await ids()).toEqual([]);
  });

  it('yazma modunda INSERT commit edilir', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1)`, true);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
    expect(await ids()).toEqual([1]);
  });

  it('yazma modunda Autocommit çalışır; sonra ayar pool’a sızmaz', async () => {
    run(`CREATE INDEX CONCURRENTLY ${INDEX} ON ${TABLE} (id)`, true);
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'autocommit', ozet: { uygulandi: 1, hatali: 0 } });

    // Aynı hedefin pool'undan alınan sıradaki client'lar yine salt okunur açılır.
    for (let i = 0; i < 3; i++) {
      ws.events.length = 0;
      // Yalnızca SHOW Okuma modunda çalışırdı; SET script'i Transaction moduna alır.
      run('SET LOCAL statement_timeout = 0;\nSHOW default_transaction_read_only');
      expect((await ws.waitFor('done', (e) => e.i === 1)).onizleme?.satirlar).toEqual([['on']]);
      await ws.waitFor('kararBekleniyor');
      ws.send({ type: 'rollback' });
      await ws.waitFor('bitti');
    }
    ws.events.length = 0;
    run(`INSERT INTO ${TABLE} VALUES (1)`);
    expect(await ws.waitFor('error')).toMatchObject({ sqlstate: '25006' });
  });
});
