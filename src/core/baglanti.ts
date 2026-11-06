/**
 * Bağlantı modeli ve girdisinin doğrulanması. Sunucu (yetkili doğrulama) ve web aynı tanımı kullanır.
 */

export const ENV_TAGS = ['local', 'dev', 'test', 'staging', 'prod'] as const;
export type EnvTag = (typeof ENV_TAGS)[number];

/** Etiket seçilip renk değiştirilmediğinde kullanılan renkler. */
export const DEFAULT_ENV_COLORS: Record<EnvTag, string> = {
  local: '#64748b',
  dev: '#16a34a',
  test: '#0891b2',
  staging: '#d97706',
  prod: '#dc2626',
};

/** libpq `sslmode` değerlerinden Tezgah'ın desteklediği küme (`allow` yok). */
export const SSL_MODES = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'] as const;
export type SslMode = (typeof SSL_MODES)[number];

/** SSL dosya yolları (libpq adlarıyla): CA, istemci sertifikası, istemci anahtarı. */
export const SSL_PATH_FIELDS = ['sslrootcert', 'sslcert', 'sslkey'] as const;
export type SslPathField = (typeof SSL_PATH_FIELDS)[number];

/**
 * Bağlantının SSL ayarları. Dosyalar yerinde kalır, yalnızca yolları saklanır; `~/` ev dizinidir.
 * Verilmeyen yol `null`: CA yoksa `verify-full` sistem CA'larını kullanır.
 */
export interface SslSettings {
  sslmode: SslMode;
  sslrootcert: string | null;
  sslcert: string | null;
  sslkey: string | null;
}

export const DEFAULT_SSL: SslSettings = { sslmode: 'prefer', sslrootcert: null, sslcert: null, sslkey: null };

export const SSL_PATH_LABELS: Record<SslPathField, string> = {
  sslrootcert: 'CA dosyası',
  sslcert: 'İstemci sertifikası',
  sslkey: 'İstemci anahtarı',
};

export function isSslPathField(field: string | null | undefined): field is SslPathField {
  return (SSL_PATH_FIELDS as readonly (string | null | undefined)[]).includes(field);
}

/** Modun kullandığı dosyalar: `disable` hiçbirini, `prefer` CA'yı kullanmaz (doğrulamaz). */
export function sslPathsUsed(sslmode: SslMode): SslPathField[] {
  if (sslmode === 'disable') return [];
  if (sslmode === 'prefer') return ['sslcert', 'sslkey'];
  return [...SSL_PATH_FIELDS];
}

/** Mutlak yol (POSIX, Windows sürücü ya da UNC) ya da `~/` ile başlayan yol. */
const ABSOLUTE_PATH = /^(?:~[\\/]|\/|[A-Za-z]:[\\/]|\\\\)/;

export const DEFAULT_PORT = 5432;
export const DEFAULT_DATABASE = 'postgres';
/** Windows Credential Manager blob sınırı 2560 bayt (UTF-16); güvenli pay bırakılır. */
export const MAX_PASSWORD_LENGTH = 1024;

export const SSH_AUTHS = ['password', 'key', 'agent'] as const;
export type SshAuth = (typeof SSH_AUTHS)[number];
export const DEFAULT_SSH_PORT = 22;

/**
 * Tünel ayarı. Özel anahtar diskte yerinde kalır, yalnızca yolu saklanır. `agentPath` boşsa platform
 * varsayılanı (macOS `SSH_AUTH_SOCK`, Windows OpenSSH agent pipe'ı); Pageant'ın pipe'ı elle girilir.
 * Kullanılmayan yol (ör. agent'tayken `keyPath`) saklanır, yöntem değişince kaybolmasın.
 * İleride ProxyJump için `jumps[]` eklenebilir.
 */
export interface SshSettings {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  keyPath: string | null;
  agentPath: string | null;
  /** SSH şifresi ya da passphrase keychain'e (`<id>:ssh`) kaydedilsin mi; değilse ilk açılışta sorulur. */
  saveSecret: boolean;
}

/** SSH alanlarının hata anahtarları (formdaki alanlarla aynı adlar). */
export type SshField =
  | 'ssh'
  | 'sshHost'
  | 'sshPort'
  | 'sshUser'
  | 'sshAuth'
  | 'sshKeyPath'
  | 'sshAgentPath'
  | 'sshSaveSecret'
  | 'sshSecret';

export const SSH_AUTH_LABELS: Record<SshAuth, string> = { password: 'şifre', key: 'anahtar', agent: 'agent' };

