import { access } from 'node:fs/promises';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { join } from 'node:path';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionTestResponse, TestStep } from '../core/baglanti-testi';
import { describePg, pgUrl, startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

const PATH = '/api/baglanti-testi';

async function runTest(body: unknown): Promise<ConnectionTestResponse> {
  const res = await t.api('POST', PATH, body);
  expect(res.status).toBe(200);
  return res.body;
}

const results = (r: ConnectionTestResponse) => r.adimlar.map((s) => [s.id, s.sonuc]);
const step = (r: ConnectionTestResponse, id: TestStep['id']) => r.adimlar.find((s) => s.id === id)!;

/** Dinlenmeyen bir port: bir an açılıp kapatılır. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Postgres olmayan bir TCP dinleyici: ulaşma adımı geçer. */
async function listening(): Promise<{ port: number; server: Server }> {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe('bağlantı testi: girdi', () => {
  it('geçersiz girdide alan hatalarıyla 400 döner ve hiçbir yere bağlanmaz', async () => {
    const res = await t.api('POST', PATH, { host: '', user: 'u', port: 0 });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.alanlar).sort()).toEqual(['host', 'port']);
  });

  it('yalnızca POST kabul eder', async () => {
    expect((await t.api('GET', PATH)).status).toBe(405);
  });
});

describe('bağlantı testi: ulaşılamayan sunucu', () => {
  it('kapalı portta ulaşma adımında durur, Port alanını ve düzeltmeyi işaret eder', async () => {
    const port = await closedPort();
    const r = await runTest({ host: '127.0.0.1', port, user: 'postgres', password: 'x' });
    expect(results(r)).toEqual([
      ['ulasma', 'hata'],
      ['tls', 'calistirilmadi'],
      ['kimlik', 'calistirilmadi'],
      ['listeleme', 'calistirilmadi'],
    ]);
    expect(step(r, 'ulasma')).toMatchObject({ kod: 'ECONNREFUSED', alan: 'port', oneriler: ['portuDuzelt', 'tekrarDene'] });
    expect(r.sunucu).toBeNull();
  });

  it('ssh adımı tünel yokken listede yok; şifre yazıldıysa sırlar adımı da yok', async () => {
    const r = await runTest({ host: '127.0.0.1', port: await closedPort(), user: 'postgres', password: 'x' });
    expect(r.adimlar.map((s) => s.id)).not.toContain('ssh');
    expect(r.adimlar.map((s) => s.id)).not.toContain('sirlar');
  });
});

describe('bağlantı testi: sırlar', () => {
  async function savedConnection(password?: string) {
    const created = await t.api('POST', '/api/baglantilar', { name: 'Yerel', host: '127.0.0.1', user: 'postgres', password });
    return created.body.connection.id as string;
  }

  it('keychain "Deny" derse sırlar adımında durur', async () => {
    const id = await savedConnection('gizli');
    t.keychain.deny = true;
    const r = await runTest({ connectionId: id, host: '127.0.0.1', port: await closedPort(), user: 'postgres' });
    expect(results(r)).toEqual([
      ['sirlar', 'hata'],
      ['ulasma', 'calistirilmadi'],
      ['tls', 'calistirilmadi'],
      ['kimlik', 'calistirilmadi'],
      ['listeleme', 'calistirilmadi'],
    ]);
    expect(step(r, 'sirlar')).toMatchObject({ kod: 'reddedildi', alan: 'password' });
  });

  it('keychain\'de sır yoksa "Deny"dan ayrı bir uyarıyla devam eder', async () => {
    const id = await savedConnection();
    const r = await runTest({ connectionId: id, host: '127.0.0.1', port: await closedPort(), user: 'postgres' });
    expect(step(r, 'sirlar')).toMatchObject({ sonuc: 'uyari', kod: 'sirYok' });
    expect(step(r, 'ulasma').sonuc).toBe('hata');
  });

  it('kayıtlı sır okunursa sırlar adımı başarılıdır', async () => {
    const id = await savedConnection('gizli');
    const r = await runTest({ connectionId: id, host: '127.0.0.1', port: await closedPort(), user: 'postgres' });
    expect(step(r, 'sirlar').sonuc).toBe('basarili');
  });

  it('"Keychain\'e kaydet" kapalıysa keychain\'e hiç dokunmaz', async () => {
    const id = await savedConnection('gizli');
    t.keychain.deny = true;
    const r = await runTest({ connectionId: id, savePassword: false, host: '127.0.0.1', port: await closedPort(), user: 'u' });
    expect(r.adimlar[0]!.id).toBe('ulasma');
  });
});

