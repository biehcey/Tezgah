import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClock, type FakeClock } from './test/sahte-saat';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { HOST_KEY, HOST_KEY_FP, OTHER_HOST_KEY, OTHER_HOST_KEY_FP, createFakeSsh, type FakeSsh } from './test/sahte-tunel';
import { startTestServer, type TestServer } from './test/sunucu';

let t: TestServer;
let pg: FakePostgres;
let ssh: FakeSsh;
let clock: FakeClock;
let home: string;

const SSH = { host: 'bastion.example', port: 22, user: 'deploy', auth: 'password', saveSecret: true };
const userKnownHosts = () => join(home, '.ssh', 'known_hosts');
const ownKnownHosts = () => join(t.configDir, 'known_hosts');

beforeEach(async () => {
  pg = await startFakePostgres({ password: 'gizli' });
  ssh = createFakeSsh();
  clock = createFakeClock();
  home = await mkdtemp(join(tmpdir(), 'tezgah-home-'));
  t = await startTestServer({ sshConnector: ssh.connector, homeDir: home, clock });
});
afterEach(async () => {
  await t.close();
  await pg.close();
  await rm(home, { recursive: true, force: true });
});

async function createTunneled(overrides: Record<string, unknown> = {}, sshOverrides: Record<string, unknown> = {}): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', {
    name: 'Tünelli',
    // Sunucu SSH sunucusunun gördüğü adrestir; sahte SSH kanalı buraya açar.
    host: '127.0.0.1',
    port: pg.port,
    user: 'postgres',
    sslmode: 'disable',
    password: 'gizli',
    ssh: { ...SSH, ...sshOverrides },
    sshSecret: 'ssh-gizli',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}

const list = (id: string) => t.api('GET', `/api/baglantilar/${id}/veritabanlari`);
const trust = (key = HOST_KEY, port = 22) => t.api('POST', '/api/host-anahtarlari', { host: SSH.host, port, anahtar: key });
const forget = () => t.api('POST', '/api/host-anahtarlari/unut', { host: SSH.host, port: 22 });

async function trustedConnection(overrides: Record<string, unknown> = {}, sshOverrides: Record<string, unknown> = {}) {
  await trust();
  return createTunneled(overrides, sshOverrides);
}

describe('host anahtarı', () => {
  it('bilinmeyen anahtarda SHA256 parmak izli yapısal hata; onaydan sonra tünel üzerinden bağlanır', async () => {
    const id = await createTunneled();
    const first = await list(id);
    expect(first.status).toBe(502);
    expect(first.body).toMatchObject({
      kod: 'hostKeyUnknown',
      hostAnahtari: { host: SSH.host, port: 22, tur: 'ssh-ed25519', parmakIzi: HOST_KEY_FP, anahtar: HOST_KEY, kaynak: null },
    });
    // El sıkışma açık tutulmaz, hedefe kanal açılmaz.
    expect(ssh.open).toBe(0);
    expect(ssh.forwards).toEqual([]);

    const trusted = await trust(first.body.hostAnahtari.anahtar);
    expect(trusted).toEqual({ status: 200, body: { parmakIzi: HOST_KEY_FP } });
    expect(await readFile(ownKnownHosts(), 'utf8')).toBe(`${SSH.host} ssh-ed25519 ${HOST_KEY}\n`);

    const second = await list(id);
    expect(second.status).toBe(200);
    expect(second.body.veritabanlari).toEqual(['postgres']);
    expect(ssh.forwards).toEqual([`127.0.0.1:${pg.port}`]);
  });

  it("kullanıcının ~/.ssh/known_hosts'undaki anahtara sessizce güvenilir; o dosyaya yazılmaz", async () => {
    await mkdir(join(home, '.ssh'));
    const content = `# kendi dosyam\n[other]:2222 ssh-ed25519 ${OTHER_HOST_KEY}\n${SSH.host} ssh-ed25519 ${HOST_KEY}\n`;
    await writeFile(userKnownHosts(), content);
    const id = await createTunneled();
    expect((await list(id)).status).toBe(200);
    expect(await readFile(userKnownHosts(), 'utf8')).toBe(content);
    await expect(readFile(ownKnownHosts(), 'utf8')).rejects.toThrow();
  });

  it('Tezgah deposundaki anahtarla uyuşmazlıkta sert ret; "unut" sonrası yeniden bilinmiyor', async () => {
    const id = await trustedConnection();
    ssh.hostKey = OTHER_HOST_KEY;
    const mismatch = await list(id);
    expect(mismatch.status).toBe(502);
    expect(mismatch.body).toMatchObject({
      kod: 'hostKeyMismatch',
      hostAnahtari: { parmakIzi: OTHER_HOST_KEY_FP, kayitli: [HOST_KEY_FP], kaynak: 'tezgah' },
    });
    expect(ssh.forwards).toEqual([]);

    expect(await forget()).toEqual({ status: 200, body: { silinen: 1 } });
    expect((await list(id)).body).toMatchObject({ kod: 'hostKeyUnknown', hostAnahtari: { parmakIzi: OTHER_HOST_KEY_FP } });
  });

  it("kullanıcının dosyasındaki anahtarla uyuşmazlık: kaynak bildirilir, unut onun dosyasına dokunmaz", async () => {
    await mkdir(join(home, '.ssh'));
    const content = `${SSH.host} ssh-ed25519 ${OTHER_HOST_KEY}\n`;
    await writeFile(userKnownHosts(), content);
    // Tezgah'ta eşleşen kayıt olsa da kullanıcının dosyası önce gelir.
    const id = await trustedConnection();
    const mismatch = await list(id);
    expect(mismatch.body).toMatchObject({ kod: 'hostKeyMismatch', hostAnahtari: { kayitli: [OTHER_HOST_KEY_FP], kaynak: 'kullanici' } });
    expect(mismatch.body.hata).toContain('ssh-keygen -R');

    await forget();
    expect(await readFile(userKnownHosts(), 'utf8')).toBe(content);
  });

  it('geçersiz onay girdisini reddeder', async () => {
    expect((await trust('bozuk!')).status).toBe(400);
    expect((await t.api('POST', '/api/host-anahtarlari', { host: '', port: 22, anahtar: HOST_KEY })).status).toBe(400);
    expect((await t.api('GET', '/api/host-anahtarlari')).status).toBe(405);
  });
});