/** Kapalı SSH bölümünün tek satırlık özeti: `deploy@bastion · anahtar`. */
export function sshSummary(ssh: Pick<SshSettings, 'host' | 'port' | 'user' | 'auth'> | null): string {
  if (!ssh) return 'kapalı';
  return `${ssh.user}@${ssh.host}${ssh.port === DEFAULT_SSH_PORT ? '' : `:${ssh.port}`} · ${SSH_AUTH_LABELS[ssh.auth]}`;
}

/** Veritabanı seçimi: görünür veritabanı ve görünür şemaları (`null`: varsayılan görünürlük). */
export interface DatabaseSelection {
  database: string;
  schemas: string[] | null;
}

/** `tezgah.json`'da saklanan Bağlantı. Şifre burada yoktur; keychain'dedir. */
export interface Connection extends SslSettings {
  id: string;
  name: string;
  folderId: string | null;
  host: string;
  port: number;
  user: string;
  /** Başlangıç veritabanı. */
  database: string;
  envTag: EnvTag | null;
  color: string | null;
  /** Şifre keychain'e kaydedilsin mi; değilse ilk bağlanmada sorulur, yalnızca bellekte tutulur. */
  savePassword: boolean;
  /** Tünel; `null` ise doğrudan bağlanılır. */
  ssh: SshSettings | null;
  databaseSelection: DatabaseSelection[];
}

/**
 * Oluşturma/güncelleme girdisi. `password` verilmezse kayıtlı şifreye dokunulmaz;
 * boş dize kayıtlı şifreyi siler.
 */
export type ConnectionInput = Omit<Connection, 'id' | 'databaseSelection'> & {
  password: string | undefined;
  /** SSH şifresi ya da passphrase; `password` ile aynı kurallar (`<id>:ssh` keychain girdisi). */
  sshSecret: string | undefined;
};

export type ConnectionField = Exclude<keyof ConnectionInput, 'ssh'> | SshField;

export type ParseResult =
  | { ok: true; value: ConnectionInput }
  | { ok: false; errors: Partial<Record<ConnectionField, string>> };

const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Bağlantı girdisi ile bağlantı testi girdisinin ortak alan okuyucuları. Geçersiz alanın
 * hatası `errors`'a yazılır; dönen değer o zaman yalnızca yer tutucudur.
 */
export function connectionFieldReader(input: Record<string, unknown>, errors: Partial<Record<string, string>>) {
  return {
    text(field: string, label: string, fallback?: string): string {
      const value = input[field];
      if (value === undefined && fallback !== undefined) return fallback;
      if (typeof value !== 'string' || value.trim() === '') {
        errors[field] = `${label} gerekli`;
        return '';
      }
      return value.trim();
    },
    port(): number {
      const value = input.port;
      if (value === undefined) return DEFAULT_PORT;
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) return value;
      errors.port = 'Port 1–65535 arasında bir tam sayı olmalı';
      return DEFAULT_PORT;
    },
    password(field: 'password' | 'sshSecret' = 'password'): string | undefined {
      const value = input[field];
      if (value === undefined) return undefined;
      if (typeof value !== 'string') errors[field] = 'Geçersiz şifre';
      else if (value.length > MAX_PASSWORD_LENGTH) errors[field] = `Şifre en fazla ${MAX_PASSWORD_LENGTH} karakter olabilir`;
      else return value;
      return undefined;
    },
    /** Tünel ayarı; verilmezse ya da `null`'sa tünel yok. Yalnızca seçilen yöntemin yolu doğrulanır. */
    ssh(): SshSettings | null {
      const raw = input.ssh;
      if (raw === undefined || raw === null) return null;
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors.ssh = 'Geçersiz SSH ayarı';
        return null;
      }
      const ssh = raw as Record<string, unknown>;
      const text = (field: string, key: SshField, label: string): string => {
        const value = ssh[field];
        if (typeof value === 'string' && value.trim() !== '') return value.trim();
        errors[key] = `${label} gerekli`;
        return '';
      };
      const optionalPath = (field: string): string | null => {
        const value = ssh[field];
        return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
      };
      const host = text('host', 'sshHost', 'SSH host');
      const user = text('user', 'sshUser', 'SSH kullanıcısı');
      let port = DEFAULT_SSH_PORT;
      if (ssh.port !== undefined) {
        if (typeof ssh.port === 'number' && Number.isInteger(ssh.port) && ssh.port >= 1 && ssh.port <= 65535) port = ssh.port;
        else errors.sshPort = 'Port 1–65535 arasında bir tam sayı olmalı';
      }
      let auth: SshAuth = 'password';
      if (SSH_AUTHS.includes(ssh.auth as SshAuth)) auth = ssh.auth as SshAuth;
      else errors.sshAuth = `Kimlik doğrulama şunlardan biri olmalı: ${SSH_AUTHS.join(', ')}`;
      const keyPath = optionalPath('keyPath');
      const agentPath = optionalPath('agentPath');
      if (auth === 'key') {
        if (keyPath === null) errors.sshKeyPath = 'Anahtar dosyası gerekli';
        else if (!ABSOLUTE_PATH.test(keyPath)) errors.sshKeyPath = 'Anahtar dosyası için tam yol girin (ör. ~/.ssh/id_ed25519)';
      }
      let saveSecret = true;
      if (ssh.saveSecret !== undefined) {
        if (typeof ssh.saveSecret === 'boolean') saveSecret = ssh.saveSecret;
        else errors.sshSaveSecret = 'Geçersiz değer';
      }
      return { host, port, user, auth, keyPath, agentPath, saveSecret };
    },
    /**
     * `sslmode` ve dosya yolları. Yalnızca modun kullandığı yollar doğrulanır (sertifika ile anahtar
     * birlikte); diğerleri olduğu gibi saklanır, mod değişince kaybolmasın.
     */
    ssl(): SslSettings {
      let sslmode: SslMode = DEFAULT_SSL.sslmode;
      if (input.sslmode !== undefined) {
        if (SSL_MODES.includes(input.sslmode as SslMode)) sslmode = input.sslmode as SslMode;
        else errors.sslmode = `sslmode şunlardan biri olmalı: ${SSL_MODES.join(', ')}`;
      }
      const used = sslPathsUsed(sslmode);
      const paths = {} as Record<SslPathField, string | null>;
      for (const field of SSL_PATH_FIELDS) {
        const value = input[field];
        paths[field] = null;
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) continue;
        if (typeof value !== 'string') errors[field] = `Geçersiz ${SSL_PATH_LABELS[field]}`;
        else if (!used.includes(field)) paths[field] = value.trim();
        else if (!ABSOLUTE_PATH.test(value.trim())) {
          errors[field] = `${SSL_PATH_LABELS[field]} için tam yol girin (ör. /etc/ssl/ca.pem ya da ~/.postgresql/root.crt)`;
        } else paths[field] = value.trim();
      }
      const client = used.includes('sslcert');
      if (client && paths.sslcert !== null && paths.sslkey === null && !errors.sslkey) {
        errors.sslkey = 'İstemci sertifikasıyla birlikte anahtarı da gerekli';
      }
      if (client && paths.sslkey !== null && paths.sslcert === null && !errors.sslcert) {
        errors.sslcert = 'İstemci anahtarıyla birlikte sertifikası da gerekli';
      }
      return { sslmode, ...paths };
    },
  };
}

