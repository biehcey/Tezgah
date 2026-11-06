/**
 * OpenSSH `known_hosts` biçimi (sshd(8) "SSH_KNOWN_HOSTS FILE FORMAT"): ayrıştırma, bir host anahtarının
 * denetlenmesi, yeni satır üretme, bir host'un satırlarını silme ve SHA256 parmak izi. Hem kullanıcının
 * `~/.ssh/known_hosts`'u hem Tezgah'ın kendi deposu bununla okunur.
 *
 * Anahtarlar SSH wire biçimindeki public key blob'unun base64'üdür (satırdaki anahtar alanı). core Node'a
 * bağımlı olmasın diye hash fonksiyonları dışarıdan verilir.
 */

export interface KnownHostsCrypto {
  /** HMAC-SHA1: anahtar base64 (hashed girdinin tuzu), veri UTF-8 metin; sonuç base64. */
  hmacSha1(saltBase64: string, text: string): string;
  /** base64 verinin baytlarının SHA-256'sı; sonuç base64. */
  sha256(dataBase64: string): string;
}

export interface HostKeyTarget {
  host: string;
  port: number;
  /** Sunulan anahtar (base64 blob). */
  key: string;
}

export type HostKeyCheck =
  | { sonuc: 'eslesti' }
  /** `digerTurler`: host için kayıtlı olan başka türdeki anahtarlar (OpenSSH de bunu uyuşmazlık saymaz). */
  | { sonuc: 'bilinmiyor'; digerTurler: string[] }
  /** Aynı türde başka anahtar kayıtlı ya da sunulan anahtar `@revoked`. */
  | { sonuc: 'uyusmazlik'; kayitli: string[]; iptal: boolean };

interface Entry {
  marker: 'revoked' | 'cert-authority' | null;
  /** Hashed girdi (`|1|tuz|hash`) ya da virgüllü desen listesi. */
  hosts: { hashed: { salt: string; hash: string } } | { patterns: string[] };
  keyType: string;
  key: string;
}

const DEFAULT_SSH_PORT = 22;

/** known_hosts'ta host'un adı: port 22'de yalın ad, diğerlerinde `[ad]:port`. */
function lookupName(host: string, port: number): string {
  const name = host.toLowerCase();
  return port === DEFAULT_SSH_PORT ? name : `[${name}]:${port}`;
}

function parseLine(line: string): Entry | null {
  const fields = line.trim().split(/\s+/);
  if (fields[0] === undefined || fields[0] === '' || fields[0].startsWith('#')) return null;
  let marker: Entry['marker'] = null;
  if (fields[0] === '@revoked' || fields[0] === '@cert-authority') {
    marker = fields[0] === '@revoked' ? 'revoked' : 'cert-authority';
    fields.shift();
  } else if (fields[0].startsWith('@')) return null;
  const [hostField, keyType, key] = fields;
  if (hostField === undefined || keyType === undefined || key === undefined) return null;
  if (hostField.startsWith('|')) {
    const match = /^\|1\|([^|]+)\|([^|]+)$/.exec(hostField);
    if (!match) return null;
    return { marker, hosts: { hashed: { salt: match[1]!, hash: match[2]! } }, keyType, key };
  }
  return { marker, hosts: { patterns: hostField.toLowerCase().split(',') }, keyType, key };
}

function parse(text: string): { line: string; entry: Entry | null }[] {
  return text.split('\n').map((line) => ({ line, entry: parseLine(line) }));
}

/** `*` ve `?` jokerli desen. */
function globMatches(pattern: string, name: string): boolean {
  const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(name);
}

function hostMatches(entry: Entry, name: string, crypto: KnownHostsCrypto): boolean {
  if ('hashed' in entry.hosts) {
    const { salt, hash } = entry.hosts.hashed;
    try {
      return crypto.hmacSha1(salt, name) === hash;
    } catch {
      return false;
    }
  }
  let matched = false;
  for (const pattern of entry.hosts.patterns) {
    const negated = pattern.startsWith('!');
    if (!globMatches(negated ? pattern.slice(1) : pattern, name)) continue;
    // Olumsuzlanan desen eşleşirse satır, diğer desenlerden bağımsız olarak bu host'a uygulanmaz.
    if (negated) return false;
    matched = true;
  }
  return matched;
}

/**
 * Sunulan anahtarı dosyadaki satırlara karşı denetler. Eşleşen bir `@revoked` satırı her zaman reddeder;
 * aksi hâlde host'un satırlarından biri anahtarla aynıysa eşleşir, aynı türde başka anahtar varsa uyuşmazlıktır.
 */
export function checkHostKey(text: string, { host, port, key }: HostKeyTarget, crypto: KnownHostsCrypto): HostKeyCheck {
  const name = lookupName(host, port);
  const type = hostKeyType(key);
  const entries = parse(text).flatMap(({ entry }) => (entry ? [entry] : []));
  if (entries.some((e) => e.marker === 'revoked' && e.key === key && hostMatches(e, name, crypto))) {
    return { sonuc: 'uyusmazlik', kayitli: [hostKeyFingerprint(key, crypto)], iptal: true };
  }
  const forHost = entries.filter((e) => e.marker === null && hostMatches(e, name, crypto));
  if (forHost.some((e) => e.key === key)) return { sonuc: 'eslesti' };
  const sameType = forHost.filter((e) => e.keyType === type);
  if (sameType.length > 0) {
    return { sonuc: 'uyusmazlik', kayitli: unique(sameType.map((e) => hostKeyFingerprint(e.key, crypto))), iptal: false };
  }
  return { sonuc: 'bilinmiyor', digerTurler: unique(forHost.map((e) => e.keyType)) };
}

/** Onaylanan anahtar için yeni satır (hashed değil; Tezgah'ın deposu okunabilir kalsın). */
export function knownHostsLine({ host, port, key }: HostKeyTarget): string {
  return `${lookupName(host, port)} ${hostKeyType(key) ?? 'unknown'} ${key}`;
}

/** Host'a uygulanan (hashed dahil) satırları siler; "Kayıtlı host anahtarını unut". */
export function forgetHost(
  text: string,
  { host, port }: Omit<HostKeyTarget, 'key'>,
  crypto: KnownHostsCrypto,
): { text: string; removed: number } {
  const name = lookupName(host, port);
  const lines = parse(text);
  const kept = lines.filter(({ entry }) => !(entry && entry.marker === null && hostMatches(entry, name, crypto)));
  return { text: kept.map((l) => l.line).join('\n'), removed: lines.length - kept.length };
}

/** OpenSSH'ın gösterdiği parmak izi: `SHA256:` + padding'siz base64. */
export function hostKeyFingerprint(key: string, crypto: KnownHostsCrypto): string {
  return `SHA256:${crypto.sha256(key).replace(/=+$/, '')}`;
}

/** Blob'un ilk alanı (uint32 uzunluk + ad) anahtar türüdür; okunamazsa `null`. */
export function hostKeyType(key: string): string | null {
  const bytes = decodeBase64Prefix(key, 64);
  if (bytes === null || bytes.length < 4) return null;
  const length = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (length === 0 || length > 60 || bytes.length < 4 + length) return null;
  const name = String.fromCharCode(...bytes.slice(4, 4 + length));
  return /^[a-z0-9@.+-]+$/i.test(name) ? name : null;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64'ün en fazla `max` baytlık başını çözer; geçersiz karakterde `null`. */
function decodeBase64Prefix(text: string, max: number): number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.replace(/=+$/, '')) {
    const value = BASE64.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      if (bytes.length >= max) return bytes;
    }
  }
  return bytes;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