describe('tünel yaşam döngüsü', () => {
  it("bağlantının pool'ları tek tüneli paylaşır; bağlantıyı kes tüneli kapatır", async () => {
    const id = await trustedConnection();
    expect(ssh.open).toBe(0); // tembel: kayıtta bağlanılmaz
    expect((await list(id)).status).toBe(200);
    expect((await t.api('GET', `/api/baglantilar/${id}/veritabanlari/app/semalar`)).status).toBe(200);
    expect(ssh.connects).toHaveLength(1);
    expect(ssh.open).toBe(1);
    expect(ssh.connects[0]).toMatchObject({ host: SSH.host, port: 22, username: 'deploy', auth: { type: 'password', password: 'ssh-gizli' } });

    await t.api('POST', `/api/baglantilar/${id}/baglantiyi-kes`);
    expect(ssh.open).toBe(0);
  });

  it('son pool boşta kapanınca tünel de kapanır', async () => {
    const id = await trustedConnection();
    await list(id);
    expect(ssh.open).toBe(1);
    clock.advance(10 * 60_000);
    await vi.waitFor(() => expect(ssh.open).toBe(0));
  });

  it("tünel koparsa bağlantının pool'ları atılır; sonraki istek tüneli yeniden açar", async () => {
    const id = await trustedConnection();
    await list(id);
    ssh.drop();
    expect(ssh.open).toBe(0);
    const again = await list(id);
    expect(again.status).toBe(200);
    expect(ssh.connects).toHaveLength(2);
    expect(ssh.forwards).toHaveLength(2);
  });

  it('SSH kimlik doğrulaması reddedilirse SSH sırrının reddi döner', async () => {
    ssh.accepts = () => false;
    const id = await trustedConnection();
    const res = await list(id);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ kod: 'sshSirReddedildi' });
  });
});