export function parseConnectionInput(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { name: 'Geçersiz bağlantı girdisi' } };
  }
  const input = raw as Record<string, unknown>;
  const errors: Partial<Record<ConnectionField, string>> = {};
  const read = connectionFieldReader(input, errors);

  const name = read.text('name', 'Ad');
  const host = read.text('host', 'Host');
  const user = read.text('user', 'Kullanıcı');
  const database = read.text('database', 'Başlangıç veritabanı', DEFAULT_DATABASE);
  const port = read.port();

  let envTag: EnvTag | null = null;
  if (input.envTag !== undefined && input.envTag !== null) {
    if (ENV_TAGS.includes(input.envTag as EnvTag)) envTag = input.envTag as EnvTag;
    else errors.envTag = `Ortam etiketi şunlardan biri olmalı: ${ENV_TAGS.join(', ')}`;
  }

  let color: string | null = envTag ? DEFAULT_ENV_COLORS[envTag] : null;
  if (input.color !== undefined && input.color !== null) {
    if (typeof input.color === 'string' && COLOR.test(input.color)) color = input.color.toLowerCase();
    else errors.color = 'Renk #rrggbb biçiminde olmalı';
  }

  let folderId: string | null = null;
  if (input.folderId !== undefined && input.folderId !== null) {
    if (typeof input.folderId === 'string') folderId = input.folderId;
    else errors.folderId = 'Geçersiz klasör';
  }

  let savePassword = true;
  if (input.savePassword !== undefined) {
    if (typeof input.savePassword === 'boolean') savePassword = input.savePassword;
    else errors.savePassword = 'Geçersiz değer';
  }

  const password = read.password();
  const ssl = read.ssl();
  const ssh = read.ssh();
  const sshSecret = read.password('sshSecret');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, folderId, host, port, user, database, envTag, color, savePassword, password, ...ssl, ssh, sshSecret },
  };
}

/** Özel güvenlik davranışını yalnızca `prod` tetikler. */
export function isProd(tag: EnvTag | null | undefined): boolean {
  return tag === 'prod';
}

/** Yeni bağlantı: Veritabanı seçiminde yalnızca başlangıç veritabanı, şemalar varsayılan görünürlükte. */
export function newConnection(id: string, { password, sshSecret, ...fields }: ConnectionInput): Connection {
  return { id, ...fields, databaseSelection: [{ database: fields.database, schemas: null }] };
}

