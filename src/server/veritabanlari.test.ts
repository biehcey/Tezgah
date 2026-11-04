import { createServer, type AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClock, type FakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer } from './test/sunucu';

const IDLE_MS = 10 * 60_000;

let t: TestServer;
let clock: FakeClock;
beforeEach(async () => {
  clock = createFakeClock();
  t = await startTestServer({ clock });
});
afterEach(async () => {
  await t.close();
});

async function create(body: Record<string, unknown>): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', user: 'postgres', host: '127.0.0.1', ...body });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('Veritabanı seçimi', () => {
  it('yeni bağlantıda yalnızca başlangıç veritabanı varsayılan şema görünürlüğüyle seçilidir', async () => {
    await create({ database: 'app' });
    const { body } = await t.api('GET', '/api/baglantilar');
    expect(body[0].databaseSelection).toEqual([{ database: 'app', schemas: null }]);
  });

  it('güncellenen seçim kaydedilir ve bağlantı listesinde döner', async () => {
    const id = await create({});
    const selection = [
      { database: 'postgres', schemas: null },
      { database: 'app', schemas: ['public'] },
    ];
    const res = await t.api('PUT', `/api/baglantilar/${id}/veritabani-secimi`, selection);
    expect(res.status).toBe(200);
    expect(res.body.databaseSelection).toEqual(selection);
    expect((await t.api('GET', '/api/baglantilar')).body[0].databaseSelection).toEqual(selection);
  });

  it('geçersiz seçim 400, bilinmeyen bağlantı 404 döner', async () => {
    const id = await create({});
    expect((await t.api('PUT', `/api/baglantilar/${id}/veritabani-secimi`, [{ database: '' }])).status).toBe(400);
    expect((await t.api('PUT', '/api/baglantilar/yok/veritabani-secimi', [])).status).toBe(404);
  });
});

describe('veritabanı listesi: bağlanılamayan sunucu', () => {
  it('ulaşılamayan sunucuda hata kodu ve mesajla 502 döner', async () => {
    const id = await create({ port: await closedPort(), password: 'x' });
    const res = await t.api('GET', `/api/baglantilar/${id}/veritabanlari`);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ kod: 'ECONNREFUSED', hata: expect.any(String) });
  });

  it('bilinmeyen bağlantıda 404 döner', async () => {
    expect((await t.api('GET', '/api/baglantilar/yok/veritabanlari')).status).toBe(404);
    expect((await t.api('POST', '/api/baglantilar/yok/baglantiyi-kes')).status).toBe(404);
  });
});