describe('SSH sırrı', () => {
  it("keychain'de <id>:ssh altında tutulur; kopyada kopyalanır, silmede silinir", async () => {
    const id = await trustedConnection();
    expect(t.keychain.entries.get(`${id}:ssh`)).toBe('ssh-gizli');
    expect((await t.api('GET', `/api/baglantilar/${id}/sifre`)).body).toEqual({ password: 'bulundu', sshSecret: 'bulundu' });

    const copy = await t.api('POST', `/api/baglantilar/${id}/kopya`);
    expect(copy.body.sshSecret).toBe('kaydedildi');
    expect(t.keychain.entries.get(`${copy.body.connection.id}:ssh`)).toBe('ssh-gizli');

    const removed = await t.api('DELETE', `/api/baglantilar/${id}`);
    expect(removed.body).toEqual({ password: 'silindi', sshSecret: 'silindi' });
    expect(t.keychain.entries.has(`${id}:ssh`)).toBe(false);
  });

  it('tünel kaldırılınca kayıtlı SSH sırrı silinir', async () => {
    const id = await trustedConnection();
    const { body: connection } = await t.api('GET', '/api/baglantilar').then((r) => ({ body: r.body[0] }));
    const updated = await t.api('PUT', `/api/baglantilar/${id}`, { ...connection, ssh: null });
    expect(updated.body.sshSecret).toBe('silindi');
    expect(t.keychain.entries.has(`${id}:ssh`)).toBe(false);
  });

  it("keychain'e kaydedilmeyen SSH şifresi ilk açılışta istenir ve yalnızca bellekte tutulur", async () => {
    const id = await trustedConnection({ sshSecret: undefined }, { saveSecret: false });
    const first = await list(id);
    expect(first.body.kod).toBe('sshSirGerekli');
    expect(ssh.connects).toHaveLength(0);

    const given = await t.api('POST', `/api/baglantilar/${id}/oturum-sifresi`, { password: 'ssh-gizli', secret: 'ssh' });
    expect(given.body).toMatchObject({ password: 'oturumda', connection: { ssh: { saveSecret: false } } });
    expect(t.keychain.entries.has(`${id}:ssh`)).toBe(false);
    expect((await list(id)).status).toBe(200);
  });

  it('reddedilen oturumluk SSH şifresi unutulur ve yeniden sorulur', async () => {
    ssh.accepts = (auth) => auth.type === 'password' && auth.password === 'ssh-gizli';
    const id = await trustedConnection({ sshSecret: undefined }, { saveSecret: false });
    await t.api('POST', `/api/baglantilar/${id}/oturum-sifresi`, { password: 'yanlis', secret: 'ssh' });
    expect((await list(id)).body.kod).toBe('sshSirReddedildi');
    expect((await list(id)).body.kod).toBe('sshSirGerekli');
  });

  it("oturumluk SSH şifresi keychain'e kaydedilince tünel ayarı değişir", async () => {
    const id = await trustedConnection({ sshSecret: undefined }, { saveSecret: false });
    const given = await t.api('POST', `/api/baglantilar/${id}/oturum-sifresi`, { password: 'ssh-gizli', secret: 'ssh', saveToKeychain: true });
    expect(given.body).toMatchObject({ password: 'kaydedildi', connection: { ssh: { saveSecret: true }, savePassword: true } });
    expect(t.keychain.entries.get(`${id}:ssh`)).toBe('ssh-gizli');
  });

  it('anahtar dosyasıyla: yalnızca yol saklanır, dosya bağlanırken okunur; passphrase SSH sırrıdır', async () => {
    const keyPath = join(home, 'id_ed25519');
    await writeFile(keyPath, 'ANAHTAR');
    const id = await trustedConnection({ sshSecret: 'passphrase' }, { auth: 'key', keyPath });
    expect((await list(id)).status).toBe(200);
    expect(ssh.connects[0]!.auth).toEqual({ type: 'key', privateKey: Buffer.from('ANAHTAR'), passphrase: 'passphrase' });
  });

  it("agent'ta sır yok; elle girilen pipe yolu kullanılır", async () => {
    const id = await trustedConnection({ sshSecret: undefined }, { auth: 'agent', agentPath: String.raw`\\.\pipe\pageant.u` });
    expect((await list(id)).status).toBe(200);
    expect(ssh.connects[0]!.auth).toEqual({ type: 'agent', agent: String.raw`\\.\pipe\pageant.u` });
  });
});

