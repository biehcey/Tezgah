import { describe, expect, it } from 'vitest';
import { checkHostKey, forgetHost, hostKeyFingerprint, hostKeyType, knownHostsLine, type KnownHostsCrypto } from './known-hosts';

// Vektörler ssh-keygen ile üretildi (`ssh-keygen -H`, `ssh-keygen -lf`).
const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIEU8D5up28tG1prR24yj9n15BaO74pWE01De7QehVbhR';
const KEY_FP = 'SHA256:/aVfHyjB4cQdc1A3AIz9e7iLfEjEgWvgxjZr1g5opAI';
const OTHER = 'AAAAC3NzaC1lZDI1NTE5AAAAIOyP74ydz9Ps58dooYInbvOU8kWYkMRfi7Ec5Stxiyth';
const OTHER_FP = 'SHA256:nsK4jZTmc4LQvZA4GlALZoYYwbvwFt11c09fwTQhKf8';
const ECDSA =
  'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBK1KD2wirsUimuTBfMCugMcjZ/lO/F4QZ4M+6QDRt4bKu7S3Cvb2NvAZJS9YmN5Ac+4aVKFdLgJ9KVST69vQFDY=';
const ECDSA_FP = 'SHA256:FykeW7cRsoZHGcYXNy53axqxFDpE1jXgBDZ6hzujpLE';
/** `db.example.com` ve `[bastion.example.com]:2222`, hashed. */
const HASHED = [
  `|1|W9JHYMDu9j0lMxvofK6ITGXWmRY=|89KHAXPkI9v9qMTgxMjXvbVNwgQ= ssh-ed25519 ${KEY}`,
  `|1|17iB8BaJlzf2EmVrbjrjg0Z2eZM=|p2C8ZJ7eRUzvkNQPlbtgFRhnoy8= ssh-ed25519 ${KEY}`,
].join('\n');

// core Node'a bağımlı olamaz; testte Node'un crypto'su çalışma zamanında alınır.
interface NodeCryptoSubset {
  createHmac(alg: string, key: unknown): { update(text: string): { digest(enc: 'base64'): string } };
  createHash(alg: string): { update(data: unknown): { digest(enc: 'base64'): string } };
}
interface BufferSubset {
  from(text: string, enc: 'base64'): unknown;
}
const runtime = globalThis as unknown as {
  process: { getBuiltinModule(id: string): unknown };
  Buffer: BufferSubset;
};
const { createHash, createHmac } = runtime.process.getBuiltinModule('node:crypto') as NodeCryptoSubset;
const { Buffer } = runtime;

const crypto: KnownHostsCrypto = {
  hmacSha1: (salt, text) => createHmac('sha1', Buffer.from(salt, 'base64')).update(text).digest('base64'),
  sha256: (data) => createHash('sha256').update(Buffer.from(data, 'base64')).digest('base64'),
};

const check = (text: string, host: string, port: number, key: string) => checkHostKey(text, { host, port, key }, crypto);

