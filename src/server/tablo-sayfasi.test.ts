import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakePostgres, type FakePostgres, type FakeResult } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
let fake: FakePostgres;

const RELATION_COLUMNS = ['sema', 'ad', 'tur', 'satir', 'kolon', 'tip', 'tip_oid', 'not_null', 'varsayilan', 'uretilmis', 'pk_sira'];
const result = (columns: string[], rows: (string | null)[][]): FakeResult => ({ columns, rows, command: `SELECT ${rows.length}` });
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Sayfa sorgusuna dönen satırlar; testler değiştirir. */
let pageRows: (string | null)[][];

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  pageRows = [];
  fake.resultFor = (sql) => {
    if (sql.includes('pg_catalog.pg_attribute')) {
      return result(RELATION_COLUMNS, [
        ['public', 'users', 'r', '1234', 'id', 'integer', '23', 't', 't', '', '1'],
        ['public', 'users', 'r', '1234', 'ad', 'text', '25', 'f', 'f', '', null],
        ['public', 'log', 'r', '-1', 'ts', 'timestamptz', '1184', 'f', 'f', '', null],
        ['public', 'log', 'r', '-1', 'mesaj', 'text', '25', 'f', 'f', '', null],
      ]);
    }
    if (sql.includes('pg_catalog.pg_type')) return result(['oid', 'ad', 'kullanici'], []);
    if (sql.includes('pg_catalog.pg_namespace')) return result(['ad', 'varsayilan'], [['public', 't']]);
    return undefined;
  };
  fake.extendedResultFor = (sql, params) => {
    if (isEstimate(sql)) return result(['satir'], [[params[1] === 'users' ? '1300' : '-1']]);
    if (sql.startsWith('SELECT "id", "ad"')) return result(['id', 'ad'], pageRows);
    if (sql.startsWith('SELECT "ts", "mesaj"')) return result(['ts', 'mesaj'], pageRows);
    return undefined;
  };
  t = await startTestServer({ clock: createFakeClock() });
});
afterEach(async () => {
  await t.close();
  await fake.close();
});

async function createConnection(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', {
    name: 'Yerel',
    host: '127.0.0.1',
    port: fake.port,
    user: 'postgres',
    password: 'gizli',
    sslmode: 'disable',
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}

const pageUrl = (id: string) => `/api/baglantilar/${id}/veritabanlari/postgres/tablo-sayfasi`;
/** Tahmini satır sayısı sorgusu (yalnızca ilk sayfada). */
const isEstimate = (sql: string) => sql.includes('c.relname = $2');
const pageQueries = () => fake.queries.filter((q) => q.includes('FROM "public"'));

describe('Tablo sayfası: PK’lı tabloda keyset', () => {
  it('ilk sayfa PK sırasıyla; tahmini satır sayısı, sonraki sayfanın imleci son PK değeri', async () => {
    const id = await createConnection();
    pageRows = range(1, 500).map((i) => [String(i), `ad${i}`]);
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kolonlar: ['id', 'ad'],
      pk: ['id'],
      tutarlilikNotu: false,
      satirTahmini: 1300,
      sonraki: { tur: 'keyset', degerler: ['500'] },
    });
    expect(res.body.satirlar).toHaveLength(500);
    expect(res.body.satirlar[0]).toEqual(['1', 'ad1']);
    expect(pageQueries()).toEqual(['SELECT "id", "ad" FROM "public"."users" ORDER BY "id" LIMIT 500']);
  });

  it('sonraki sayfa son PK değeriyle parametreli gider; tahmin yeniden okunmaz, son sayfanın imleci yok', async () => {
    const id = await createConnection();
    pageRows = range(501, 20).map((i) => [String(i), `ad${i}`]);
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: { tur: 'keyset', degerler: ['500'] } });
    expect(res.status).toBe(200);
    expect(res.body.sonraki).toBeNull();
    expect(res.body.satirTahmini).toBeUndefined();
    expect(pageQueries()).toEqual(['SELECT "id", "ad" FROM "public"."users" WHERE ("id") > ($1) ORDER BY "id" LIMIT 500']);
    expect(fake.parameters.at(-1)).toEqual(['500']);
    expect(fake.queries.some(isEstimate)).toBe(false);
  });
});