describe('bağlantıyı test et: SSH adımı', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    connectionId: null,
    host: '127.0.0.1',
    port: pg.port,
    user: 'postgres',
    sslmode: 'disable',
    password: 'gizli',
    ssh: SSH,
    sshSecret: 'ssh-gizli',
    ...overrides,
  });
  const steps = (res: { body: { adimlar: { id: string; sonuc: string }[] } }) => res.body.adimlar.map((s) => `${s.id}:${s.sonuc}`);

  it('tünel üzerinden tüm adımlar; tünel sonunda kapanır', async () => {
    await trust();
    const res = await t.api('POST', '/api/baglanti-testi', body());
    expect(steps(res)).toEqual(['ssh:basarili', 'ulasma:basarili', 'tls:basarili', 'kimlik:basarili', 'listeleme:basarili']);
    expect(res.body.adimlar[0].mesaj).toContain('deploy@bastion.example');
    expect(ssh.open).toBe(0);
  });

  it('bilinmeyen host anahtarı SSH adımının altında; kalanlar çalıştırılmaz, hiçbir şey kaydedilmez', async () => {
    const res = await t.api('POST', '/api/baglanti-testi', body());
    expect(steps(res)).toEqual(['ssh:hata', 'ulasma:calistirilmadi', 'tls:calistirilmadi', 'kimlik:calistirilmadi', 'listeleme:calistirilmadi']);
    expect(res.body.adimlar[0]).toMatchObject({ kod: 'hostKeyUnknown', alan: 'sshHost', hostAnahtari: { parmakIzi: HOST_KEY_FP } });
    await expect(readFile(ownKnownHosts(), 'utf8')).rejects.toThrow();
  });

  it("SSH sunucusu hedefe ulaşamazsa 'sunucuya ulaşma' adımında durur", async () => {
    await trust();
    const closed = await startFakePostgres({ password: 'x' });
    const port = closed.port;
    await closed.close();
    const res = await t.api('POST', '/api/baglanti-testi', body({ port }));
    expect(steps(res).slice(0, 2)).toEqual(['ssh:basarili', 'ulasma:hata']);
    expect(res.body.adimlar[1]).toMatchObject({ kod: 'ECONNREFUSED', alan: 'port' });
  });

  it("kayıtlı bağlantının SSH sırrı keychain'den okunur (sırlar adımı)", async () => {
    const id = await trustedConnection();
    const res = await t.api('POST', '/api/baglanti-testi', body({ connectionId: id, password: undefined, sshSecret: undefined, savePassword: true }));
    expect(steps(res)[0]).toBe('sirlar:basarili');
    expect(res.body.adimlar[0].mesaj).toBe("Şifre ve SSH sırrı keychain'den okundu.");
    expect(steps(res)[1]).toBe('ssh:basarili');
  });

  it('SSH sırrı keychain reddedince sırlar adımında durur', async () => {
    const id = await trustedConnection();
    t.keychain.deny = true;
    const res = await t.api('POST', '/api/baglanti-testi', body({ connectionId: id, password: 'gizli', sshSecret: undefined }));
    expect(steps(res)[0]).toBe('sirlar:hata');
    expect(res.body.adimlar[0]).toMatchObject({ kod: 'reddedildi', alan: 'sshSecret' });
  });
});

describe('script çalıştırma: tünel kopması', () => {
  it('karar bekleyen transaction\'da "Tünel koptu; transaction sunucuda geri alındı"', async () => {
    const id = await trustedConnection();
    const ws = await t.socket();
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'UPDATE t SET a = 1' });
    await ws.waitFor('kararBekleniyor');
    ssh.drop();
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'hata', mesaj: 'Tünel koptu; transaction sunucuda geri alındı.' });
    ws.close();
  });

  it('COMMIT sırasında kopmada "Commit sonucu bilinmiyor: tünel koptu."', async () => {
    const id = await trustedConnection();
    pg.failOn = (sql) => {
      if (sql === 'COMMIT') ssh.drop();
      return undefined;
    };
    const ws = await t.socket();
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'UPDATE t SET a = 1' });
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'hata', mesaj: 'Commit sonucu bilinmiyor: tünel koptu.' });
    ws.close();
  });

  it('autocommit\'te kopmada kalan ifadeler çalıştırılmaz', async () => {
    const id = await trustedConnection();
    // İlk VACUUM çalışırken tünel kopar.
    pg.failOn = (sql) => {
      if (sql === 'VACUUM a') setImmediate(() => ssh.drop());
      return undefined;
    };
    pg.resultFor = () => undefined;
    const ws = await t.socket();
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'VACUUM a;\nVACUUM b;\nVACUUM c' });
    const done = await ws.waitFor('bitti');
    expect(done.mesaj).toMatch(/^Tünel koptu/);
    expect(pg.queries).not.toContain('VACUUM c');
    ws.close();
  });
});

