import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer } from './test/sunucu';
import { addFakeConnection } from './test/yardimcilar';

let t: TestServer;
let fake: FakePostgres;

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  fake.extendedResultFor = (sql) =>
    sql.includes('pg_catalog.pg_proc')
      ? { columns: ['ad', 'oynaklik'], rows: [['now', 's'], ['random', 'v']], command: 'SELECT 2' }
      : undefined;
  t = await startTestServer({ clock: createFakeClock() });
});
afterEach(async () => {
  await t.close();
  await fake.close();
});

const createConnection = (extra: Record<string, unknown> = {}) => addFakeConnection(t, fake.port, extra);

const url = (id: string, database = 'postgres') => `/api/baglantilar/${id}/veritabanlari/${database}/fonksiyon-oynakligi`;
const procQueries = () => fake.queries.filter((q) => q.includes('pg_proc'));

describe('Fonksiyon oynaklığı ucu', () => {
  it('adlar tek parametreli sorguyla sorulur; ad başına oynaklık döner', async () => {
    const id = await createConnection();
    const res = await t.api('POST', url(id), { fonksiyonlar: ['now', 'random', 'yok'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ oynaklik: { now: 's', random: 'v' } });
    expect(procQueries()).toHaveLength(1);
    expect(fake.parameters.at(-1)).toEqual(['{"now","random","yok"}']);
  });

  it('boş listede hedefe bağlanılmaz', async () => {
    const id = await createConnection();
    const res = await t.api('POST', url(id), { fonksiyonlar: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ oynaklik: {} });
    expect(fake.attempts).toEqual([]);
  });

  it('geçersiz gövde 400, bilinmeyen bağlantı 404, yanlış yöntem 405', async () => {
    const id = await createConnection();
    expect((await t.api('POST', url(id), { fonksiyonlar: 'now' })).status).toBe(400);
    expect((await t.api('POST', url('yok'), { fonksiyonlar: ['now'] })).status).toBe(404);
    expect((await t.api('GET', url(id))).status).toBe(405);
  });

  it('hedefe bağlanılamazsa 502 ve nedeni', async () => {
    const id = await createConnection({ password: 'yanlis' });
    const res = await t.api('POST', url(id), { fonksiyonlar: ['now'] });
    expect(res.status).toBe(502);
    expect(res.body.kod).toBe('28P01');
  });
});

describePg('Fonksiyon oynaklığı: gerçek Postgres', () => {
  const real = new URL(pgUrl ?? 'postgres://localhost');
  const conn = {
    host: real.hostname,
    port: Number(real.port || 5432),
    user: decodeURIComponent(real.username),
    password: decodeURIComponent(real.password),
    database: decodeURIComponent(real.pathname.slice(1)) || 'postgres',
  };
  const SCHEMA = 'tezgah_oynaklik';
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client(conn);
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    // Aşırı yüklenmiş ad: biri immutable, biri volatile → en oynak olanı.
    await admin.query(`CREATE FUNCTION ${SCHEMA}.karisik(int) RETURNS int IMMUTABLE LANGUAGE sql AS 'SELECT $1'`);
    await admin.query(`CREATE FUNCTION ${SCHEMA}.karisik(text) RETURNS text VOLATILE LANGUAGE sql AS 'SELECT $1'`);
    await admin.query(`CREATE FUNCTION ${SCHEMA}."Buyuk"() RETURNS int STABLE LANGUAGE sql AS 'SELECT 1'`);
  });
  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  });

  it('pg_proc’tan ad başına en oynak değer; bilinmeyen ad yok', async () => {
    const res = await t.api('POST', '/api/baglantilar', { name: 'Gerçek', sslmode: 'prefer', ...conn });
    const id = res.body.connection.id;
    const out = await t.api('POST', url(id, encodeURIComponent(conn.database)), {
      fonksiyonlar: ['now', 'random', 'abs', 'karisik', 'Buyuk', 'yok_boyle_fonksiyon'],
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ oynaklik: { now: 's', random: 'v', abs: 'i', karisik: 'v', Buyuk: 's' } });
  });
});
