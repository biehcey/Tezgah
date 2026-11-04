import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INDEX_HTML, startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

describe('web arayüzünün servisi', () => {
  it('uzantısız yollar arayüze düşer', async () => {
    const res = await t.authed('/baglantilar/123');
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('olmayan dosya 404 olur', async () => {
    expect((await t.authed('/yok.js')).status).toBe(404);
  });

  it.each(['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json'])(
    'web kökü dışına çıkılamaz: %s',
    async (path) => {
      const res = await t.authed(path);
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('"name"');
    },
  );

  it('bilinmeyen API yolu arayüze düşmez', async () => {
    const res = await t.authed('/api/yok');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
