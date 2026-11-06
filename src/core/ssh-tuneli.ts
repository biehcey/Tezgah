/**
 * Tünelin saf kuralları: agent yolunun seçimi, SSH hatalarının test adımına/alanlara/önerilere eşlenmesi,
 * host anahtarı sorunlarının yapısal hatası ve oturumluk SSH sırrı istemi. ssh2'den ve ağdan bağımsızdır.
 */
import { DEFAULT_SSH_PORT, type Connection, type SshSettings } from './baglanti';
import type { DriverError, ExternalCode, StepCode, StepFailure } from './baglanti-testi';

/** Windows OpenSSH agent'ının named pipe'ı (servis varsayılan olarak kapalıdır). */
export const WINDOWS_AGENT_PIPE = String.raw`\\.\pipe\openssh-ssh-agent`;

/** Agent yolunun seçimi için çalışma ortamı; testlerde verilir. */
export interface AgentEnvironment {
  platform: string;
  env: Record<string, string | undefined>;
}

/** Elle girilen yol (ör. Pageant pipe'ı) önce; yoksa Windows'ta OpenSSH pipe'ı, diğerlerinde `SSH_AUTH_SOCK`. */
export function resolveAgentPath(ssh: Pick<SshSettings, 'agentPath'>, { platform, env }: AgentEnvironment): string | null {
  if (ssh.agentPath) return ssh.agentPath;
  if (platform === 'win32') return WINDOWS_AGENT_PIPE;
  return env.SSH_AUTH_SOCK || null;
}

/**
 * Tünel hatası. `level`: ssh2'nin hata düzeyi (`client-socket`, `client-dns`, `client-timeout`,
 * `client-authentication`, `agent`, `protocol`…) ya da Tezgah'ın anahtar dosyası için verdiği `key`.
 */
export interface SshError extends DriverError {
  level?: string;
}

/** Host anahtarı kutusunun içeriği: sunulan anahtar ve (uyuşmazlıkta) kayıtlı olanlar. */
export interface HostKeyProblem {
  host: string;
  port: number;
  /** Sunulan anahtarın türü, ör. `ssh-ed25519`. */
  tur: string;
  /** `SHA256:…` */
  parmakIzi: string;
  /** Sunulan anahtar (base64 blob); "Güven ve tekrar dene" bunu Tezgah'ın deposuna yazar. */
  anahtar: string;
  /** Bilinmeyende: host için kayıtlı başka türdeki anahtarlar. */
  digerTurler: string[];
  /** Uyuşmazlıkta: kayıtlı parmak izleri. */
  kayitli: string[];
  /** Uyuşmazlıkta kaydın nerede olduğu: kullanıcının `~/.ssh/known_hosts`'u ya da Tezgah'ın deposu. */
  kaynak: 'kullanici' | 'tezgah' | null;
  /** Sunulan anahtar `@revoked` işaretli. */
  iptal: boolean;
}

// --- REST: `POST /api/host-anahtarlari` (güven) ve `POST /api/host-anahtarlari/unut`. ---

/** "Güven ve tekrar dene": kutuda gösterilen anahtar Tezgah'ın `known_hosts`'una yazılır. */
export interface HostKeyTrustRequest {
  host: string;
  port: number;
  anahtar: string;
}

export interface HostKeyTrustResponse {
  parmakIzi: string;
}

/** "Kayıtlı host anahtarını unut": yalnızca Tezgah'ın deposundan. */
export interface HostKeyForgetRequest {
  host: string;
  port: number;
}

export interface HostKeyForgetResponse {
  /** Silinen satır sayısı; 0 ise Tezgah'ta kayıt yoktu. */
  silinen: number;
}

/** Tünel koptuğunda tünel üzerindeki `pg` bağlantılarının aldığı hata kodu. */
export const TUNNEL_CLOSED = 'tunelKoptu';

const REACH = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

function codeOf(err: DriverError, fallback: StepCode): StepCode {
  return err.code === undefined ? fallback : (err.code as ExternalCode);
}

/** `[host]:port` biçimi (OpenSSH ile aynı); port 22'de yalın ad. */
function sshAddress(host: string, port: number): string {
  return port === DEFAULT_SSH_PORT ? host : `[${host}]:${port}`;
}

