import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

async function settingsFile() {
  return JSON.parse(await readFile(join(t.configDir, 'tezgah.json'), 'utf8'));
}

const connectionInput = { name: 'Yerel', host: 'localhost', user: 'postgres' };

describe('klasör oluşturma', () => {
  it('klasör listede görünür ve ayara yazılır; ad kırpılır', async () => {
    expect((await t.api('GET', '/api/klasorler')).body).toEqual([]);
    const created = await t.api('POST', '/api/klasorler', { name: '  Müşteri A ' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Müşteri A' });
    expect((await t.api('GET', '/api/klasorler')).body).toEqual([created.body]);
    expect((await settingsFile()).folders).toEqual([created.body]);
  });

  it('boş ad ve aynı adlı ikinci klasör reddedilir', async () => {
    await t.api('POST', '/api/klasorler', { name: 'Billing' });
    const empty = await t.api('POST', '/api/klasorler', { name: '  ' });
    expect(empty.status).toBe(400);
    expect(empty.body.hata).toMatch(/ad/i);
    const duplicate = await t.api('POST', '/api/klasorler', { name: 'billing' });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.hata).toMatch(/zaten var/);
    expect((await t.api('GET', '/api/klasorler')).body).toHaveLength(1);
  });
});

describe('klasör yeniden adlandırma', () => {
  it('adı değiştirir, kimlik ve içindeki bağlantılar korunur', async () => {
    const folder = (await t.api('POST', '/api/klasorler', { name: 'Eski' })).body;
    const conn = (await t.api('POST', '/api/baglantilar', { ...connectionInput, folderId: folder.id })).body.connection;
    const renamed = await t.api('PUT', `/api/klasorler/${folder.id}`, { name: 'Yeni' });
    expect(renamed).toEqual({ status: 200, body: { id: folder.id, name: 'Yeni' } });
    expect((await t.api('GET', '/api/baglantilar')).body).toEqual([conn]);
  });

  it('kendi adını (büyük/küçük harf değiştirerek) almak serbest; başka klasörün adı değil', async () => {
    const a = (await t.api('POST', '/api/klasorler', { name: 'Alfa' })).body;
    await t.api('POST', '/api/klasorler', { name: 'Beta' });
    expect((await t.api('PUT', `/api/klasorler/${a.id}`, { name: 'ALFA' })).status).toBe(200);
    expect((await t.api('PUT', `/api/klasorler/${a.id}`, { name: 'beta' })).status).toBe(400);
  });

  it('olmayan klasör 404 döner', async () => {
    expect((await t.api('PUT', '/api/klasorler/yok', { name: 'X' })).status).toBe(404);
  });
});

describe('klasör silme', () => {
  it('klasörü siler, içindeki bağlantılar silinmez, Klasörsüz’e taşınır', async () => {
    const folder = (await t.api('POST', '/api/klasorler', { name: 'Geçici' })).body;
    const other = (await t.api('POST', '/api/klasorler', { name: 'Kalıcı' })).body;
    const inside = (await t.api('POST', '/api/baglantilar', { ...connectionInput, folderId: folder.id })).body.connection;
    const elsewhere = (await t.api('POST', '/api/baglantilar', { ...connectionInput, folderId: other.id })).body
      .connection;

    expect(await t.api('DELETE', `/api/klasorler/${folder.id}`)).toEqual({ status: 200, body: { tasinan: 1 } });
    expect((await t.api('GET', '/api/klasorler')).body).toEqual([other]);
    expect((await t.api('GET', '/api/baglantilar')).body).toEqual([{ ...inside, folderId: null }, elsewhere]);
    expect((await settingsFile()).connections).toHaveLength(2);
  });

  it('olmayan klasör 404 döner', async () => {
    expect((await t.api('DELETE', '/api/klasorler/yok')).status).toBe(404);
  });
});