describe('Tablo sayfası: PK’sız tabloda OFFSET', () => {
  it('OFFSET ile sayfalanır ve tutarlılık notu gelir; hiç analiz edilmemiş tablonun tahmini -1', async () => {
    const id = await createConnection();
    pageRows = range(0, 500).map((i) => [`t${i}`, 'm']);
    const first = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'log', sonraki: null });
    expect(first.body).toMatchObject({ pk: [], tutarlilikNotu: true, satirTahmini: -1, sonraki: { tur: 'offset', offset: 500 } });
    const second = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'log', sonraki: first.body.sonraki });
    expect(second.body.sonraki).toEqual({ tur: 'offset', offset: 1000 });
    expect(pageQueries()).toEqual([
      'SELECT "ts", "mesaj" FROM "public"."log" LIMIT 500 OFFSET 0',
      'SELECT "ts", "mesaj" FROM "public"."log" LIMIT 500 OFFSET 500',
    ]);
  });
});

describe('Tablo sayfası: kısa, salt okunur, kayıtsız', () => {
  it('her sayfa kendi BEGIN READ ONLY … COMMIT’i içinde, tek ifade extended protocol ile', async () => {
    const id = await createConnection();
    await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: null });
    const fromBegin = fake.queries.slice(fake.queries.lastIndexOf('BEGIN READ ONLY'));
    expect(fromBegin.filter((q) => !isEstimate(q))).toEqual([
      'BEGIN READ ONLY',
      'SELECT "id", "ad" FROM "public"."users" ORDER BY "id" LIMIT 500',
      'COMMIT',
    ]);
    expect(fake.parameters.length).toBeGreaterThanOrEqual(1);
  });

  it('prod etiketli bağlantıda da (Yazma kilidi olmadan) okur', async () => {
    const id = await createConnection({ envTag: 'prod' });
    pageRows = [['1', 'a']];
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: null });
    expect(res.status).toBe(200);
    expect(res.body.satirlar).toEqual([['1', 'a']]);
    expect(fake.queries).toContain('BEGIN READ ONLY');
  });

  it('Çalıştırma kaydına yazılmaz', async () => {
    const id = await createConnection();
    await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: null });
    const history = await t.api('GET', '/api/calistirma-kayitlari');
    expect(history.status).toBe(200);
    expect(history.body.kayitlar).toEqual([]);
  });
});

describe('Tablo sayfası: WHERE ve ORDER BY', () => {
  it('kullanıcı WHERE’i parantez içinde keyset koşuluyla, ORDER BY’ı OFFSET’le tek ifade olarak gider', async () => {
    const id = await createConnection();
    pageRows = range(0, 500).map((i) => [String(i), 'a']);
    const first = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', where: "ad <> 'x'", orderBy: '', sonraki: null });
    expect(first.status).toBe(200);
    await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', where: "ad <> 'x'", orderBy: '', sonraki: first.body.sonraki });
    const ordered = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', where: '', orderBy: 'ad DESC', sonraki: null });
    expect(ordered.body).toMatchObject({ tutarlilikNotu: true, sonraki: { tur: 'offset', offset: 500 } });
    expect(pageQueries()).toEqual([
      `SELECT "id", "ad" FROM "public"."users" WHERE (ad <> 'x') ORDER BY "id" LIMIT 500`,
      `SELECT "id", "ad" FROM "public"."users" WHERE (ad <> 'x') AND ("id") > ($1) ORDER BY "id" LIMIT 500`,
      'SELECT "id", "ad" FROM "public"."users" ORDER BY ad DESC LIMIT 500 OFFSET 0',
    ]);
  });

  it('çok ifadeli filtre reddedilir: 400, hangi kutu olduğu söylenir, hedefe hiçbir şey gitmez', async () => {
    const id = await createConnection();
    const before = fake.queries.length;
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', where: 'true; DROP TABLE users', orderBy: '', sonraki: null });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ kutu: 'where', hata: expect.stringContaining('tek bir ifade') });
    expect(fake.queries.slice(before)).not.toContain('BEGIN READ ONLY');
    expect(pageQueries()).toEqual([]);
  });

  it('filtredeki Postgres hatası kutuya ve kutudaki konuma eşlenir', async () => {
    const id = await createConnection();
    fake.failOn = (sql) => {
      const at = sql.indexOf('yok_kolon');
      return sql.startsWith('SELECT "id"') && at !== -1 ? { code: '42703', message: 'column "yok_kolon" does not exist', position: at + 1 } : undefined;
    };
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', where: 'id > 1 AND yok_kolon = 2', orderBy: '', sonraki: null });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ sqlstate: '42703', kutu: 'where', kutuKonumu: 12 });
  });
});

