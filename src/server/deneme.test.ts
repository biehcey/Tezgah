import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRecords } from '../core/calistirma-kaydi';
import type { ServerEvent } from '../core/script-calistirma';
import { DENEME_NON_TRANSACTIONAL_MESSAGE } from '../core/yazma-kilidi';
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

const dene = (connectionId: string, database: string, script: string) =>
  ws.send({ type: 'run', target: { connectionId, database }, script, deneme: true });

async function records() {
  const dir = join(t.configDir, 'history');
  const files = await readdir(dir).catch(() => []);
  const texts = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
  return parseRecords(texts.join(''));
}

const sequence = (events: ServerEvent[]) => events.filter((e) => e.type !== 'analiz').map((e) => ('i' in e ? `${e.type}:${e.i}` : e.type));
const done = (events: ServerEvent[]) => events.filter((e): e is Extract<ServerEvent, { type: 'done' }> => e.type === 'done');

describe('Deneme modu: sahte Postgres', () => {
  let fake: FakePostgres;
  let id: string;
  beforeEach(async () => {
    fake = await startFakePostgres({ password: 'gizli' });
    const res = await t.api('POST', '/api/baglantilar', {
      name: 'Yerel',
      host: '127.0.0.1',
      port: fake.port,
      user: 'postgres',
      password: 'gizli',
      sslmode: 'disable',
    });
    id = res.body.connection.id;
  });
  afterEach(async () => {
    await fake.close();
  });

  /** Önizleme sarmalı ilk kolonda toplam satır sayısını döndürür. */
  const WRAPPED = /^WITH tezgah_onizleme AS \(/;

  it('karar beklenmez: son ifadeden hemen sonra rollback; DML’e RETURNING * eklenir; kayıtta deneme-rollback', async () => {
    fake.resultFor = (sql) =>
      WRAPPED.test(sql) ? { columns: ['count', 'id', 'ad'], rows: [['2', '1', 'yeni'], ['2', '2', null]], command: 'SELECT 2' } : undefined;
    dene(id, 'postgres', 'UPDATE t SET ad = 1;\nSELECT 1');
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'deneme' });
    expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'done:1', 'bitti']);
    expect(fake.queries).toContain(
      'WITH tezgah_onizleme AS (UPDATE t SET ad = 1 RETURNING *) SELECT count(*) OVER (), * FROM tezgah_onizleme LIMIT 100',
    );
    expect(fake.queries.at(-1)).toBe('ROLLBACK');
    expect(fake.queries).not.toContain('COMMIT');

    const [update, select] = done(ws.events);
    // Toplam sayı sarmalın kolonundan gelir; önizlemeden çıkarılır.
    expect(update).toMatchObject({ komut: 'UPDATE', rowCount: 2, degisiklik: { kolonlar: ['id', 'ad'], satirlar: [['1', 'yeni'], ['2', null]] } });
    expect(update!.onizleme).toBeUndefined();
    // SELECT sonucu değişiklik değil, Log'daki önizlemedir.
    expect(select).toMatchObject({ komut: 'SELECT', onizleme: { kolonlar: ['ad'] } });
    expect(select!.degisiklik).toBeUndefined();

    const [record] = await records();
    expect(record).toMatchObject({ sonuc: 'deneme-rollback', basladi: { deneme: true, mod: 'transaction' } });
  });

  it('hiç satır değişmezse satır sayısı 0', async () => {
    fake.resultFor = (sql) => (WRAPPED.test(sql) ? { columns: ['count', 'id'], rows: [], command: 'SELECT 0' } : undefined);
    dene(id, 'postgres', 'DELETE FROM t WHERE false');
    await ws.waitFor('bitti');
    expect(done(ws.events)[0]).toMatchObject({ komut: 'DELETE', rowCount: 0, degisiklik: { kolonlar: ['id'], satirlar: [] } });
  });

  it('kullanıcının RETURNING’i korunur; önizleme onun kolonlarıdır', async () => {
    fake.resultFor = (sql) => (WRAPPED.test(sql) ? { columns: ['count', 'id'], rows: [['1', '7']], command: 'SELECT 1' } : undefined);
    dene(id, 'postgres', 'INSERT INTO t VALUES (7) RETURNING id');
    await ws.waitFor('bitti');
    expect(fake.queries).toContain(
      'WITH tezgah_onizleme AS (INSERT INTO t VALUES (7) RETURNING id) SELECT count(*) OVER (), * FROM tezgah_onizleme LIMIT 100',
    );
    expect(done(ws.events)[0]).toMatchObject({ komut: 'INSERT', rowCount: 1, degisiklik: { kolonlar: ['id'], satirlar: [['7']] } });
  });

  it('sarmalı kabul etmeyen DML (ör. kurallı tablo) kullanıcının yazdığı gibi düz çalışır; yalnızca satır sayısı', async () => {
    // Kural RETURNING'i de kabul etmeyebilir: eklenen RETURNING * yedekte gönderilmez.
    fake.failOn = (sql) => (WRAPPED.test(sql) || sql.endsWith('RETURNING *') ? { code: '0A000', message: 'not supported' } : undefined);
    fake.resultFor = (sql) => (sql === 'UPDATE v SET a = 1' ? { columns: [], rows: [], command: 'UPDATE 3' } : undefined);
    dene(id, 'postgres', 'UPDATE v SET a = 1');
    await ws.waitFor('bitti');
    expect(fake.queries).toEqual(expect.arrayContaining(['ROLLBACK TO SAVEPOINT tezgah_onizleme', 'UPDATE v SET a = 1', 'ROLLBACK']));
    const [update] = done(ws.events);
    expect(update).toMatchObject({ komut: 'UPDATE', rowCount: 3 });
    expect(update!.degisiklik).toBeUndefined();
  });

  it('sarmalı kabul etmeyen DML’in kendi RETURNING’i yedekte de değişiklik önizlemesidir', async () => {
    fake.failOn = (sql) => (WRAPPED.test(sql) ? { code: '0A000', message: 'not supported' } : undefined);
    fake.resultFor = (sql) => (sql.endsWith('RETURNING id') ? { columns: ['id'], rows: [['1']], command: 'UPDATE 1' } : undefined);
    dene(id, 'postgres', 'UPDATE v SET a = 1 RETURNING id');
    await ws.waitFor('bitti');
    expect(done(ws.events)[0]).toMatchObject({ komut: 'UPDATE', rowCount: 1, degisiklik: { kolonlar: ['id'], satirlar: [['1']] } });
  });

  it('hata: durulur, konum kullanıcının metnine göre, karar beklenmez ve geri alınır', async () => {
    // Postgres konumu sarmalanmış metne göre verir.
    const prefix = 'WITH tezgah_onizleme AS ('.length;
    fake.failOn = (sql) =>
      sql.includes('VALUES (2)') && WRAPPED.test(sql) ? { code: '23505', message: 'duplicate key', position: prefix + 22 } : undefined;
    fake.resultFor = (sql) => (WRAPPED.test(sql) ? { columns: ['count', 'id'], rows: [['1', '1']], command: 'SELECT 1' } : undefined);
    dene(id, 'postgres', 'INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);\nDELETE FROM t');
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'deneme' });
    expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'error:1', 'bitti']);
    expect(ws.events.find((e) => e.type === 'error')).toMatchObject({ sqlstate: '23505', satir: 2, sutun: 22 });
    expect(fake.queries.at(-1)).toBe('ROLLBACK');
    const [record] = await records();
    expect(record).toMatchObject({ sonuc: 'deneme-rollback', bitti: { ifadeler: [{}, { hata: { kod: '23505', satir: 2 } }] } });
  });

  it('bittikten sonra commit isteği reddedilir', async () => {
    dene(id, 'postgres', 'SELECT 1');
    await ws.waitFor('bitti');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'gecersizIstek' });
    expect(fake.queries).not.toContain('COMMIT');
  });

  it('transaction dışı ifade içeren script bağlanmadan reddedilir ve kaydedilmez', async () => {
    dene(id, 'postgres', 'UPDATE t SET a = 1;\nVACUUM t');
    expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'karisik', transactionDisi: [1] });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'reddedildi' });
    ws.events.length = 0;

    dene(id, 'postgres', 'VACUUM t');
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'reddedildi', mesaj: `Satır 1: ${DENEME_NON_TRANSACTIONAL_MESSAGE}` });
    expect(fake.attempts).toEqual([]);
    expect(await records()).toEqual([]);
  });
});

