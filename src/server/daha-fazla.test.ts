import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROW_LIMIT } from '../core/grid/sabitler';
import type { ServerEvent } from '../core/script-calistirma';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';
import { startTestServer, type TestServer, type TestSocket } from './test/sunucu';

let t: TestServer;
let ws: TestSocket;
let fake: FakePostgres;

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  t = await startTestServer({ clock: createFakeClock() });
  ws = await t.socket();
});
afterEach(async () => {
  ws.close();
  await t.close();
  await fake.close();
});

/**
 * Sahte Postgres'te `generate_series(1, n)` gibi davranan imleçler: `DECLARE x … FOR SELECT …` her
 * imleci baştan başlatır, `FETCH k FROM x` sıradaki en fazla `k` satırı döner.
 */
function fakeCursors(total: number) {
  const positions = new Map<string, number>();
  fake.resultFor = (sql) => {
    const declare = /^DECLARE (\w+) /.exec(sql);
    if (declare) {
      positions.set(declare[1]!, 0);
      return { columns: [], rows: [], command: 'DECLARE CURSOR' };
    }
    const fetch = /^FETCH (\d+) FROM (\w+)$/.exec(sql);
    if (!fetch) return undefined;
    const at = positions.get(fetch[2]!) ?? total;
    const n = Math.min(Number(fetch[1]), total - at);
    positions.set(fetch[2]!, at + n);
    return { columns: ['g'], rows: Array.from({ length: n }, (_, k) => [String(at + k + 1)]), command: `FETCH ${n}` };
  };
}

async function connect(): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', host: '127.0.0.1', port: fake.port, user: 'postgres', password: 'gizli', sslmode: 'disable' });
  return res.body.connection.id;
}

const run = async (script: string) => ws.send({ type: 'run', target: { connectionId: await connect(), database: 'postgres' }, script });

/** `dahaFazla` gönderir; yanıtı (`satirlar` ya da `uyari`) bekler. */
async function more(i = 0): Promise<ServerEvent> {
  const from = ws.events.length;
  ws.send({ type: 'dahaFazla', i });
  for (let k = 0; k < 400; k++) {
    const found = ws.events.slice(from).find((e) => e.type === 'satirlar' || (e.type === 'uyari' && e.tur === 'dahaFazla'));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('dahaFazla yanıtlanmadı');
}

const numbers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => [String(from + k)]);

