import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRecords } from '../core/calistirma-kaydi';
import { OLD_NEW_MIN_VERSION, parseServerVersion } from '../core/deneme';
import { mergeChanges } from '../core/deneme-farki';
import type { ServerEvent } from '../core/script-calistirma';
import { DENEME_NON_TRANSACTIONAL_MESSAGE } from '../core/yazma-kilidi';
import { startFakePostgres, type FakePostgres, type FakeResult } from './test/sahte-postgres';
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
  describe('önce/sonra farkı (PG18+) ve yedek', () => {
    const OLD_NEW = /^WITH tezgah_onizleme AS \(.* RETURNING WITH \(OLD AS tezgah_once/;
    const info = (anahtar: string[], kolonlar: [number, string, string][] = [[1, 'id', 'integer'], [2, 'ad', 'text']]) =>
      JSON.stringify({
        oid: '100',
        ad: 'public.musteri',
        anahtar,
        kolonlar: kolonlar.map(([no, ad, tip]) => ({ no, ad, tip, bos: ad !== 'id', varsayilan: null })),
      });
    /** Sunucu sürümü ve tablo bilgisi; diğer sorgular `rest`'e düşer. */
    const catalog = (surum: string, tablo: () => string | null, rest: (sql: string) => FakeResult | undefined = () => undefined) => {
      fake.resultFor = (sql) => {
        if (sql === 'SHOW server_version_num') return { columns: ['server_version_num'], rows: [[surum]], command: 'SHOW' };
        if (sql.includes('tezgah_tablo')) {
          const row = tablo();
          return { columns: ['tezgah_tablo'], rows: row === null ? [] : [[row]], command: row === null ? 'SELECT 0' : 'SELECT 1' };
        }
        return rest(sql);
      };
    };
    const returningStar = (sql: string): FakeResult | undefined =>
      WRAPPED.test(sql) ? { columns: ['count', 'id'], rows: [['1', '1']], command: 'SELECT 1' } : undefined;

    it('PG18 ve PK: RETURNING old.*, new.* ile önce/sonra satırları ve çekilmeyenlerin sayısı', async () => {
      catalog('180001', () => info(['id']), (sql) =>
        OLD_NEW.test(sql)
          ? {
              // toplam, eklenen, silinen, tür, old.*, new.*
              columns: ['count', 'count', 'count', 'tezgah_tur', 'id', 'ad', 'id', 'ad'],
              rows: [
                ['150', '1', '0', 'U', '1', 'Ali', '1', 'Veli'],
                ['150', '1', '0', 'I', null, null, '9', 'Yeni'],
              ],
              command: 'SELECT 2',
            }
          : undefined,
      );
      dene(id, 'postgres', 'UPDATE musteri SET ad = 1');
      await ws.waitFor('bitti');
      expect(fake.queries).toContain(
        `WITH tezgah_onizleme AS (UPDATE musteri SET ad = 1 RETURNING WITH (OLD AS tezgah_once, NEW AS tezgah_sonra) ` +
          `CASE WHEN tezgah_once."id" IS NULL THEN 'I' WHEN tezgah_sonra."id" IS NULL THEN 'D' ELSE 'U' END AS tezgah_tur, tezgah_once.*, tezgah_sonra.*) ` +
          `SELECT count(*) OVER (), count(*) FILTER (WHERE tezgah_tur = 'I') OVER (), count(*) FILTER (WHERE tezgah_tur = 'D') OVER (), * FROM tezgah_onizleme LIMIT 100`,
      );
      expect(fake.queries.find((q) => q.includes('tezgah_tablo'))).toContain(`to_regclass('"musteri"')`);
      const [update] = done(ws.events);
      expect(update).toMatchObject({ komut: 'UPDATE', rowCount: 150 });
      expect(update!.degisiklik).toBeUndefined();
      expect(update!.fark).toEqual({
        tablo: { oid: '100', ad: 'public.musteri' },
        kolonlar: ['id', 'ad'],
        anahtar: ['id'],
        satirlar: [
          { once: ['1', 'Ali'], sonra: ['1', 'Veli'] },
          { once: null, sonra: ['9', 'Yeni'] },
        ],
        gorulmeyen: { eklendi: 0, guncellendi: 148, silindi: 0 },
      });
      expect(fake.queries.at(-1)).toBe('ROLLBACK');
    });

    it('PG18 öncesi: RETURNING * önizlemesi ve nedeni; tablo bilgisi okunmaz', async () => {
      catalog('170004', () => info(['id']), returningStar);
      dene(id, 'postgres', 'DELETE FROM musteri');
      await ws.waitFor('bitti');
      expect(fake.queries).toContain('WITH tezgah_onizleme AS (DELETE FROM musteri RETURNING *) SELECT count(*) OVER (), * FROM tezgah_onizleme LIMIT 100');
      expect(fake.queries.some((q) => q.includes('tezgah_tablo'))).toBe(false);
      const [del] = done(ws.events);
      expect(del).toMatchObject({ farkYok: 'surum', degisiklik: { kolonlar: ['id'], satirlar: [['1']] } });
      expect(del!.fark).toBeUndefined();
    });

    it('PG18 ama PK yok: RETURNING * önizlemesi ve nedeni', async () => {
      catalog('180000', () => info([]), returningStar);
      dene(id, 'postgres', 'DELETE FROM musteri');
      await ws.waitFor('bitti');
      expect(fake.queries.some((q) => OLD_NEW.test(q))).toBe(false);
      expect(done(ws.events)[0]).toMatchObject({ farkYok: 'anahtar', degisiklik: { satirlar: [['1']] } });
    });

    it('kullanıcının RETURNING’i korunur ve nedeni söylenir', async () => {
      catalog('180000', () => info(['id']), returningStar);
      dene(id, 'postgres', 'DELETE FROM musteri RETURNING id');
      await ws.waitFor('bitti');
      expect(done(ws.events)[0]).toMatchObject({ farkYok: 'returning', degisiklik: { satirlar: [['1']] } });
    });

    it('önce/sonra sarmalı reddedilirse RETURNING * önizlemesine düşülür', async () => {
      catalog('180000', () => info(['id']), returningStar);
      fake.failOn = (sql) => (OLD_NEW.test(sql) ? { code: '42702', message: 'ambiguous' } : undefined);
      dene(id, 'postgres', 'DELETE FROM musteri');
      await ws.waitFor('bitti');
      expect(fake.queries).toContain('WITH tezgah_onizleme AS (DELETE FROM musteri RETURNING *) SELECT count(*) OVER (), * FROM tezgah_onizleme LIMIT 100');
      expect(done(ws.events)[0]).toMatchObject({ farkYok: 'sarmal', degisiklik: { satirlar: [['1']] } });
    });

    it('DDL: ifadeden önce ve sonra katalogdan okunan şema done olayında gelir', async () => {
      let added = false;
      catalog(
        '170000',
        () => info(['id'], added ? [[1, 'id', 'integer'], [2, 'ad', 'text'], [3, 'son_giris', 'timestamp with time zone']] : undefined),
        (sql) => {
          if (!sql.startsWith('ALTER TABLE')) return undefined;
          added = true;
          return { columns: [], rows: [], command: 'ALTER TABLE' };
        },
      );
      dene(id, 'postgres', 'ALTER TABLE musteri ADD COLUMN son_giris timestamptz');
      await ws.waitFor('bitti');
      const lookups = fake.queries.filter((q) => q.includes('tezgah_tablo'));
      expect(lookups[0]).toContain(`to_regclass('"musteri"')`);
      expect(lookups.some((q) => q.includes('c.oid = 100::oid'))).toBe(true);
      const [alter] = done(ws.events);
      expect(alter!.sema).toEqual([
        {
          oid: '100',
          once: { ad: 'public.musteri', kolonlar: [expect.objectContaining({ ad: 'id' }), expect.objectContaining({ ad: 'ad' })] },
          sonra: {
            ad: 'public.musteri',
            kolonlar: [expect.anything(), expect.anything(), expect.objectContaining({ no: 3, ad: 'son_giris', bos: true })],
          },
        },
      ]);
      expect(fake.queries.at(-1)).toBe('ROLLBACK');
    });

    it('DDL: oluşturulan tablonun öncesi yok, silinenin sonrası yok', async () => {
      let exists = false;
      catalog('170000', () => (exists ? info(['id']) : null), (sql) => {
        if (sql.startsWith('CREATE TABLE')) exists = true;
        if (sql.startsWith('DROP TABLE')) exists = false;
        return sql.startsWith('CREATE') || sql.startsWith('DROP') ? { columns: [], rows: [], command: 'OK' } : undefined;
      });
      dene(id, 'postgres', 'CREATE TABLE musteri (id int PRIMARY KEY);\nDROP TABLE musteri');
      await ws.waitFor('bitti');
      const [create, drop] = done(ws.events);
      expect(create!.sema).toEqual([{ oid: '100', once: null, sonra: expect.objectContaining({ ad: 'public.musteri' }) }]);
      expect(drop!.sema).toEqual([{ oid: '100', once: expect.objectContaining({ ad: 'public.musteri' }), sonra: null }]);
    });

    it('normal çalıştırmada katalog okunmaz, fark gönderilmez', async () => {
      catalog('180000', () => info(['id']));
      ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'ALTER TABLE musteri ADD COLUMN x int', deneme: false });
      await ws.waitFor('kararBekleniyor');
      expect(fake.queries.some((q) => q.includes('tezgah_tablo') || q.startsWith('SHOW'))).toBe(false);
      expect(done(ws.events)[0]!.sema).toBeUndefined();
    });
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
  /** PK'sız (UNIQUE'li) tablo: her sürümde `RETURNING *` önizlemesine düşer. */
  const TABLE = 'tezgah_test_deneme';
  /** PK'lı tablo: PG18+'da önce/sonra farkı, öncesinde yedek önizleme. */
  const PK_TABLE = 'tezgah_test_deneme_pk';
  let admin: pg.Client;
  let connectionId: string;
  /** Sunucu `RETURNING old.*, new.*` destekliyor (PG18+). */
  let oldNew: boolean;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    oldNew = parseServerVersion((await admin.query('SHOW server_version_num')).rows[0].server_version_num) >= OLD_NEW_MIN_VERSION;
    await admin.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id int UNIQUE, ad text)`);
    await admin.query(`CREATE TABLE IF NOT EXISTS ${PK_TABLE} (id int PRIMARY KEY, ad text, sehir text)`);
  });
  afterAll(async () => {
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}, ${PK_TABLE}`);
    await admin.end();
  });
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLE}, ${PK_TABLE}`);
    await admin.query(`INSERT INTO ${TABLE} SELECT g, 'a' || g FROM generate_series(1, 150) g`);
    await admin.query(`INSERT INTO ${PK_TABLE} SELECT g, 'a' || g, 'İzmir' FROM generate_series(1, 150) g`);
    const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', ...real });
    connectionId = res.body.connection.id;
  });

  const rows = async () => (await admin.query(`SELECT id, ad FROM ${TABLE} ORDER BY id`)).rows;
  const pkRows = async () => (await admin.query(`SELECT * FROM ${PK_TABLE} ORDER BY id`)).rows;

  it('PK’lı tablo: PG18+ ise önce/sonra satırları ve birleşen fark, değilse nedeniyle yedek önizleme', async () => {
    const before = await pkRows();
    dene(
      connectionId,
      real.database,
      [
        `UPDATE ${PK_TABLE} SET sehir = 'Ankara' WHERE id = 1`,
        `UPDATE ${PK_TABLE} SET ad = 'Veli' WHERE id = 1`,
        `INSERT INTO ${PK_TABLE} VALUES (500, 'yeni', NULL)`,
        `DELETE FROM ${PK_TABLE} WHERE id = 2`,
      ].join(';\n'),
    );
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'deneme' });
    const [first, second, insert, del] = done(ws.events);
    if (oldNew) {
      expect(first!.fark).toMatchObject({
        tablo: { ad: `public.${PK_TABLE}` },
        kolonlar: ['id', 'ad', 'sehir'],
        anahtar: ['id'],
        satirlar: [{ once: ['1', 'a1', 'İzmir'], sonra: ['1', 'a1', 'Ankara'] }],
      });
      expect(insert!.fark!.satirlar).toEqual([{ once: null, sonra: ['500', 'yeni', null] }]);
      expect(del!.fark!.satirlar).toEqual([{ once: ['2', 'a2', 'İzmir'], sonra: null }]);
      const [diff] = mergeChanges(done(ws.events));
      expect(diff).toMatchObject({ eklendi: 1, guncellendi: 1, silindi: 1 });
      expect(diff!.satirlar[0]).toEqual({ tur: 'guncellendi', once: ['1', 'a1', 'İzmir'], sonra: ['1', 'Veli', 'Ankara'], degisen: ['ad', 'sehir'] });
    } else {
      for (const event of [first, second, insert, del]) expect(event).toMatchObject({ farkYok: 'surum' });
      expect(second!.degisiklik!.satirlar).toEqual([['1', 'Veli', 'Ankara']]);
    }
    expect(await pkRows()).toEqual(before);
  });

  it('PK’lı tabloda büyük UPDATE: en fazla 100 satır çekilir, sayılar tamamıdır', async () => {
    dene(connectionId, real.database, `UPDATE ${PK_TABLE} SET ad = 'x'`);
    await ws.waitFor('bitti');
    const [update] = done(ws.events);
    expect(update!.rowCount).toBe(150);
    if (oldNew) {
      expect(update!.fark!.satirlar).toHaveLength(100);
      expect(mergeChanges([update!])[0]).toMatchObject({ guncellendi: 150, daha: 50 });
    } else expect(update!.degisiklik!.satirlar).toHaveLength(100);
  });

  it('PK’sız tablo PG18+’da da nedeniyle yedek önizlemeye düşer', async () => {
    dene(connectionId, real.database, `DELETE FROM ${TABLE} WHERE id = 1`);
    await ws.waitFor('bitti');
    expect(done(ws.events)[0]).toMatchObject({ farkYok: oldNew ? 'anahtar' : 'surum', degisiklik: { satirlar: [['1', 'a1']] } });
  });

  it('DDL: rollback’ten önce okunan şema farkı tablonun bölümünde; şema geri alınır', async () => {
    dene(connectionId, real.database, `ALTER TABLE ${PK_TABLE} ADD COLUMN son_giris timestamptz;\nUPDATE ${PK_TABLE} SET son_giris = now() WHERE id = 3`);
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'deneme' });
    const diffs = mergeChanges(done(ws.events));
    expect(diffs[0]!.sema).toEqual([{ tur: '+', metin: 'kolon son_giris timestamp with time zone NULL' }]);
    expect(diffs).toHaveLength(1);
    expect(Object.keys((await pkRows())[0])).toEqual(['id', 'ad', 'sehir']);
  });

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
