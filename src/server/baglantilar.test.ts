import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './test/sunucu';
import { SETTINGS_VERSION } from '../core/ayarlar';

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

async function api(method: string, path: string, body?: unknown) {
  const res = await t.authed(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.body ? JSON.parse(res.body) : undefined };
}

async function settingsFile() {
  return JSON.parse(await readFile(join(t.configDir, 'tezgah.json'), 'utf8'));
}

const input = {
  name: 'Yerel',
  host: 'localhost',
  user: 'postgres',
  password: 'gizli-sifre',
  envTag: 'dev',
};

describe('bağlantı oluşturma', () => {
  it('bağlantı listede görünür, ayara yazılır, şifre yalnızca keychain\'e gider', async () => {
    const created = await api('POST', '/api/baglantilar', input);
    expect(created.status).toBe(201);
    const id = created.body.connection.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body.password).toBe('kaydedildi');

    const list = await api('GET', '/api/baglantilar');
    expect(list.body).toEqual([
      {
        id,
        name: 'Yerel',
        folderId: null,
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        database: 'postgres',
        envTag: 'dev',
        color: '#16a34a',
        savePassword: true,
        sslmode: 'prefer',
        sslrootcert: null,
        sslcert: null,
        sslkey: null,
        ssh: null,
        databaseSelection: [{ database: 'postgres', schemas: null }],
      },
    ]);

    const file = await settingsFile();
    expect(file).toEqual({ version: SETTINGS_VERSION, folders: [], connections: list.body });
    const raw = await readFile(join(t.configDir, 'tezgah.json'), 'utf8');
    expect(raw).not.toContain('gizli-sifre');
    expect(t.keychain.entries.get(id)).toBe('gizli-sifre');
  });
});

describe('bağlantı güncelleme', () => {
  it('alanları değiştirir; kimlik ve Veritabanı seçimi korunur, şifre verilmezse dokunulmaz', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    const updated = await api('PUT', `/api/baglantilar/${connection.id}`, {
      name: 'Prod',
      host: 'db.example',
      port: 6432,
      user: 'app',
      database: 'uygulama',
      envTag: 'prod',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({
      connection: {
        ...connection,
        name: 'Prod',
        host: 'db.example',
        port: 6432,
        user: 'app',
        database: 'uygulama',
        envTag: 'prod',
        color: '#dc2626',
      },
      password: 'degismedi',
      sshSecret: 'degismedi',
    });
    expect((await settingsFile()).connections).toEqual([updated.body.connection]);
    expect(t.keychain.entries.get(connection.id)).toBe('gizli-sifre');
  });

  it('yeni şifreyi keychain\'e yazar, boş şifre kayıtlıyı siler', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    const path = `/api/baglantilar/${connection.id}`;
    expect((await api('PUT', path, { ...input, password: 'yeni' })).body.password).toBe('kaydedildi');
    expect(t.keychain.entries.get(connection.id)).toBe('yeni');
    expect((await api('PUT', path, { ...input, password: '' })).body.password).toBe('silindi');
    expect(t.keychain.entries.has(connection.id)).toBe(false);
  });

  it('keychain\'e kaydetme kapatılınca kayıtlı şifre silinir ve gelen şifre yazılmaz', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    const res = await api('PUT', `/api/baglantilar/${connection.id}`, { ...input, savePassword: false });
    expect(res.body.password).toBe('silindi');
    expect(res.body.connection.savePassword).toBe(false);
    expect(t.keychain.entries.size).toBe(0);
  });

  it('SSL ayarlarını (sslmode ve dosya yolları) saklar; dosyaların kendisine dokunmaz', async () => {
    const created = await api('POST', '/api/baglantilar', input);
    const ssl = { sslmode: 'verify-full', sslrootcert: '/etc/ssl/ca.pem', sslcert: '~/c.crt', sslkey: '~/c.key' };
    const updated = await api('PUT', `/api/baglantilar/${created.body.connection.id}`, { ...input, ...ssl });
    expect(updated.body.connection).toMatchObject(ssl);
    expect((await settingsFile()).connections[0]).toMatchObject(ssl);
  });

  it('olmayan bağlantı 404 döner', async () => {
    expect((await api('PUT', '/api/baglantilar/yok', input)).status).toBe(404);
  });
});