describe('checkHostKey', () => {
  it.each([
    ['düz ad', `db.example.com ssh-ed25519 ${KEY}`, 'db.example.com', 22],
    ['büyük/küçük harf duyarsız', `DB.Example.com ssh-ed25519 ${KEY}`, 'db.example.COM', 22],
    ['virgüllü liste', `other,db.example.com,10.0.0.5 ssh-ed25519 ${KEY}`, '10.0.0.5', 22],
    ['standart dışı port', `[db.example.com]:2222 ssh-ed25519 ${KEY}`, 'db.example.com', 2222],
    ['joker *', `*.example.com ssh-ed25519 ${KEY}`, 'db.example.com', 22],
    ['joker ?', `db?.example.com ssh-ed25519 ${KEY}`, 'db1.example.com', 22],
    ['portlu joker', `[*.example.com]:2222 ssh-ed25519 ${KEY}`, 'bastion.example.com', 2222],
    ['hashed', HASHED, 'db.example.com', 22],
    ['hashed, standart dışı port', HASHED, 'bastion.example.com', 2222],
    ['yorum ve boş satırlar', `# yorum\n\n  db.example.com ssh-ed25519 ${KEY} kullanici@makine\r\n`, 'db.example.com', 22],
  ])('eşleşti: %s', (_name, text, host, port) => {
    expect(check(text, host, port, KEY)).toEqual({ sonuc: 'eslesti' });
  });

  it.each([
    ['boş dosya', '', 'db.example.com', 22],
    ['başka host', `other.example.com ssh-ed25519 ${KEY}`, 'db.example.com', 22],
    ['port 22 girdisi başka portu kapsamaz', `db.example.com ssh-ed25519 ${KEY}`, 'db.example.com', 2222],
    ['hashed başka port', HASHED, 'db.example.com', 2222],
    ['olumsuzlama', `*.example.com,!db.example.com ssh-ed25519 ${KEY}`, 'db.example.com', 22],
    ['@cert-authority yok sayılır', `@cert-authority *.example.com ssh-ed25519 ${KEY}`, 'db.example.com', 22],
    ['bozuk satırlar yok sayılır', `db.example.com\ndb.example.com ssh-ed25519\n|1|bozuk ssh-ed25519 ${KEY}`, 'db.example.com', 22],
  ])('bilinmiyor: %s', (_name, text, host, port) => {
    expect(check(text, host, port, KEY)).toEqual({ sonuc: 'bilinmiyor', digerTurler: [] });
  });

  it('host için yalnızca başka türde anahtar varsa bilinmiyor; türler bildirilir', () => {
    expect(check(`db.example.com ecdsa-sha2-nistp256 ${ECDSA}`, 'db.example.com', 22, KEY)).toEqual({
      sonuc: 'bilinmiyor',
      digerTurler: ['ecdsa-sha2-nistp256'],
    });
  });

  it('aynı türde farklı anahtar uyuşmazlıktır; kayıtlı parmak izleri döner', () => {
    expect(check(`db.example.com ssh-ed25519 ${OTHER}`, 'db.example.com', 22, KEY)).toEqual({
      sonuc: 'uyusmazlik',
      kayitli: [OTHER_FP],
      iptal: false,
    });
    expect(check(HASHED, 'bastion.example.com', 2222, OTHER)).toEqual({ sonuc: 'uyusmazlik', kayitli: [KEY_FP], iptal: false });
  });

  it('host için eşleşen bir anahtar varsa diğer satırlar uyuşmazlık saymaz', () => {
    const text = `db.example.com ssh-ed25519 ${OTHER}\ndb.example.com ssh-ed25519 ${KEY}`;
    expect(check(text, 'db.example.com', 22, KEY)).toEqual({ sonuc: 'eslesti' });
  });

  it('@revoked anahtar eşleşse de reddedilir', () => {
    const text = `db.example.com ssh-ed25519 ${KEY}\n@revoked * ssh-ed25519 ${KEY}`;
    expect(check(text, 'db.example.com', 22, KEY)).toEqual({ sonuc: 'uyusmazlik', kayitli: [KEY_FP], iptal: true });
  });
});

describe('hostKeyFingerprint ve hostKeyType', () => {
  it.each([
    [KEY, KEY_FP, 'ssh-ed25519'],
    [ECDSA, ECDSA_FP, 'ecdsa-sha2-nistp256'],
  ])('%#', (key, fp, type) => {
    expect(hostKeyFingerprint(key, crypto)).toBe(fp);
    expect(hostKeyType(key)).toBe(type);
  });

  it('bozuk anahtarın türü bilinmez', () => {
    expect(hostKeyType('AAAA')).toBeNull();
    expect(hostKeyType('!!!')).toBeNull();
  });
});

describe('knownHostsLine', () => {
  it('OpenSSH biçiminde satır; standart dışı port köşeli parantezle', () => {
    expect(knownHostsLine({ host: 'db.example.com', port: 22, key: KEY })).toBe(`db.example.com ssh-ed25519 ${KEY}`);
    expect(knownHostsLine({ host: 'Bastion.example.com', port: 2222, key: KEY })).toBe(`[bastion.example.com]:2222 ssh-ed25519 ${KEY}`);
  });

  it('üretilen satır geri okunur', () => {
    const line = knownHostsLine({ host: 'bastion', port: 2222, key: ECDSA });
    expect(check(line, 'bastion', 2222, ECDSA)).toEqual({ sonuc: 'eslesti' });
  });
});

describe('forgetHost', () => {
  it("host'un satırlarını (hashed dahil) siler, diğerlerini ve yorumları korur", () => {
    const text = [
      '# Tezgah',
      `db.example.com ssh-ed25519 ${OTHER}`,
      `other.example.com ssh-ed25519 ${KEY}`,
      `db.example.com ecdsa-sha2-nistp256 ${ECDSA}`,
      HASHED,
      '',
    ].join('\n');
    const { text: next, removed } = forgetHost(text, { host: 'db.example.com', port: 22 }, crypto);
    expect(removed).toBe(3);
    expect(next).toBe(
      [
        '# Tezgah',
        `other.example.com ssh-ed25519 ${KEY}`,
        `|1|17iB8BaJlzf2EmVrbjrjg0Z2eZM=|p2C8ZJ7eRUzvkNQPlbtgFRhnoy8= ssh-ed25519 ${KEY}`,
        '',
      ].join('\n'),
    );
    expect(check(next, 'db.example.com', 22, OTHER)).toEqual({ sonuc: 'bilinmiyor', digerTurler: [] });
  });

  it('kayıt yoksa metin değişmez', () => {
    const text = `other ssh-ed25519 ${KEY}\n`;
    expect(forgetHost(text, { host: 'db', port: 22 }, crypto)).toEqual({ text, removed: 0 });
  });
});
