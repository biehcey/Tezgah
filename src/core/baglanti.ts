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

export const DEFAULT_PORT = 5432;
export const DEFAULT_DATABASE = 'postgres';
/** Windows Credential Manager blob sınırı 2560 bayt (UTF-16); güvenli pay bırakılır. */
export const MAX_PASSWORD_LENGTH = 1024;

/** Veritabanı seçimi: görünür veritabanı ve görünür şemaları (`null`: varsayılan görünürlük). */
export interface DatabaseSelection {
  database: string;
  schemas: string[] | null;
}

/** `tezgah.json`'da saklanan Bağlantı. Şifre burada yoktur; keychain'dedir. */
export interface Connection {
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
  databaseSelection: DatabaseSelection[];
}

/**
 * Oluşturma/güncelleme girdisi. `password` verilmezse kayıtlı şifreye dokunulmaz;
 * boş dize kayıtlı şifreyi siler.
 */
export type ConnectionInput = Omit<Connection, 'id' | 'databaseSelection'> & { password: string | undefined };

export type ConnectionField = keyof ConnectionInput;

export type ParseResult =
  | { ok: true; value: ConnectionInput }
  | { ok: false; errors: Partial<Record<ConnectionField, string>> };

const COLOR = /^#[0-9a-f]{6}$/i;

export function parseConnectionInput(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { name: 'Geçersiz bağlantı girdisi' } };
  }
  const input = raw as Record<string, unknown>;
  const errors: Partial<Record<ConnectionField, string>> = {};

  const text = (field: ConnectionField, label: string, fallback?: string): string => {
    const value = input[field];
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || value.trim() === '') {
      errors[field] = `${label} gerekli`;
      return '';
    }
    return value.trim();
  };

  const name = text('name', 'Ad');
  const host = text('host', 'Host');
  const user = text('user', 'Kullanıcı');
  const database = text('database', 'Başlangıç veritabanı', DEFAULT_DATABASE);

  let port = DEFAULT_PORT;
  if (input.port !== undefined) {
    if (typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 1 && input.port <= 65535) {
      port = input.port;
    } else {
      errors.port = 'Port 1–65535 arasında bir tam sayı olmalı';
    }
  }

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

  let password: string | undefined;
  if (input.password !== undefined) {
    if (typeof input.password !== 'string') errors.password = 'Geçersiz şifre';
    else if (input.password.length > MAX_PASSWORD_LENGTH) {
      errors.password = `Şifre en fazla ${MAX_PASSWORD_LENGTH} karakter olabilir`;
    } else password = input.password;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, folderId, host, port, user, database, envTag, color, savePassword, password },
  };
}

/** Özel güvenlik davranışını yalnızca `prod` tetikler. */
export function isProd(tag: EnvTag | null | undefined): boolean {
  return tag === 'prod';
}

/** Yeni bağlantı: Veritabanı seçiminde yalnızca başlangıç veritabanı, şemalar varsayılan görünürlükte. */
export function newConnection(id: string, { password, ...fields }: ConnectionInput): Connection {
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
}

export interface DeleteConnectionResponse {
  password: 'silindi' | 'yok' | 'reddedildi';
}

export interface PasswordStatusResponse {
  password: PasswordStatus;
}

export interface ValidationErrorResponse {
  hata: string;
  alanlar: Partial<Record<ConnectionField, string>>;
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
