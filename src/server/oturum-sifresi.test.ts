import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
let pg: FakePostgres;
beforeEach(async () => {
  pg = await startFakePostgres({ password: 'gizli' });
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
  await pg.close();
});

/** Keychain'e kaydedilmeyen (oturumluk şifreli) bağlantı. */
async function createSessionConnection(): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', {
    name: 'Prod',
    host: '127.0.0.1',
    port: pg.port,
    user: 'postgres',
    sslmode: 'disable',
    savePassword: false,
  });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}

const list = (id: string) => t.api('GET', `/api/baglantilar/${id}/veritabanlari`);
const givePassword = (id: string, body: unknown) => t.api('POST', `/api/baglantilar/${id}/oturum-sifresi`, body);

describe('oturumluk şifre', () => {
  it('sırrı olmayan bağlantı yapısal "şifre gerekli" hatası döner; verilen şifreyle bağlanır', async () => {
    const id = await createSessionConnection();
    const first = await list(id);
    expect(first.status).toBe(502);
    expect(first.body.kod).toBe('sifreGerekli');

    const given = await givePassword(id, { password: 'gizli' });
    expect(given.status).toBe(200);
    expect(given.body).toMatchObject({ password: 'oturumda', connection: { id, savePassword: false } });

    const second = await list(id);
    expect(second.status).toBe(200);
    expect(second.body.veritabanlari).toEqual(['postgres']);
  });

  it('sunucu şifreyi reddedince (28P01) şifre unutulur ve yeniden sorulur', async () => {
    const id = await createSessionConnection();
    await givePassword(id, { password: 'yanlis' });

    const rejected = await list(id);
    expect(rejected.status).toBe(502);
    expect(rejected.body.kod).toBe('28P01');

    // Reddedilen şifre bir daha denenmez: sunucu yeniden şifre ister.
    const again = await list(id);
    expect(again.body.kod).toBe('sifreGerekli');
    expect(pg.attempts).toEqual(['yanlis']);

    await givePassword(id, { password: 'gizli' });
    expect((await list(id)).status).toBe(200);
  });

  it('bağlantı kesilince ya da düşünce şifre yeniden sorulmaz', async () => {
    const id = await createSessionConnection();
    await givePassword(id, { password: 'gizli' });
    expect((await list(id)).status).toBe(200);

    expect((await t.api('POST', `/api/baglantilar/${id}/baglantiyi-kes`)).status).toBe(200);
    expect((await list(id)).status).toBe(200);

    pg.dropSessions();
    expect((await list(id)).status).toBe(200);
    expect(pg.attempts.every((p) => p === 'gizli')).toBe(true);
  });

  it("pencereden \"Keychain'e kaydet\" seçilince şifre keychain'e yazılır ve bağlantı ayarı değişir", async () => {
    const id = await createSessionConnection();
    const given = await givePassword(id, { password: 'gizli', saveToKeychain: true });
    expect(given.body).toMatchObject({ password: 'kaydedildi', connection: { savePassword: true } });
    expect(t.keychain.entries.get(id)).toBe('gizli');
    expect((await t.api('GET', '/api/baglantilar')).body[0].savePassword).toBe(true);
    expect((await list(id)).status).toBe(200);
  });

  it('keychain reddederse şifre bellekte kalır ve ayar değişmez', async () => {
    const id = await createSessionConnection();
    t.keychain.deny = true;
    const given = await givePassword(id, { password: 'gizli', saveToKeychain: true });
    expect(given.body).toMatchObject({ password: 'reddedildi', connection: { savePassword: false } });
    expect((await t.api('GET', '/api/baglantilar')).body[0].savePassword).toBe(false);
    expect((await list(id)).status).toBe(200);
  });

  it('boş şifre 400, bilinmeyen bağlantı 404 döner', async () => {
    const id = await createSessionConnection();
    expect((await givePassword(id, { password: '' })).status).toBe(400);
    expect((await givePassword(id, { password: 'x', saveToKeychain: 'evet' })).status).toBe(400);
    expect((await givePassword('yok', { password: 'x' })).status).toBe(404);
  });
});