/** Kaydet/güncelle sonrasında keychain'deki şifreye ne yapılacağı. */
export type PasswordAction = 'yaz' | 'sil' | 'dokunma';

export function passwordAction(
  { savePassword, password }: Pick<ConnectionInput, 'savePassword' | 'password'>,
  { isNew }: { isNew: boolean },
): PasswordAction {
  if (!savePassword || password === '') return isNew ? 'dokunma' : 'sil';
  return password === undefined ? 'dokunma' : 'yaz';
}

/** Liste satırındaki adres: `kullanıcı@host`, varsayılan dışı portta `:port` ile. */
export function connectionAddress(c: Pick<Connection, 'user' | 'host' | 'port'>): string {
  return `${c.user}@${c.host}${c.port === DEFAULT_PORT ? '' : `:${c.port}`}`;
}

// --- REST sözleşmesi: sır değeri hiçbir zaman döndürülmez, yalnızca keychain sonucu döner. ---

/** Kaydet/güncelle sonrası şifreye ne olduğu. */
export type PasswordWriteOutcome = 'kaydedildi' | 'silindi' | 'degismedi' | 'reddedildi';
/** Keychain'de kayıtlı şifre var mı; "Deny" ayrı bir sonuçtur. */
export type PasswordStatus = 'bulundu' | 'yok' | 'reddedildi';

export interface SaveConnectionResponse {
  connection: Connection;
  password: PasswordWriteOutcome;
  /** SSH şifresi ya da passphrase'e (`<id>:ssh`) ne olduğu. */
  sshSecret: PasswordWriteOutcome;
}

export interface DeleteConnectionResponse {
  password: 'silindi' | 'yok' | 'reddedildi';
  sshSecret: 'silindi' | 'yok' | 'reddedildi';
}

export interface PasswordStatusResponse {
  password: PasswordStatus;
  /** Tünel yoksa, sır kaydı kapalıysa ya da agent'ta `yok`. */
  sshSecret: PasswordStatus;
}

export interface ValidationErrorResponse<F extends string = ConnectionField> {
  hata: string;
  alanlar: Partial<Record<F, string>>;
}

/** Kopyanın adı: `ad (kopya)`; o ad alınmışsa `ad (kopya 2)`, `ad (kopya 3)`… */
export function copyName(name: string, taken: readonly string[]): string {
  const names = new Set(taken);
  let candidate = `${name} (kopya)`;
  for (let n = 2; names.has(candidate); n++) candidate = `${name} (kopya ${n})`;
  return candidate;
}

/** Kopya: aynı alanlar ve Veritabanı seçimi, yeni kimlik ve ad. */
export function copyConnection(source: Connection, id: string, taken: readonly string[]): Connection {
  const databaseSelection = source.databaseSelection.map((d) => ({ ...d, schemas: d.schemas && [...d.schemas] }));
  return { ...source, id, name: copyName(source.name, taken), databaseSelection };
}

// --- Oturumluk şifre: keychain'e kaydedilmeyen bağlantının şifresi Tezgah kapanana kadar bellekte. ---

/** Şifre penceresinden gelen gövde. `saveToKeychain` bağlantı ayarını "Keychain'e kaydet"e çevirir. */
export interface SessionPasswordRequest {
  password: string;
  saveToKeychain: boolean;
  /** Hangi sır: veritabanı şifresi ya da SSH şifresi/passphrase. */
  secret: SessionSecret;
}

export type SessionSecret = 'veritabani' | 'ssh';

/** Şifre nereye kondu: yalnızca bellekte, keychain'de; ya da keychain reddetti ve bellekte kaldı. */
export type SessionPasswordOutcome = 'oturumda' | 'kaydedildi' | 'reddedildi';

export interface SessionPasswordResponse {
  connection: Connection;
  password: SessionPasswordOutcome;
}

export function parseSessionPasswordInput(
  raw: unknown,
): { ok: true; value: SessionPasswordRequest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'Geçersiz şifre girdisi' };
  const { password, saveToKeychain = false, secret = 'veritabani' } = raw as Record<string, unknown>;
  if (typeof password !== 'string' || password === '') return { ok: false, error: 'Şifre gerekli' };
  if (password.length > MAX_PASSWORD_LENGTH) return { ok: false, error: `Şifre en fazla ${MAX_PASSWORD_LENGTH} karakter olabilir` };
  if (typeof saveToKeychain !== 'boolean') return { ok: false, error: 'Geçersiz değer' };
  if (secret !== 'veritabani' && secret !== 'ssh') return { ok: false, error: 'Geçersiz sır türü' };
  return { ok: true, value: { password, saveToKeychain, secret } };
}
