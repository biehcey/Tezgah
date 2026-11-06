import { describe, expect, it } from 'vitest';
import type { SshSettings } from './baglanti';
import { parseConnectionTestInput, testPlan } from './baglanti-testi';
import {
  WINDOWS_AGENT_PIPE,
  asksForSshSecret,
  classifySshError,
  hostKeyFailure,
  resolveAgentPath,
  type HostKeyProblem,
} from './ssh-tuneli';

const ssh = (overrides: Partial<SshSettings> = {}): SshSettings => ({
  host: 'bastion.example',
  port: 22,
  user: 'deploy',
  auth: 'password',
  keyPath: null,
  agentPath: null,
  saveSecret: true,
  ...overrides,
});
const mac = { platform: 'darwin', env: { SSH_AUTH_SOCK: '/tmp/agent.sock' } };
const win = { platform: 'win32', env: {} };

describe('parseConnectionTestInput: tünel', () => {
  it('tüneli ve SSH sırrını okur', () => {
    const result = parseConnectionTestInput({ host: 'localhost', user: 'u', ssh: ssh(), sshSecret: 'gizli' });
    expect(result.ok && result.value).toMatchObject({ ssh: ssh(), sshSecret: 'gizli' });
  });

  it('tünel verilmezse yok', () => {
    const result = parseConnectionTestInput({ host: 'localhost', user: 'u' });
    expect(result.ok && result.value).toMatchObject({ ssh: null, sshSecret: undefined });
  });

  it('geçersiz SSH alanını adıyla bildirir', () => {
    const result = parseConnectionTestInput({ host: 'h', user: 'u', ssh: { ...ssh(), host: '' } });
    expect(!result.ok && Object.keys(result.errors)).toEqual(['sshHost']);
  });
});

describe('testPlan: tünel', () => {
  it('tünel varsa sırlardan sonra ssh adımı', () => {
    expect(testPlan({ readsKeychain: true, ssh: true })).toEqual(['sirlar', 'ssh', 'ulasma', 'tls', 'kimlik', 'listeleme']);
    expect(testPlan({ readsKeychain: false, ssh: true })).toEqual(['ssh', 'ulasma', 'tls', 'kimlik', 'listeleme']);
  });
});

describe('resolveAgentPath', () => {
  it('elle girilen yol (Pageant pipe) her platformda önce gelir', () => {
    expect(resolveAgentPath(ssh({ auth: 'agent', agentPath: String.raw`\\.\pipe\pageant.u` }), win)).toBe(
      String.raw`\\.\pipe\pageant.u`,
    );
  });

  it("varsayılan: Windows'ta OpenSSH agent pipe'ı, diğerlerinde SSH_AUTH_SOCK", () => {
    expect(resolveAgentPath(ssh({ auth: 'agent' }), win)).toBe(WINDOWS_AGENT_PIPE);
    expect(WINDOWS_AGENT_PIPE).toBe(String.raw`\\.\pipe\openssh-ssh-agent`);
    expect(resolveAgentPath(ssh({ auth: 'agent' }), mac)).toBe('/tmp/agent.sock');
    expect(resolveAgentPath(ssh({ auth: 'agent' }), { platform: 'darwin', env: {} })).toBeNull();
  });
});