describe('daha fazla satır: sahte Postgres', () => {
  it('ilk sayfa 500 satır, satır sayısı bilinmez; Okuma açıkken 500’er satır daha, sonda sayı belli', async () => {
    fakeCursors(1200);
    await run('SELECT g FROM generate_series(1, 1200) g');
    const done = await ws.waitFor('done');
    expect(done).toMatchObject({ rowCount: null, onizleme: { satirlar: numbers(1, 500), dahaVar: true } });
    await ws.waitFor('okumaAcik');
    expect(fake.queries.some((q) => q.startsWith('MOVE'))).toBe(false);

    expect(await more()).toEqual({ type: 'satirlar', i: 0, satirlar: numbers(501, 1000), dahaVar: true });
    expect(await more()).toEqual({ type: 'satirlar', i: 0, satirlar: numbers(1001, 1200), dahaVar: false });
    expect(await more()).toMatchObject({ type: 'uyari', tur: 'dahaFazla', i: 0 });
  });

  it('sonucu ilk sayfaya sığan SELECT’in satır sayısı bilinir ve devamı yok', async () => {
    fakeCursors(500);
    await run('SELECT g FROM generate_series(1, 500) g');
    expect(await ws.waitFor('done')).toMatchObject({ rowCount: 500, onizleme: { dahaVar: false } });
  });

  it('her SELECT kendi imlecinde: ikinci sonucun sayfası birincininkini bozmaz', async () => {
    fakeCursors(700);
    await run('SELECT 1;\nSELECT 2');
    await ws.waitFor('okumaAcik');
    expect(await more(1)).toMatchObject({ i: 1, satirlar: numbers(501, 700) });
    expect(await more(0)).toMatchObject({ i: 0, satirlar: numbers(501, 700) });
  });

  it('karar beklenirken çekilebilir; commit sonrasında reddedilir', async () => {
    fakeCursors(800);
    await run('INSERT INTO t VALUES (1);\nSELECT g FROM t');
    await ws.waitFor('kararBekleniyor');
    expect(await more(1)).toMatchObject({ type: 'satirlar', i: 1, dahaVar: false });
    ws.send({ type: 'commit' });
    await ws.waitFor('bitti');
    expect(await more(1)).toEqual({ type: 'uyari', tur: 'dahaFazla', i: 1, mesaj: 'Transaction kapandı; daha fazla satır çekilemez' });
  });

  it('script çalışırken istenemez', async () => {
    fakeCursors(800);
    fake.hangOn = (sql) => sql.includes('pg_sleep');
    await run('SELECT 1;\nSELECT pg_sleep(10)');
    await ws.waitFor('started', (e) => e.i === 1);
    expect(await more(0)).toMatchObject({ type: 'uyari', tur: 'dahaFazla', i: 0 });
    fake.dropSessions();
  });

  it('hata alan transaction’da istenemez', async () => {
    fakeCursors(800);
    fake.failOn = (sql) => (sql.includes('yok') ? { code: '42P01', message: 'relation "yok" does not exist' } : undefined);
    await run('SELECT 1;\nINSERT INTO yok VALUES (1)');
    await ws.waitFor('kararBekleniyor');
    expect(await more(0)).toMatchObject({ type: 'uyari', tur: 'dahaFazla', i: 0, mesaj: "Transaction hata aldı; daha fazla satır çekilemez" });
  });

  it('çekerken hata veren satır transaction’ı bozmaz: savepoint’e geri sarılır, commit edilebilir; o sonuç kapanır', async () => {
    fakeCursors(800);
    await run('INSERT INTO t VALUES (1);\nSELECT 1/(g-600) FROM t');
    await ws.waitFor('kararBekleniyor');
    fake.failOn = (sql) => (sql.startsWith('FETCH') ? { code: '22012', message: 'division by zero' } : undefined);
    expect(await more(1)).toMatchObject({ type: 'uyari', tur: 'dahaFazla', i: 1, mesaj: 'Satırlar çekilemedi: division by zero' });
    expect(fake.queries.slice(-2)).toEqual(['ROLLBACK TO SAVEPOINT tezgah_sayfa', 'RELEASE SAVEPOINT tezgah_sayfa']);
    expect(await more(1)).toMatchObject({ type: 'uyari', tur: 'dahaFazla', mesaj: 'Bu sonucun devamı yok' });
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
  });

  it('Okuma’da çekerken hata: transaction açık kalır', async () => {
    fakeCursors(800);
    await run('SELECT 1/(g-600) FROM t');
    await ws.waitFor('okumaAcik');
    fake.failOn = (sql) => (sql.startsWith('FETCH') ? { code: '22012', message: 'division by zero' } : undefined);
    expect(await more()).toMatchObject({ type: 'uyari', tur: 'dahaFazla', i: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ws.events.some((e) => e.type === 'bitti')).toBe(false);
    expect(fake.queries).not.toContain('ROLLBACK');
  });

  it(`${ROW_LIMIT} satırda sınır: devamı olsa da çekilmez`, async () => {
    fakeCursors(ROW_LIMIT + 10);
    await run('SELECT g FROM t');
    await ws.waitFor('okumaAcik');
    let loaded = 500;
    let last: ServerEvent | undefined;
    while (loaded < ROW_LIMIT) {
      last = await more();
      if (last.type !== 'satirlar') throw new Error(`beklenmeyen ${JSON.stringify(last)}`);
      loaded += last.satirlar.length;
    }
    expect(loaded).toBe(ROW_LIMIT);
    expect(last).toMatchObject({ dahaVar: true, sinir: true });
    expect(await more()).toMatchObject({ type: 'uyari', tur: 'dahaFazla' });
  }, 30_000);

  it('tam sınır kadar satır varsa sınır yok; devamı yok', async () => {
    fakeCursors(ROW_LIMIT);
    await run('SELECT g FROM t');
    await ws.waitFor('okumaAcik');
    let last: ServerEvent | undefined;
    for (let loaded = 500; loaded < ROW_LIMIT; loaded += 500) last = await more();
    expect(last).toMatchObject({ dahaVar: false });
    expect(last).not.toHaveProperty('sinir');
  }, 30_000);
});
