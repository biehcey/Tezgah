import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakePostgres, type FakePostgres, type FakeResult } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer, type TestSocket } from './test/sunucu';
import { addFakeConnection } from './test/yardimcilar';

let t: TestServer;
let fake: FakePostgres;

const RELATION_COLUMNS = ['sema', 'ad', 'tur', 'satir', 'kolon', 'tip', 'tip_oid', 'not_null', 'varsayilan', 'uretilmis', 'pk_sira'];

/** Sahte sunucunun katalog satırları; testler değiştirebilir. */
let schemas: string[];
let firstSchema: string;
let relationRows: (string | null)[][];

const result = (columns: string[], rows: (string | null)[][]): FakeResult => ({ columns, rows, command: `SELECT ${rows.length}` });

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  schemas = ['app', 'information_schema', 'pg_catalog', 'public'];
  firstSchema = 'public';
  relationRows = [
    ['public', 'users', 'r', '42', 'id', 'integer', '23', 't', 't', '', '1'],
    ['public', 'users', 'r', '42', 'ad', 'character varying(20)', '1043', 'f', 'f', '', null],
    ['public', 'users', 'r', '42', 'tam_ad', 'text', '25', 'f', 't', 's', null],
    ['public', 'bos_view', 'v', '-1', null, null, null, null, null, null, null],
    ['app', 'kalem', 'r', '-1', 'siparis', 'integer', '23', 't', 'f', '', '2'],
    ['app', 'kalem', 'r', '-1', 'sira', 'integer', '23', 't', 'f', '', '1'],
  ];
  fake.resultFor = (sql) => {
    if (sql.includes('pg_catalog.pg_attribute')) return result(RELATION_COLUMNS, relationRows);
    if (sql.includes('pg_catalog.pg_type')) {
      return result(['oid', 'ad', 'kullanici'], [
        ['23', 'integer', 'f'],
        ['16400', 'durum', 't'],
      ]);
    }
    if (sql.includes('pg_catalog.pg_namespace')) {
      return result(['ad', 'varsayilan'], schemas.map((s) => [s, s === firstSchema ? 't' : 'f']));
    }
    return undefined;
  };
  t = await startTestServer({ clock: createFakeClock() });
});
afterEach(async () => {
  await t.close();
  await fake.close();
});

const createConnection = () => addFakeConnection(t, fake.port);

const catalogUrl = (id: string, database = 'postgres') => `/api/baglantilar/${id}/veritabanlari/${database}/katalog`;
const catalogQueries = () => fake.queries.filter((q) => q.includes('pg_catalog.pg_attribute'));

const tab = (): Promise<TestSocket> => t.socket();