describe('Tablo sayfası: hatalar', () => {
  it('Postgres hatası SQLSTATE ve konumla döner, transaction geri alınır', async () => {
    const id = await createConnection();
    fake.failOn = (sql) => (sql.startsWith('SELECT "id"') ? { code: '42501', message: 'permission denied for table users', position: 8 } : undefined);
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: null });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ hata: 'permission denied for table users', sqlstate: '42501', konum: 8 });
    expect(fake.queries.at(-1)).toBe('ROLLBACK');
  });

  it('katalogda olmayan tablo 404', async () => {
    const id = await createConnection();
    const res = await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'yok', sonraki: null });
    expect(res.status).toBe(404);
    expect(pageQueries()).toEqual([]);
  });

  it('tabloya uymayan imleç ve bozuk gövde 400, sorgu gitmez', async () => {
    const id = await createConnection();
    expect((await t.api('POST', pageUrl(id), { sema: 'public', tablo: 'users', sonraki: { tur: 'offset', offset: 500 } })).status).toBe(400);
    expect((await t.api('POST', pageUrl(id), { tablo: 'users' })).status).toBe(400);
    expect(pageQueries()).toEqual([]);
  });

  it('bilinmeyen bağlantı 404, GET 405', async () => {
    expect((await t.api('POST', pageUrl('yok'), { sema: 'public', tablo: 'users', sonraki: null })).status).toBe(404);
    const id = await createConnection();
    expect((await t.api('GET', pageUrl(id))).status).toBe(405);
  });
});

describePg('Tablo sayfası: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const SCHEMA = 'tezgah_tablo';
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`CREATE TABLE ${SCHEMA}.kisi (id int PRIMARY KEY, ad text)`);
    await admin.query(`INSERT INTO ${SCHEMA}.kisi SELECT i, 'ad' || lpad(i::text, 4, '0') FROM generate_series(1, 1200) i`);
  });
  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  });

  async function connect(): Promise<(body: Record<string, unknown>) => ReturnType<TestServer['api']>> {
    const res = await t.api('POST', '/api/baglantilar', { name: 'Gerçek', sslmode: 'prefer', ...real });
    const id = res.body.connection.id;
    await t.api('PUT', `/api/baglantilar/${id}/veritabani-secimi`, [{ database: real.database, schemas: [SCHEMA] }]);
    const page = `/api/baglantilar/${id}/veritabanlari/${encodeURIComponent(real.database)}/tablo-sayfasi`;
    return (body) => t.api('POST', page, { sema: SCHEMA, tablo: 'kisi', where: '', orderBy: '', sonraki: null, ...body });
  }

  it('kullanıcı WHERE’i keyset sayfalarıyla birlikte; ORDER BY’la OFFSET', async () => {
    const read = await connect();
    const first = await read({ where: 'id % 2 = 0' });
    expect(first.status).toBe(200);
    expect(first.body.satirlar).toHaveLength(500);
    expect(first.body.sonraki).toEqual({ tur: 'keyset', degerler: ['1000'] });
    const second = await read({ where: 'id % 2 = 0', sonraki: first.body.sonraki });
    expect(second.body.satirlar).toHaveLength(100);
    expect(second.body.satirlar[0]).toEqual(['1002', 'ad1002']);

    const ordered = await read({ orderBy: 'ad DESC -- yorum LIMIT’i yutmaz' });
    expect(ordered.body).toMatchObject({ tutarlilikNotu: true, sonraki: { tur: 'offset', offset: 500 } });
    expect(ordered.body.satirlar).toHaveLength(500);
    expect(ordered.body.satirlar[0]).toEqual(['1200', 'ad1200']);
  });

  it('filtre hatası SQLSTATE ve kutudaki konumla; yarım ifade kutunun sonuna düşer', async () => {
    const read = await connect();
    expect((await read({ where: 'id = yok_kolon' })).body).toMatchObject({ sqlstate: '42703', kutu: 'where', kutuKonumu: 6 });
    expect((await read({ where: 'id =' })).body).toMatchObject({ sqlstate: '42601', kutu: 'where', kutuKonumu: 5 });
    expect((await read({ orderBy: 'ad,' })).body).toMatchObject({ sqlstate: '42601', kutu: 'orderBy', kutuKonumu: 4 });
  });

  it('kutudan kaçmaya çalışan WHERE sorguyu bozar ama tek ifadeyi aşamaz', async () => {
    const read = await connect();
    const res = await read({ where: "true) UNION SELECT 1, 'x' --" });
    expect(res.status).toBe(400);
    expect(res.body.sqlstate).toBe('42601');
  });
});