describePg('veritabanı listesi ve pool yaşam döngüsü: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const EXTRA_DB = 'tezgah_test_liste';
  const EXTRA_SCHEMA = 'tezgah_raporlar';
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [EXTRA_DB]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${EXTRA_DB}`);
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${EXTRA_SCHEMA}`);
  });
  afterAll(async () => {
    await admin.end();
  });

  /** Tezgah'ın açtığı (bağlantı testi dışındaki) sunucu oturumları, veritabanına göre. */
  async function tezgahSessions(database?: string): Promise<number> {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE application_name = 'Tezgah' AND ($1::text IS NULL OR datname = $1)`,
      [database ?? null],
    );
    return rows[0]!.n;
  }

  /** Oturum kapanışı sunucuda eşzamansız görünür. */
  async function eventually(check: () => Promise<boolean>) {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('koşul sağlanmadı');
  }

  const list = (id: string) => t.api('GET', `/api/baglantilar/${id}/veritabanlari`);

  it('açılışta ve bağlantı kaydedilince hiçbir sunucuya bağlanmaz', async () => {
    await create(real);
    await t.api('GET', '/api/baglantilar');
    expect(await tezgahSessions()).toBe(0);
  });

  it('veritabanlarını başlangıç veritabanından, şablonlar hariç listeler', async () => {
    const id = await create(real);
    const res = await list(id);
    expect(res.status).toBe(200);
    expect(res.body.veritabanlari).toContain(EXTRA_DB);
    expect(res.body.veritabanlari).toContain(real.database);
    expect(res.body.veritabanlari).not.toContain('template0');
    expect(res.body.veritabanlari).not.toContain('template1');
    expect(await tezgahSessions(real.database)).toBe(1);
  });

  it('veritabanının şemalarını listeler; geçici oturum şemaları listede yok', async () => {
    const id = await create(real);
    const res = await t.api('GET', `/api/baglantilar/${id}/veritabanlari/${real.database}/semalar`);
    expect(res.status).toBe(200);
    expect(res.body.semalar).toEqual(expect.arrayContaining(['information_schema', 'pg_catalog', 'public', EXTRA_SCHEMA]));
    expect(res.body.semalar.some((s: string) => s.startsWith('pg_temp_') || s.startsWith('pg_toast_temp_'))).toBe(false);
    expect(await tezgahSessions(real.database)).toBe(1);
  });

  it('her hedef kendi pool\'unu açar', async () => {
    const id = await create(real);
    await list(id);
    expect((await t.api('GET', `/api/baglantilar/${id}/veritabanlari/${EXTRA_DB}/semalar`)).status).toBe(200);
    expect(await tezgahSessions(EXTRA_DB)).toBe(1);
    expect(await tezgahSessions(real.database)).toBe(1);
  });

  it('pool 10 dk boşta kalınca kapanır; sonraki istek yeniden açar', async () => {
    const id = await create(real);
    await list(id);
    clock.advance(IDLE_MS - 1);
    expect(await tezgahSessions(real.database)).toBe(1);
    clock.advance(1);
    await eventually(async () => (await tezgahSessions(real.database)) === 0);

    expect((await list(id)).status).toBe(200);
    expect(await tezgahSessions(real.database)).toBe(1);
  });

  it('kullanım boşta kalma süresini baştan başlatır', async () => {
    const id = await create(real);
    await list(id);
    clock.advance(IDLE_MS - 60_000);
    await list(id);
    clock.advance(IDLE_MS - 60_000);
    expect(await tezgahSessions(real.database)).toBe(1);
  });

  it('"Bağlantıyı kes" bağlantının tüm pool\'larını kapatır', async () => {
    const id = await create(real);
    await list(id);
    await t.api('GET', `/api/baglantilar/${id}/veritabanlari/${EXTRA_DB}/semalar`);
    expect((await t.api('POST', `/api/baglantilar/${id}/baglantiyi-kes`)).status).toBe(200);
    await eventually(async () => (await tezgahSessions()) === 0);
  });

  it('ad ya da klasör değişince pool açık kalır', async () => {
    const id = await create(real);
    await list(id);
    const { body: folder } = await t.api('POST', '/api/klasorler', { name: 'Billing' });
    const { password: _password, ...withoutPassword } = real;
    await t.api('PUT', `/api/baglantilar/${id}`, { ...withoutPassword, name: 'Yeni ad', folderId: folder.id });
    expect(await tezgahSessions(real.database)).toBe(1);
  });

  it('bağlanma ayarı ya da şifre değişince, ya da bağlantı silinince pool\'ları kapanır', async () => {
    const id = await create(real);
    await list(id);
    await t.api('PUT', `/api/baglantilar/${id}`, { name: 'Yerel', ...real });
    await eventually(async () => (await tezgahSessions()) === 0);
    await list(id);
    const { password: _password, ...withoutPassword } = real;
    await t.api('PUT', `/api/baglantilar/${id}`, { ...withoutPassword, name: 'Yerel', sslmode: 'disable' });
    await eventually(async () => (await tezgahSessions()) === 0);
    await list(id);
    await t.api('DELETE', `/api/baglantilar/${id}`);
    await eventually(async () => (await tezgahSessions()) === 0);
  });

  it('kimlik doğrulama hatası SQLSTATE ile döner; düzeltilince yeniden denenir', async () => {
    const id = await create({ ...real, password: 'yanlis' });
    const failed = await list(id);
    expect(failed.status).toBe(502);
    expect(failed.body.kod).toBe('28P01');
    await t.api('PUT', `/api/baglantilar/${id}`, { name: 'Yerel', ...real });
    expect((await list(id)).status).toBe(200);
  });

  it('keychain\'de şifre yoksa şifre gerekli hatası döner', async () => {
    const id = await create({ ...real, password: undefined });
    const res = await list(id);
    expect(res.status).toBe(502);
    expect(res.body.kod).toBe('sifreGerekli');
  });

  it('sunucu kapanınca pool\'lar kapanır', async () => {
    const id = await create(real);
    await list(id);
    await t.close();
    await eventually(async () => (await tezgahSessions()) === 0);
    t = await startTestServer({ clock });
  });
});