describe('Katalog önbelleği: içerik', () => {
  it('görünür şemaların ilişkileri kolonları, PK sırası, reltuples, tipler ve defaultSchema ile gelir', async () => {
    const id = await createConnection();
    const res = await t.api('GET', catalogUrl(id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      defaultSchema: 'public',
      semalar: ['app', 'public'],
      iliskiler: [
        {
          sema: 'app',
          ad: 'kalem',
          tur: 'r',
          reltuples: -1,
          pk: ['sira', 'siparis'],
          kolonlar: [
            { ad: 'siparis', tip: 'integer', tipOid: 23, notNull: true, varsayilan: false, uretilmis: false },
            { ad: 'sira', tip: 'integer', tipOid: 23, notNull: true, varsayilan: false, uretilmis: false },
          ],
        },
        { sema: 'public', ad: 'bos_view', tur: 'v', reltuples: -1, pk: [], kolonlar: [] },
        {
          sema: 'public',
          ad: 'users',
          tur: 'r',
          reltuples: 42,
          pk: ['id'],
          kolonlar: [
            { ad: 'id', tip: 'integer', tipOid: 23, notNull: true, varsayilan: true, uretilmis: false },
            { ad: 'ad', tip: 'character varying(20)', tipOid: 1043, notNull: false, varsayilan: false, uretilmis: false },
            { ad: 'tam_ad', tip: 'text', tipOid: 25, notNull: false, varsayilan: true, uretilmis: true },
          ],
        },
      ],
      tipler: { '23': 'integer', '16400': 'durum' },
      kullaniciTipleri: ['durum'],
    });
  });

  it('ilişki ve tip sorguları yalnızca görünür şemalara (tipte ayrıca pg_catalog) bakar, salt okunur transaction içinde', async () => {
    const id = await createConnection();
    await t.api('PUT', `/api/baglantilar/${id}/veritabani-secimi`, [{ database: 'postgres', schemas: ['public'] }]);
    const res = await t.api('GET', catalogUrl(id));
    expect(res.body.semalar).toEqual(['public']);
    const [relations] = catalogQueries();
    expect(relations).toContain("IN (E'public')");
    expect(fake.queries.find((q) => q.includes('pg_catalog.pg_type'))).toContain("IN (E'pg_catalog', E'public')");
    expect(fake.queries.some((q) => /^BEGIN .*READ ONLY/.test(q))).toBe(true);
  });

  it('önbellekteki katalog yeniden okunmaz; ↻ yeniden okur', async () => {
    const id = await createConnection();
    await t.api('GET', catalogUrl(id));
    relationRows = [['public', 'yeni', 'r', '0', 'id', 'integer', '23', 't', 'f', '', null]];
    expect((await t.api('GET', catalogUrl(id))).body.iliskiler).toHaveLength(3);
    expect(catalogQueries()).toHaveLength(1);
    const refreshed = await t.api('POST', `${catalogUrl(id)}/yenile`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.iliskiler.map((r: { ad: string }) => r.ad)).toEqual(['yeni']);
    expect((await t.api('GET', catalogUrl(id))).body.iliskiler.map((r: { ad: string }) => r.ad)).toEqual(['yeni']);
  });

  it('açılışta ve bağlantı listelenirken hiçbir katalog sorgusu gitmez', async () => {
    await createConnection();
    await t.api('GET', '/api/baglantilar');
    expect(fake.queries).toEqual([]);
  });

  it('bağlanılamayan hedefte 502, bilinmeyen bağlantıda 404', async () => {
    const id = await createConnection();
    fake.password = 'degisti';
    const res = await t.api('GET', catalogUrl(id));
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ kod: '28P01' });
    expect((await t.api('GET', catalogUrl('yok'))).status).toBe(404);
  });
});

describe('Katalog önbelleği: atılma', () => {
  it.each([
    ['bağlantı kesilince', (id: string) => t.api('POST', `/api/baglantilar/${id}/baglantiyi-kes`)],
    ['Veritabanı seçimi değişince', (id: string) => t.api('PUT', `/api/baglantilar/${id}/veritabani-secimi`, [{ database: 'postgres', schemas: null }])],
    ['bağlantı silinince', (id: string) => t.api('DELETE', `/api/baglantilar/${id}`)],
  ])('%s önbellek atılır', async (_, act) => {
    const id = await createConnection();
    await t.api('GET', catalogUrl(id));
    await act(id);
    const after = await t.api('GET', catalogUrl(id));
    // Silinen bağlantının katalogu yoktur; diğerlerinde yeniden okunur.
    if (after.status === 404) return;
    expect(catalogQueries()).toHaveLength(2);
  });
});