describePg('Deneme modu: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const TABLE = 'tezgah_test_deneme';
  let admin: pg.Client;
  let connectionId: string;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id int PRIMARY KEY, ad text)`);
  });
  afterAll(async () => {
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.end();
  });
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLE}`);
    await admin.query(`INSERT INTO ${TABLE} SELECT g, 'a' || g FROM generate_series(1, 150) g`);
    const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', ...real });
    connectionId = res.body.connection.id;
  });

  const rows = async () => (await admin.query(`SELECT id, ad FROM ${TABLE} ORDER BY id`)).rows;

  it('veri değişmeden kalır; UPDATE yeni hâli, INSERT ekleneni, DELETE sileni gösterir', async () => {
    const before = await rows();
    dene(
      connectionId,
      real.database,
      `UPDATE ${TABLE} SET ad = 'b' WHERE id = 1;\nINSERT INTO ${TABLE} VALUES (500, 'yeni');\nDELETE FROM ${TABLE} WHERE id = 2;\nSELECT count(*) FROM ${TABLE}`,
    );
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'deneme' });
    const [update, insert, del, select] = done(ws.events);
    expect(update).toMatchObject({ komut: 'UPDATE', rowCount: 1, degisiklik: { kolonlar: ['id', 'ad'], satirlar: [['1', 'b']] } });
    expect(insert).toMatchObject({ komut: 'INSERT', rowCount: 1, degisiklik: { satirlar: [['500', 'yeni']] } });
    expect(del).toMatchObject({ komut: 'DELETE', rowCount: 1, degisiklik: { satirlar: [['2', 'a2']] } });
    expect(select).toMatchObject({ komut: 'SELECT', onizleme: { satirlar: [['150']] } });
    expect(await rows()).toEqual(before);
  });

  it('ifade başına en fazla 100 satır; satır sayısı tamamıdır', async () => {
    dene(connectionId, real.database, `UPDATE ${TABLE} SET ad = 'x'`);
    await ws.waitFor('bitti');
    const [update] = done(ws.events);
    expect(update!.rowCount).toBe(150);
    expect(update!.degisiklik!.satirlar).toHaveLength(100);
  });

  it('kullanıcının RETURNING’i korunur', async () => {
    dene(connectionId, real.database, `DELETE FROM ${TABLE} WHERE id <= 3 RETURNING id`);
    await ws.waitFor('bitti');
    expect(done(ws.events)[0]).toMatchObject({ rowCount: 3, degisiklik: { kolonlar: ['id'], satirlar: [['1'], ['2'], ['3']] } });
    expect(await rows()).toHaveLength(150);
  });

  it('hata: hataya kadarki önizlemeler gelir, hatalı satır ve SQLSTATE döner, veri değişmez', async () => {
    dene(connectionId, real.database, `DELETE FROM ${TABLE} WHERE id = 1;\nINSERT INTO ${TABLE} VALUES (3, 'tekrar')`);
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'deneme' });
    expect(done(ws.events)[0]).toMatchObject({ degisiklik: { satirlar: [['1', 'a1']] } });
    expect(ws.events.find((e) => e.type === 'error')).toMatchObject({ i: 1, sqlstate: '23505', satir: 2 });
    expect(await rows()).toHaveLength(150);
    expect((await rows())[0]).toEqual({ id: 1, ad: 'a1' });
  });
});