describe('bağlantı silme', () => {
  it('ayardan ve keychain\'den siler', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    const other = (await api('POST', '/api/baglantilar', { ...input, name: 'Diğer' })).body.connection;
    const res = await api('DELETE', `/api/baglantilar/${connection.id}`);
    expect(res).toEqual({ status: 200, body: { password: 'silindi', sshSecret: 'yok' } });
    expect((await api('GET', '/api/baglantilar')).body).toEqual([other]);
    expect((await settingsFile()).connections).toEqual([other]);
    expect([...t.keychain.entries.keys()]).toEqual([other.id]);
  });

  it('keychain\'de şifresi olmayan bağlantı da silinir', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', { ...input, password: undefined })).body;
    expect((await api('DELETE', `/api/baglantilar/${connection.id}`)).body).toEqual({ password: 'yok', sshSecret: 'yok' });
  });

  it('olmayan bağlantı 404 döner', async () => {
    expect((await api('DELETE', '/api/baglantilar/yok')).status).toBe(404);
  });
});

describe('kayıtlı şifre bilgisi', () => {
  it('değeri değil yalnızca kayıtlı olup olmadığını döndürür', async () => {
    const withPw = (await api('POST', '/api/baglantilar', input)).body.connection;
    const withoutPw = (await api('POST', '/api/baglantilar', { ...input, password: undefined })).body.connection;
    const res = await t.authed(`/api/baglantilar/${withPw.id}/sifre`);
    expect(JSON.parse(res.body)).toEqual({ password: 'bulundu', sshSecret: 'yok' });
    expect(res.body).not.toContain('gizli-sifre');
    expect((await api('GET', `/api/baglantilar/${withoutPw.id}/sifre`)).body).toEqual({ password: 'yok', sshSecret: 'yok' });
  });

  it('olmayan bağlantı 404 döner', async () => {
    expect((await api('GET', '/api/baglantilar/yok/sifre')).status).toBe(404);
  });

  it('hiçbir yanıt şifre değerini içermez', async () => {
    const created = await t.authed('/api/baglantilar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const list = await t.authed('/api/baglantilar');
    for (const res of [created, list]) expect(res.body).not.toContain('gizli-sifre');
  });
});

describe('keychain erişimi reddedilince ("Deny")', () => {
  it('kayıtlı şifre bilgisi "yok"tan ayrı olarak reddedildi döner', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    t.keychain.deny = true;
    expect((await api('GET', `/api/baglantilar/${connection.id}/sifre`)).body).toEqual({ password: 'reddedildi', sshSecret: 'yok' });
  });

  it('bağlantı kaydedilir ama şifre sonucu reddedildi olur', async () => {
    t.keychain.deny = true;
    const created = await api('POST', '/api/baglantilar', input);
    expect(created.status).toBe(201);
    expect(created.body.password).toBe('reddedildi');
    expect((await settingsFile()).connections).toHaveLength(1);

    const updated = await api('PUT', `/api/baglantilar/${created.body.connection.id}`, { ...input, password: '' });
    expect(updated.body.password).toBe('reddedildi');
  });

  it('silmede ayar silinir, keychain sonucu reddedildi olarak bildirilir', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    t.keychain.deny = true;
    expect((await api('DELETE', `/api/baglantilar/${connection.id}`)).body).toEqual({ password: 'reddedildi', sshSecret: 'reddedildi' });
    expect((await settingsFile()).connections).toEqual([]);
  });
});

describe('doğrulama', () => {
  it('geçersiz girdi alan hatalarıyla 400 döner ve hiçbir şey yazılmaz', async () => {
    const res = await api('POST', '/api/baglantilar', { ...input, name: '', port: 0 });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.alanlar).sort()).toEqual(['name', 'port']);
    expect(await readdir(t.configDir).catch(() => [])).toEqual([]);
    expect(t.keychain.entries.size).toBe(0);
  });

  it('olmayan klasöre bağlantı eklenemez', async () => {
    const res = await api('POST', '/api/baglantilar', { ...input, folderId: 'yok' });
    expect(res.status).toBe(400);
    expect(res.body.alanlar).toHaveProperty('folderId');
  });

  it('JSON olmayan gövde reddedilir', async () => {
    const res = await t.authed('/api/baglantilar', { method: 'POST', body: 'name=x' });
    expect(res.status).toBe(415);
    const bad = await t.authed('/api/baglantilar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(bad.status).toBe(400);
  });
});