describe('Katalog önbelleği: DDL sonrası yenileme', () => {
  it('DDL içeren script commit ile bitince önbellek tazelenir ve bitti.katalogYenilendi gelir', async () => {
    const id = await createConnection();
    await t.api('GET', catalogUrl(id));
    relationRows = [['public', 'yeni', 'r', '0', 'id', 'integer', '23', 't', 'f', '', null]];
    const ws = await tab();
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'CREATE TABLE yeni (id int)' });
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit', katalogYenilendi: true });
    expect((await t.api('GET', catalogUrl(id))).body.iliskiler.map((r: { ad: string }) => r.ad)).toEqual(['yeni']);
  });

  it('DDL autocommit ile uygulanınca da yenilenir', async () => {
    const id = await createConnection();
    await t.api('GET', catalogUrl(id));
    const ws = await tab();
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'CREATE INDEX CONCURRENTLY i ON t (a)' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'autocommit', katalogYenilendi: true });
    expect(catalogQueries()).toHaveLength(2);
  });

  it('katalogu hiç istenmemiş hedefte DDL commit katalog okumaz', async () => {
    const id = await createConnection();
    const ws = await tab();
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'CREATE TABLE yeni (id int)' });
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).not.toHaveProperty('katalogYenilendi');
    expect(catalogQueries()).toEqual([]);
  });

  it('rollback edilen DDL ve DDL içermeyen commit katalogu yenilemez', async () => {
    const id = await createConnection();
    await t.api('GET', catalogUrl(id));
    const ddl = await tab();
    ddl.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'CREATE TABLE yeni (id int)' });
    await ddl.waitFor('kararBekleniyor');
    ddl.send({ type: 'rollback' });
    expect(await ddl.waitFor('bitti')).not.toHaveProperty('katalogYenilendi');

    const dml = await tab();
    dml.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'UPDATE t SET a = 1' });
    await dml.waitFor('kararBekleniyor');
    dml.send({ type: 'commit' });
    expect(await dml.waitFor('bitti')).not.toHaveProperty('katalogYenilendi');
    expect(catalogQueries()).toHaveLength(1);
  });
});

describePg('Katalog önbelleği: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const SCHEMA = 'tezgah_katalog';
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`CREATE TYPE ${SCHEMA}.durum AS ENUM ('a', 'b')`);
    await admin.query(`CREATE TABLE ${SCHEMA}."Kalem" (sira int, siparis int DEFAULT 1, d ${SCHEMA}.durum,
      iki int GENERATED ALWAYS AS (sira * 2) STORED, PRIMARY KEY (siparis, sira))`);
    await admin.query(`CREATE VIEW ${SCHEMA}.v AS SELECT 1 AS bir`);
  });
  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  });

  it('ilişkiler, kolonlar, PK sırası ve kullanıcı tipleri okunur', async () => {
    const res = await t.api('POST', '/api/baglantilar', { name: 'Gerçek', sslmode: 'prefer', ...real });
    const id = res.body.connection.id;
    await t.api('PUT', `/api/baglantilar/${id}/veritabani-secimi`, [{ database: real.database, schemas: [SCHEMA] }]);
    const { status, body } = await t.api('GET', catalogUrl(id, real.database));
    expect(status).toBe(200);
    expect(body.semalar).toEqual([SCHEMA]);
    const kalem = body.iliskiler.find((r: { ad: string }) => r.ad === 'Kalem');
    expect(kalem).toMatchObject({ tur: 'r', pk: ['siparis', 'sira'] });
    expect(kalem.kolonlar).toEqual([
      { ad: 'sira', tip: 'integer', tipOid: 23, notNull: true, varsayilan: false, uretilmis: false },
      { ad: 'siparis', tip: 'integer', tipOid: 23, notNull: true, varsayilan: true, uretilmis: false },
      { ad: 'd', tip: `${SCHEMA}.durum`, tipOid: expect.any(Number), notNull: false, varsayilan: false, uretilmis: false },
      { ad: 'iki', tip: 'integer', tipOid: 23, notNull: false, varsayilan: true, uretilmis: true },
    ]);
    expect(body.iliskiler.find((r: { ad: string }) => r.ad === 'v')).toMatchObject({ tur: 'v', pk: [] });
    expect(body.kullaniciTipleri).toEqual([`${SCHEMA}.durum`]);
    expect(body.tipler['23']).toBe('integer');
  });
});