describe('bağlantı testi: TLS', () => {
  it('bu sürümde desteklenmeyen sslmode TLS adımında hata verir', async () => {
    const { port, server } = await listening();
    try {
      const r = await runTest({ host: '127.0.0.1', port, user: 'u', password: 'x', sslmode: 'verify-full' });
      expect(results(r)).toEqual([
        ['ulasma', 'basarili'],
        ['tls', 'hata'],
        ['kimlik', 'calistirilmadi'],
        ['listeleme', 'calistirilmadi'],
      ]);
      expect(step(r, 'tls').kod).toBe('sslmodeDesteklenmiyor');
    } finally {
      server.close();
    }
  });
});

describe('bağlantı testi: hiçbir şey kaydedilmez', () => {
  it('ayar dosyası oluşmaz, keychain\'e yazılmaz', async () => {
    await runTest({ host: '127.0.0.1', port: await closedPort(), user: 'postgres', password: 'gizli' });
    expect(await exists(join(t.configDir, 'tezgah.json'))).toBe(false);
    expect(t.keychain.entries.size).toBe(0);
  });
});

describePg('bağlantı testi: gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };

  it('başarıda tüm adımlar geçer; sürüm ve veritabanı sayısı döner', async () => {
    const r = await runTest(real);
    expect(results(r)).toEqual([
      ['ulasma', 'basarili'],
      ['tls', expect.stringMatching(/^(basarili|uyari)$/)],
      ['kimlik', 'basarili'],
      ['listeleme', 'basarili'],
    ]);
    expect(r.sunucu?.surum).toMatch(/^\d+/);
    expect(r.sunucu?.veritabaniSayisi).toBeGreaterThanOrEqual(1);
  });

  it('prefer: SSL varsa SSL ile, yoksa "require yap" önerisiyle uyarılı şifresiz bağlanır', async () => {
    const probe = new pg.Client({ ...real, ssl: { rejectUnauthorized: false } });
    const serverHasSsl = await probe.connect().then(
      () => true,
      (err: Error) => !/does not support SSL/.test(err.message),
    );
    await probe.end().catch(() => {});

    const tls = step(await runTest({ ...real, sslmode: 'prefer' }), 'tls');
    if (serverHasSsl) expect(tls).toMatchObject({ sonuc: 'basarili', kod: null });
    else expect(tls).toMatchObject({ sonuc: 'uyari', kod: 'sifresizDusus', oneriler: ['requireYap'] });
  });

  it('sslmode=disable ile de bağlanır', async () => {
    const r = await runTest({ ...real, sslmode: 'disable' });
    expect(step(r, 'tls').sonuc).toBe('basarili');
    expect(step(r, 'listeleme').sonuc).toBe('basarili');
  });

  it('yanlış şifrede kimlik adımında 28P01 ile durur', async () => {
    const r = await runTest({ ...real, password: `${real.password}-yanlis` });
    expect(step(r, 'kimlik')).toMatchObject({ sonuc: 'hata', kod: '28P01', alan: 'password' });
    expect(step(r, 'listeleme').sonuc).toBe('calistirilmadi');
  });

  it('sunucu şifre ister ama şifre yoksa yapısal "şifre gerekli" verir', async () => {
    const { password: _password, ...rest } = real;
    const r = await runTest({ ...rest, savePassword: false });
    expect(step(r, 'kimlik')).toMatchObject({ sonuc: 'hata', kod: 'sifreGerekli', oneriler: ['sifreGir'] });
  });

  it('olmayan veritabanında 3D000 ve "postgres kullan" önerisi', async () => {
    const r = await runTest({ ...real, database: 'tezgah_olmayan_veritabani' });
    expect(step(r, 'kimlik')).toMatchObject({
      sonuc: 'hata',
      kod: '3D000',
      alan: 'database',
      oneriler: ['postgresKullan', 'veritabaniniDuzelt'],
    });
  });

  it('kayıtlı bağlantının şifresini keychain\'den okuyup bağlanır', async () => {
    const created = await t.api('POST', '/api/baglantilar', { name: 'PG', ...real });
    const { password: _password, ...rest } = real;
    const r = await runTest({ ...rest, connectionId: created.body.connection.id });
    expect(step(r, 'sirlar').sonuc).toBe('basarili');
    expect(step(r, 'listeleme').sonuc).toBe('basarili');
  });
});