describe('ayar dosyası', () => {
  it('eşzamanlı yazmalarda hiçbir bağlantı kaybolmaz ve geride geçici dosya kalmaz', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `B${i}`);
    await Promise.all(names.map((name) => api('POST', '/api/baglantilar', { ...input, name })));
    const file = await settingsFile();
    expect(file.connections.map((c: { name: string }) => c.name).sort()).toEqual([...names].sort());
    expect(await readdir(t.configDir)).toEqual(['tezgah.json']);
  });

  it('yazma sırasında okuyan biri hiçbir zaman yarım dosya görmez', async () => {
    await api('POST', '/api/baglantilar', input);
    let reading = true;
    const partial: string[] = [];
    const reader = (async () => {
      while (reading) {
        const text = await readFile(join(t.configDir, 'tezgah.json'), 'utf8').catch(() => null);
        if (text === null) continue; // Windows'ta rename anında kısa süre açılamayabilir.
        try {
          JSON.parse(text);
        } catch {
          partial.push(text);
        }
      }
    })();
    for (let i = 0; i < 15; i++) await api('POST', '/api/baglantilar', { ...input, name: `B${i}`, host: 'h'.repeat(5000) });
    reading = false;
    await reader;
    expect(partial).toEqual([]);
  });

  it('bozuk dosyanın üzerine yazılmaz, hata nedeniyle bildirilir', async () => {
    await mkdir(t.configDir, { recursive: true });
    await writeFile(join(t.configDir, 'tezgah.json'), '{ bozuk');
    const list = await api('GET', '/api/baglantilar');
    expect(list.status).toBe(500);
    expect(list.body.hata).toMatch(/tezgah\.json/);
    expect((await api('POST', '/api/baglantilar', input)).status).toBe(500);
    expect(await readFile(join(t.configDir, 'tezgah.json'), 'utf8')).toBe('{ bozuk');
    expect(t.keychain.entries.size).toBe(0);
  });

  it('daha yeni sürümün yazdığı dosyaya dokunulmaz', async () => {
    await mkdir(t.configDir, { recursive: true });
    const newer = JSON.stringify({ version: 99, folders: [], connections: [] });
    await writeFile(join(t.configDir, 'tezgah.json'), newer);
    const res = await api('POST', '/api/baglantilar', input);
    expect(res.status).toBe(500);
    expect(res.body.hata).toMatch(/daha yeni/);
    expect(await readFile(join(t.configDir, 'tezgah.json'), 'utf8')).toBe(newer);
  });
});

describe('bağlantı kopyalama', () => {
  it('hemen yanına "ad (kopya)" oluşturur, alanlar ve Veritabanı seçimi aynı, şifre yeni kimliğe kopyalanır', async () => {
    const folder = (await t.api('POST', '/api/klasorler', { name: 'Billing' })).body;
    const first = (await api('POST', '/api/baglantilar', { ...input, folderId: folder.id })).body.connection;
    const last = (await api('POST', '/api/baglantilar', { ...input, name: 'Son' })).body.connection;

    const copied = await api('POST', `/api/baglantilar/${first.id}/kopya`);
    expect(copied.status).toBe(201);
    const copy = copied.body.connection;
    expect(copied.body).toEqual({
      connection: { ...first, id: expect.not.stringMatching(first.id), name: 'Yerel (kopya)' },
      password: 'kaydedildi',
      sshSecret: 'degismedi',
    });
    expect((await api('GET', '/api/baglantilar')).body).toEqual([first, copy, last]);
    expect(t.keychain.entries.get(copy.id)).toBe('gizli-sifre');
    expect(t.keychain.entries.get(first.id)).toBe('gizli-sifre');
  });

  it('kopyanın kopyası ve tekrarlı kopya adları çakışmaz', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    const names = [];
    for (let i = 0; i < 2; i++) names.push((await api('POST', `/api/baglantilar/${connection.id}/kopya`)).body.connection.name);
    expect(names).toEqual(['Yerel (kopya)', 'Yerel (kopya 2)']);
  });

  it('kayıtlı şifresi olmayan ya da keychain\'e kaydetmeyen bağlantıda keychain\'e yazılmaz', async () => {
    const noPw = (await api('POST', '/api/baglantilar', { ...input, password: undefined })).body.connection;
    const session = (await api('POST', '/api/baglantilar', { ...input, savePassword: false })).body.connection;
    expect((await api('POST', `/api/baglantilar/${noPw.id}/kopya`)).body.password).toBe('degismedi');
    expect((await api('POST', `/api/baglantilar/${session.id}/kopya`)).body.password).toBe('degismedi');
    expect(t.keychain.entries.size).toBe(0);
  });

  it('keychain reddederse kopya yine oluşur, sonuç reddedildi olur', async () => {
    const { connection } = (await api('POST', '/api/baglantilar', input)).body;
    t.keychain.deny = true;
    const copied = await api('POST', `/api/baglantilar/${connection.id}/kopya`);
    expect(copied.status).toBe(201);
    expect(copied.body.password).toBe('reddedildi');
    expect((await settingsFile()).connections).toHaveLength(2);
  });

  it('olmayan bağlantı 404 döner', async () => {
    expect((await api('POST', '/api/baglantilar/yok/kopya')).status).toBe(404);
  });
});
