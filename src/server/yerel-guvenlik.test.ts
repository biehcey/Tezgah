import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

describe('erişim anahtarı → cookie', () => {
  it('doğru token cookie verir ve token\'sız URL\'e 302 ile yönlendirir', async () => {
    const res = await t.request(`/?t=${t.server.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toContain(`${t.server.cookieName}=${t.server.token}`);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Strict/i);
    expect(setCookie).toMatch(/;\s*Path=\/(;|$)/);
  });
});

describe('yanlış token', () => {
  it.each([
    ['farklı token', () => 'x'.repeat(43)],
    ['boş token', () => ''],
    ['token öneki', () => t.server.token.slice(0, 10)],
  ])('%s reddedilir ve cookie verilmez', async (_ad, token) => {
    const res = await t.request(`/?t=${token()}`);
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('cookie doğrulaması', () => {
  it.each(['/', '/app.js', '/api/durum'])('cookie\'siz %s reddedilir', async (path) => {
    const res = await t.request(path);
    expect(res.status).toBe(401);
  });

  it.each([
    ['yanlış değer', () => `${t.server.cookieName}=${'x'.repeat(43)}`],
    ['başka adla doğru değer', () => `tezgah=${t.server.token}`],
    ['boş değer', () => `${t.server.cookieName}=`],
  ])('%s ile reddedilir', async (_ad, cookie) => {
    const res = await t.request('/', { headers: { cookie: cookie() } });
    expect(res.status).toBe(401);
  });

  it('geçerli cookie ile arayüz servis edilir', async () => {
    const index = await t.authed('/');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toMatch(/^text\/html/);
    expect(index.body).toContain('<div id="root">');

    const js = await t.authed('/app.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
  });

  it('token değişiminden gelen cookie sonraki isteklerde geçerlidir', async () => {
    const exchange = await t.request(`/?t=${t.server.token}`);
    const cookie = (exchange.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const res = await t.request('/', { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it('API durumu döner', async () => {
    const res = await t.authed('/api/durum');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ uygulama: 'tezgah' });
  });
});

describe('Host başlığı', () => {
  const wrongHosts = () => [
    `evil.example:${t.server.port}`,
    `127.0.0.1:${t.server.port + 1}`,
    '127.0.0.1',
    'localhost',
    `0.0.0.0:${t.server.port}`,
    `[::1]:${t.server.port}`,
    `127.0.0.1.evil.example:${t.server.port}`,
  ];

  it('yanlış Host ile geçerli cookie de reddedilir', async () => {
    for (const host of wrongHosts()) {
      const res = await t.authed('/api/durum', { headers: { host } });
      expect(res.status, host).toBe(403);
    }
  });

  it('yanlış Host ile token değişimi yapılmaz', async () => {
    for (const host of wrongHosts()) {
      const res = await t.request(`/?t=${t.server.token}`, { headers: { host } });
      expect(res.status, host).toBe(403);
      expect(res.headers['set-cookie'], host).toBeUndefined();
    }
  });

  it('localhost:<port> kabul edilir', async () => {
    const host = `localhost:${t.server.port}`;
    const res = await t.authed('/api/durum', { headers: { host, origin: `http://${host}` } });
    expect(res.status).toBe(200);
  });
});

describe('Origin (CSRF)', () => {
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'];

  it.each(stateChanging)('%s Origin olmadan reddedilir', async (method) => {
    const res = await t.request('/api/durum', { method, headers: { cookie: t.cookie } });
    expect(res.status).toBe(403);
  });

  it.each(stateChanging)('%s başka origin ile reddedilir', async (method) => {
    for (const origin of [
      'http://evil.example',
      'null',
      `http://127.0.0.1:${t.server.port + 1}`,
      `https://127.0.0.1:${t.server.port}`,
      `http://localhost:${t.server.port}`, // Host 127.0.0.1 iken farklı origin
    ]) {
      const res = await t.authed('/api/durum', { method, headers: { origin } });
      expect(res.status, origin).toBe(403);
    }
  });

  it.each(stateChanging)('%s aynı origin ile güvenlik katmanından geçer', async (method) => {
    const res = await t.authed('/api/durum', { method });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('GET başka origin\'den gelse de cookie varsa okunur (durum değiştirmez)', async () => {
    const res = await t.request('/api/durum', { headers: { cookie: t.cookie } });
    expect(res.status).toBe(200);
  });
});

describe('CORS', () => {
  it('hiçbir yanıtta CORS başlığı yok', async () => {
    const evil = { origin: 'http://evil.example' };
    const responses = await Promise.all([
      t.request(`/?t=${t.server.token}`, { headers: evil }),
      t.request('/', { headers: evil }),
      t.authed('/', { headers: evil }),
      t.authed('/api/durum', { headers: evil }),
      t.authed('/api/durum', { method: 'OPTIONS', headers: { ...evil, 'access-control-request-method': 'POST' } }),
      t.request('/api/durum', { method: 'OPTIONS', headers: { ...evil, 'access-control-request-method': 'POST' } }),
      t.authed('/api/durum', { method: 'POST', headers: evil }),
    ]);
    for (const res of responses) {
      const cors = Object.keys(res.headers).filter((h) => h.startsWith('access-control-'));
      expect(cors).toEqual([]);
    }
  });
});

describe('WebSocket upgrade', () => {
  it('geçerli cookie, Host ve aynı origin ile açılır', async () => {
    expect(await t.upgrade('/ws', { cookie: t.cookie, origin: t.origin })).toBe('open');
  });

  it('cookie\'siz ya da yanlış cookie ile reddedilir', async () => {
    expect(await t.upgrade('/ws', { origin: t.origin })).toBe(401);
    expect(await t.upgrade('/ws', { origin: t.origin, cookie: `${t.server.cookieName}=yanlis` })).toBe(401);
  });

  it('Origin olmadan ya da başka origin ile reddedilir', async () => {
    expect(await t.upgrade('/ws', { cookie: t.cookie })).toBe(403);
    expect(await t.upgrade('/ws', { cookie: t.cookie, origin: 'http://evil.example' })).toBe(403);
  });

  it('yanlış Host ile reddedilir', async () => {
    const host = `evil.example:${t.server.port}`;
    expect(await t.upgrade('/ws', { cookie: t.cookie, origin: `http://${host}`, host })).toBe(403);
  });

  it('bilinmeyen yol reddedilir', async () => {
    expect(await t.upgrade('/baska', { cookie: t.cookie, origin: t.origin })).toBe(404);
  });

  it('token sorgu parametresi WS\'de cookie yerine geçmez', async () => {
    expect(await t.upgrade(`/ws?t=${t.server.token}`, { origin: t.origin })).toBe(401);
  });
});

describe('dinleme adresi', () => {
  it('yalnızca 127.0.0.1\'de dinler; ::1 üzerinden bağlantı kurulamaz', async () => {
    const result = await new Promise<string>((resolve) => {
      const socket = connect({ host: '::1', port: t.server.port });
      socket.on('connect', () => {
        socket.destroy();
        resolve('bağlandı');
      });
      socket.on('error', () => resolve('reddedildi'));
    });
    expect(result).toBe('reddedildi');
  });
});

describe('token değişimi yanıtı', () => {
  it('token\'lı URL önbelleğe alınmaz ve Referer ile sızdırılmaz', async () => {
    const res = await t.request(`/?t=${t.server.token}`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
