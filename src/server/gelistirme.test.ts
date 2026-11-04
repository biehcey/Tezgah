import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './test/sunucu';

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
});

describe('geliştirme modu (Vite proxy)', () => {
  const devWebPort = 5999;

  it('tarayıcı URL\'i Vite portunu gösterir', async () => {
    t = await startTestServer({ devWebPort });
    expect(t.server.url).toBe(`http://127.0.0.1:${devWebPort}/?t=${t.server.token}`);
  });

  it('Vite portundan proxy\'lenen istekler ve WS kabul edilir', async () => {
    t = await startTestServer({ devWebPort });
    const host = `127.0.0.1:${devWebPort}`;
    const origin = `http://${host}`;
    expect((await t.request(`/?t=${t.server.token}`, { headers: { host } })).status).toBe(302);
    expect((await t.authed('/api/durum', { method: 'POST', headers: { host, origin } })).status).toBe(404);
    expect(await t.upgrade('/ws', { host, origin, cookie: t.cookie })).toBe('open');
  });

  it('dev portu verilmezse o port kabul edilmez', async () => {
    t = await startTestServer();
    const res = await t.authed('/api/durum', { headers: { host: `127.0.0.1:${devWebPort}` } });
    expect(res.status).toBe(403);
  });
});

describe('port', () => {
  it('varsayılan olarak rastgele port seçilir ve URL token içerir', async () => {
    t = await startTestServer();
    expect(t.server.port).toBeGreaterThan(0);
    expect(t.server.url).toBe(`http://127.0.0.1:${t.server.port}/?t=${t.server.token}`);
    // 32 bayt → base64url 43 karakter
    expect(t.server.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('her açılışta farklı token üretilir', async () => {
    t = await startTestServer();
    const other = await startTestServer();
    try {
      expect(other.server.token).not.toBe(t.server.token);
      expect(other.server.port).not.toBe(t.server.port);
    } finally {
      await other.close();
    }
  });

  it('sabit port verilirse o portta dinler', async () => {
    const port = await freePort();
    t = await startTestServer({ port });
    expect(t.server.port).toBe(port);
    expect((await t.authed('/api/durum')).status).toBe(200);
  });

  it('sabit port doluysa açılış hata verir', async () => {
    t = await startTestServer();
    await expect(startTestServer({ port: t.server.port })).rejects.toThrow(/EADDRINUSE/);
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject()));
    });
  });
}