/** SSH adımındaki (el sıkışma, kimlik doğrulama, anahtar, agent) hata. */
export function classifySshError(err: SshError, ssh: SshSettings, environment: AgentEnvironment): StepFailure {
  const address = `${ssh.host}:${ssh.port}`;
  if (err.level === 'client-timeout') {
    return {
      kod: 'ETIMEDOUT' as ExternalCode,
      mesaj: `SSH sunucusu ${address} zamanında yanıt vermedi.`,
      alan: 'sshHost',
      oneriler: ['sshHostuDuzelt', 'sshPortuDuzelt', 'tekrarDene'],
    };
  }
  if (err.level === 'client-socket' || err.level === 'client-dns' || (err.level !== 'agent' && err.level !== 'key' && REACH.has(err.code ?? ''))) {
    const kod = codeOf(err, 'ulasilamadi');
    switch (err.code) {
      case 'ECONNREFUSED':
        return { kod, mesaj: `SSH sunucusu ${address} bağlantıyı reddetti.`, alan: 'sshPort', oneriler: ['sshPortuDuzelt', 'tekrarDene'] };
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return { kod, mesaj: `SSH host'u “${ssh.host}” çözümlenemedi.`, alan: 'sshHost', oneriler: ['sshHostuDuzelt', 'tekrarDene'] };
      case 'ETIMEDOUT':
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return {
          kod,
          mesaj: `SSH sunucusu ${address} ağdan ulaşılamıyor.`,
          alan: 'sshHost',
          oneriler: ['sshHostuDuzelt', 'sshPortuDuzelt', 'tekrarDene'],
        };
      default:
        return { kod, mesaj: `SSH sunucusuna (${address}) ulaşılamadı: ${err.message}`, alan: 'sshHost', oneriler: ['tekrarDene'] };
    }
  }
  if (err.level === 'key') return classifyKeyError(err, ssh);
  if (err.level === 'agent') return agentFailure(ssh, environment);
  if (err.level === 'client-authentication') {
    if (ssh.auth === 'password') {
      return {
        kod: 'sshSirReddedildi',
        mesaj: `SSH sunucusu ${ssh.user} kullanıcısının şifresini kabul etmedi.`,
        alan: 'sshSecret',
        oneriler: ['sshSirriDuzelt', 'sshKullaniciyiDuzelt'],
      };
    }
    if (ssh.auth === 'key') {
      return {
        kod: 'sshKimlik',
        mesaj: `SSH sunucusu ${ssh.user} kullanıcısı için bu anahtarı kabul etmedi.`,
        alan: 'sshKeyPath',
        oneriler: ['anahtarDosyasiniDuzelt', 'sshKullaniciyiDuzelt'],
      };
    }
    return {
      kod: 'sshKimlik',
      mesaj: `SSH sunucusu agent'taki anahtarların hiçbirini ${ssh.user} kullanıcısı için kabul etmedi.`,
      alan: 'sshUser',
      oneriler: ['sshKullaniciyiDuzelt', 'tekrarDene'],
    };
  }
  return { kod: 'sshHatasi', mesaj: `SSH oturumu kurulamadı: ${err.message}`, alan: null, oneriler: ['tekrarDene'] };
}

/** Anahtar dosyası okunamadı, ayrıştırılamadı ya da passphrase eksik/yanlış. */
function classifyKeyError(err: SshError, ssh: SshSettings): StepFailure {
  const path = ssh.keyPath ?? '';
  if (/no passphrase given/i.test(err.message)) {
    return {
      kod: 'sshSirGerekli',
      mesaj: 'Anahtar dosyası şifreli; passphrase gerekli.',
      alan: 'sshSecret',
      oneriler: ['sshSirriDuzelt'],
    };
  }
  if (/bad passphrase|integrity check failed/i.test(err.message)) {
    return { kod: 'sshSirReddedildi', mesaj: 'Passphrase yanlış; anahtar çözülemedi.', alan: 'sshSecret', oneriler: ['sshSirriDuzelt'] };
  }
  if (err.code !== undefined) {
    const reason = err.code === 'ENOENT' ? 'dosya yok' : err.code === 'EACCES' || err.code === 'EPERM' ? 'okuma izni yok' : err.message;
    return {
      kod: err.code as ExternalCode,
      mesaj: `Anahtar dosyası okunamadı (${path}): ${reason}.`,
      alan: 'sshKeyPath',
      oneriler: ['anahtarDosyasiniDuzelt'],
    };
  }
  return {
    kod: 'anahtarOkunamadi',
    mesaj: `Anahtar dosyası kullanılamadı (${path}): ${err.message.replace(/^Cannot parse privateKey: /, '')}. FIDO (sk-*) anahtarları desteklenmez.`,
    alan: 'sshKeyPath',
    oneriler: ['anahtarDosyasiniDuzelt'],
  };
}