describe('classifySshError', () => {
  it('SSH sunucusuna ulaşılamazsa SSH alanlarına bağlar', () => {
    expect(
      classifySshError({ level: 'client-socket', code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, ssh(), mac),
    ).toEqual({
      kod: 'ECONNREFUSED',
      mesaj: 'SSH sunucusu bastion.example:22 bağlantıyı reddetti.',
      alan: 'sshPort',
      oneriler: ['sshPortuDuzelt', 'tekrarDene'],
    });
    expect(classifySshError({ level: 'client-socket', code: 'ENOTFOUND', message: 'x' }, ssh(), mac)).toMatchObject({
      kod: 'ENOTFOUND',
      alan: 'sshHost',
      oneriler: ['sshHostuDuzelt', 'tekrarDene'],
    });
    expect(classifySshError({ level: 'client-timeout', message: 'Timed out while waiting for handshake' }, ssh(), mac)).toMatchObject({
      kod: 'ETIMEDOUT',
      alan: 'sshHost',
    });
  });

  it('şifreyle kimlik doğrulama reddi SSH sırrının reddidir', () => {
    expect(
      classifySshError({ level: 'client-authentication', message: 'All configured authentication methods failed' }, ssh(), mac),
    ).toEqual({
      kod: 'sshSirReddedildi',
      mesaj: 'SSH sunucusu deploy kullanıcısının şifresini kabul etmedi.',
      alan: 'sshSecret',
      oneriler: ['sshSirriDuzelt', 'sshKullaniciyiDuzelt'],
    });
  });

  it('anahtar ya da agent reddi kullanıcı/anahtar alanına bağlanır', () => {
    const failed = { level: 'client-authentication', message: 'All configured authentication methods failed' };
    expect(classifySshError(failed, ssh({ auth: 'key', keyPath: '~/.ssh/id' }), mac)).toMatchObject({
      kod: 'sshKimlik',
      alan: 'sshKeyPath',
      oneriler: ['anahtarDosyasiniDuzelt', 'sshKullaniciyiDuzelt'],
    });
    expect(classifySshError(failed, ssh({ auth: 'agent' }), mac)).toMatchObject({ kod: 'sshKimlik', alan: 'sshUser' });
  });

  it("şifreli anahtarda passphrase yoksa ya da yanlışsa SSH sırrı istenir", () => {
    const key = ssh({ auth: 'key', keyPath: '~/.ssh/id' });
    expect(
      classifySshError({ level: 'key', message: 'Cannot parse privateKey: Encrypted private OpenSSH key detected, but no passphrase given' }, key, mac),
    ).toMatchObject({ kod: 'sshSirGerekli', alan: 'sshSecret', oneriler: ['sshSirriDuzelt'] });
    expect(
      classifySshError({ level: 'key', message: 'Cannot parse privateKey: OpenSSH key integrity check failed -- bad passphrase?' }, key, mac),
    ).toMatchObject({ kod: 'sshSirReddedildi', alan: 'sshSecret' });
  });

  it('okunamayan ya da bozuk anahtar dosyası anahtar alanına bağlanır', () => {
    const key = ssh({ auth: 'key', keyPath: '~/.ssh/yok' });
    expect(classifySshError({ level: 'key', code: 'ENOENT', message: 'no such file' }, key, mac)).toEqual({
      kod: 'ENOENT',
      mesaj: 'Anahtar dosyası okunamadı (~/.ssh/yok): dosya yok.',
      alan: 'sshKeyPath',
      oneriler: ['anahtarDosyasiniDuzelt'],
    });
    expect(classifySshError({ level: 'key', message: 'Cannot parse privateKey: Unsupported key format' }, key, mac)).toMatchObject({
      kod: 'anahtarOkunamadi',
      alan: 'sshKeyPath',
    });
  });

  it("Windows'ta varsayılan agent pipe'ı yoksa ssh-agent servisinin kapalı olabileceğini söyler", () => {
    const failure = classifySshError({ level: 'agent', code: 'ENOENT', message: 'connect ENOENT' }, ssh({ auth: 'agent' }), win);
    expect(failure).toMatchObject({ kod: 'agentYok', alan: 'sshAgentPath', oneriler: ['agentYolunuDuzelt', 'tekrarDene'] });
    expect(failure.mesaj).toMatch(/ssh-agent servisi/);
    expect(failure.mesaj).toMatch(/Start-Service ssh-agent/);
  });

  it('elle girilen agent yolu ya da macOS soketi yoksa yolu söyler', () => {
    const failure = classifySshError({ level: 'agent', code: 'ENOENT', message: 'x' }, ssh({ auth: 'agent' }), mac);
    expect(failure).toMatchObject({ kod: 'agentYok', alan: 'sshAgentPath' });
    expect(failure.mesaj).toContain('/tmp/agent.sock');
    expect(failure.mesaj).not.toMatch(/servis/);
  });

  it('agent hiç bulunamazsa (SSH_AUTH_SOCK yok) bunu söyler', () => {
    const failure = classifySshError({ level: 'agent', message: 'agent yok' }, ssh({ auth: 'agent' }), { platform: 'darwin', env: {} });
    expect(failure).toMatchObject({ kod: 'agentYok', alan: 'sshAgentPath' });
    expect(failure.mesaj).toMatch(/SSH_AUTH_SOCK/);
  });

  it('diğer hatalarda mesajı taşır', () => {
    expect(classifySshError({ level: 'protocol', message: 'Bad packet length' }, ssh(), mac)).toEqual({
      kod: 'sshHatasi',
      mesaj: 'SSH oturumu kurulamadı: Bad packet length',
      alan: null,
      oneriler: ['tekrarDene'],
    });
  });
});

describe('hostKeyFailure', () => {
  const problem: HostKeyProblem = {
    host: 'bastion.example',
    port: 22,
    tur: 'ssh-ed25519',
    parmakIzi: 'SHA256:abc',
    anahtar: 'AAAA',
    digerTurler: [],
    kayitli: [],
    kaynak: null,
    iptal: false,
  };

  it('bilinmeyen anahtar: parmak izini taşıyan yapısal hata', () => {
    expect(hostKeyFailure('bilinmiyor', problem)).toEqual({
      kod: 'hostKeyUnknown',
      mesaj: 'bastion.example host anahtarı tanınmıyor (ssh-ed25519 SHA256:abc). Parmak izini doğrulayıp güvenin.',
      alan: 'sshHost',
      oneriler: [],
      hostAnahtari: problem,
    });
  });

  it('uyuşmazlık: devam önerisi yok; kayıt kullanıcının dosyasındaysa bunu söyler', () => {
    const tezgah = hostKeyFailure('uyusmazlik', { ...problem, kayitli: ['SHA256:eski'], kaynak: 'tezgah' });
    expect(tezgah).toMatchObject({ kod: 'hostKeyMismatch', alan: 'sshHost', oneriler: [] });
    expect(tezgah.mesaj).toMatch(/uyuşmuyor/);
    const user = hostKeyFailure('uyusmazlik', { ...problem, port: 2222, kayitli: ['SHA256:eski'], kaynak: 'kullanici' });
    expect(user.mesaj).toMatch(/~\/\.ssh\/known_hosts/);
    expect(user.mesaj).toContain('ssh-keygen -R "[bastion.example]:2222"');
  });
});

describe('asksForSshSecret', () => {
  it("sırrı keychain'e kaydedilmeyen tünelde sır istenince ya da reddedilince", () => {
    expect(asksForSshSecret({ ssh: ssh({ saveSecret: false }) }, 'sshSirGerekli')).toBe(true);
    expect(asksForSshSecret({ ssh: ssh({ saveSecret: false }) }, 'sshSirReddedildi')).toBe(true);
    expect(asksForSshSecret({ ssh: ssh({ saveSecret: true }) }, 'sshSirGerekli')).toBe(false);
    expect(asksForSshSecret({ ssh: ssh({ saveSecret: false }) }, 'sshKimlik')).toBe(false);
    expect(asksForSshSecret({ ssh: null }, 'sshSirGerekli')).toBe(false);
  });
});