/** Agent'a bağlanılamadı (soket/pipe yok) ya da hiç agent yolu yok. */
function agentFailure(ssh: SshSettings, environment: AgentEnvironment): StepFailure {
  const path = resolveAgentPath(ssh, environment);
  let mesaj: string;
  if (path === null) mesaj = "SSH agent bulunamadı: SSH_AUTH_SOCK tanımlı değil. Agent'ın soket yolunu girin ya da agent'ı başlatın.";
  else if (path === WINDOWS_AGENT_PIPE) {
    mesaj =
      "Windows OpenSSH agent'ına bağlanılamadı; ssh-agent servisi kapalı olabilir (varsayılan olarak kapalıdır). " +
      'Yönetici PowerShell: Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent. ' +
      "Pageant kullanıyorsanız pipe yolunu girin.";
  } else mesaj = `SSH agent'ına bağlanılamadı (${path}); agent çalışıyor mu?`;
  return { kod: 'agentYok', mesaj, alan: 'sshAgentPath', oneriler: ['agentYolunuDuzelt', 'tekrarDene'] };
}

/**
 * Host anahtarı bilinmiyor ya da kayıtlı anahtarla uyuşmuyor. Bilinmeyende arayüz parmak izini gösterip
 * "Güven ve tekrar dene" sunar; uyuşmazlıkta devam yoktur, yalnızca Tezgah'taki kaydı unutmak.
 */
export function hostKeyFailure(sonuc: 'bilinmiyor' | 'uyusmazlik', problem: HostKeyProblem): StepFailure {
  if (sonuc === 'bilinmiyor') {
    const other = problem.digerTurler.length > 0 ? ` Bu host için başka türde kayıtlı anahtar var: ${problem.digerTurler.join(', ')}.` : '';
    return {
      kod: 'hostKeyUnknown',
      mesaj: `${problem.host} host anahtarı tanınmıyor (${problem.tur} ${problem.parmakIzi}). Parmak izini doğrulayıp güvenin.${other}`,
      alan: 'sshHost',
      oneriler: [],
      hostAnahtari: problem,
    };
  }
  const reason = problem.iptal
    ? `${problem.host} host anahtarı iptal edilmiş (@revoked) olarak işaretli; bağlantı reddedildi.`
    : `${problem.host} host anahtarı kayıtlı anahtarla uyuşmuyor! Araya giren biri olabilir; bağlantı reddedildi.`;
  const where =
    problem.kaynak === 'kullanici'
      ? ` Kayıt ~/.ssh/known_hosts dosyanızda; Tezgah o dosyayı değiştirmez. Anahtar gerçekten değiştiyse: ssh-keygen -R "${sshAddress(problem.host, problem.port)}".`
      : '';
  return { kod: 'hostKeyMismatch', mesaj: reason + where, alan: 'sshHost', oneriler: [], hostAnahtari: problem };
}

/**
 * Bu hatada SSH sırrı penceresi açılır mı: yalnızca sırrı keychain'e kaydedilmeyen tünelde, sır
 * gerekiyorsa ya da reddedildiyse.
 */
export function asksForSshSecret(connection: Pick<Connection, 'ssh'>, kod: string | null | undefined): boolean {
  return connection.ssh !== null && !connection.ssh.saveSecret && (kod === 'sshSirGerekli' || kod === 'sshSirReddedildi');
}
