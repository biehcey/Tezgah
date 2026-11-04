/**
 * Bağlantı URL'i: `postgres://` ve `postgresql://` ayrıştırılır ve (şifresiz) üretilir.
 * libpq `anahtar=değer` dizisi desteklenmez. URL hiçbir yerde saklanmaz; yalnızca alanlara dağıtılır.
 */
import { SSL_MODES, type SslMode } from './baglanti';

/** URL'den çıkarılan, forma dağıtılacak alanlar; URL'de olmayan alan yoktur. */
export interface UrlFields {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sslmode?: SslMode;
  sslrootcert?: string;
  sslcert?: string;
  sslkey?: string;
}

/** URL'in SSL parametreleri (libpq adlarıyla). */
export const URL_SSL_KEYS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'] as const;
export type UrlSsl = Pick<UrlFields, (typeof URL_SSL_KEYS)[number]>;

export type UrlParseResult =
  | { ok: true; fields: UrlFields; ignored: string[] }
  | { ok: false; reason: string };

const SCHEME = /^postgres(?:ql)?:\/\/(.*)$/is;

/** Query'de tanınan parametreler ve alan karşılıkları (libpq adlarıyla). */
const QUERY_FIELDS = {
  host: 'host',
  port: 'port',
  user: 'user',
  password: 'password',
  dbname: 'database',
  sslmode: 'sslmode',
  sslrootcert: 'sslrootcert',
  sslcert: 'sslcert',
  sslkey: 'sslkey',
} as const satisfies Record<string, keyof UrlFields>;

class UrlError extends Error {}

/** URL'e yazılacak bağlantı alanları; şifre hiçbir zaman yazılmaz. */
export type UrlSource = Required<Pick<UrlFields, 'host' | 'port' | 'user' | 'database'>> & UrlSsl;

/** Şifresiz `postgres://kullanıcı@host:port/veritabanı[?ssl…]` üretir. */
export function buildConnectionUrl(source: UrlSource): string {
  const host = source.host.includes(':') ? `[${source.host}]` : encodeURIComponent(source.host);
  const query = URL_SSL_KEYS.filter((key) => source[key] !== undefined && source[key] !== '')
    .map((key) => `${key}=${encodeURIComponent(source[key]!)}`);
  const url = `postgres://${encodeURIComponent(source.user)}@${host}:${source.port}/${encodeURIComponent(source.database)}`;
  return query.length ? `${url}?${query.join('&')}` : url;
}

export function isConnectionUrl(text: string): boolean {
  return SCHEME.test(text.trim());
}

export function parseConnectionUrl(text: string): UrlParseResult {
  try {
    return parse(text);
  } catch (err) {
    if (err instanceof UrlError) return { ok: false, reason: err.message };
    throw err;
  }
}

function parse(text: string): UrlParseResult {
  const scheme = SCHEME.exec(text.trim());
  if (!scheme) throw new UrlError('Yalnızca postgres:// ve postgresql:// URL’leri desteklenir');
  const [beforeQuery, query = ''] = split(scheme[1]!, '?');
  const [authority, path = ''] = split(beforeQuery, '/');
  const fields: UrlFields = {};

  const at = authority.lastIndexOf('@');
  if (at !== -1) {
    const [user, password] = split(authority.slice(0, at), ':');
    if (user) fields.user = decode(user);
    if (password !== undefined) fields.password = decode(password);
  }
  Object.assign(fields, parseHostPort(at === -1 ? authority : authority.slice(at + 1)));
  if (path) fields.database = decode(path);

  const ignored: string[] = [];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = split(pair, '=');
    const key = decode(rawKey);
    const value = decode(rawValue);
    if (!Object.hasOwn(QUERY_FIELDS, key)) {
      if (!ignored.includes(key)) ignored.push(key);
      continue;
    }
    const field = QUERY_FIELDS[key as keyof typeof QUERY_FIELDS];
    if (field === 'host') {
      if (value.includes(',')) throw multiHost();
      fields.host = value;
    } else if (field === 'port') fields.port = parsePort(value);
    else if (field === 'sslmode') {
      if (!SSL_MODES.includes(value as SslMode)) {
        throw new UrlError(`Geçersiz sslmode “${value}”; şunlardan biri olmalı: ${SSL_MODES.join(', ')}`);
      }
      fields.sslmode = value as SslMode;
    } else fields[field] = value;
  }
  return { ok: true, fields, ignored };
}

function parseHostPort(text: string): Pick<UrlFields, 'host' | 'port'> {
  if (text.includes(',')) throw multiHost();
  let host: string;
  let rest: string;
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close === -1) throw new UrlError('Geçersiz host: IPv6 adresinin “]” parantezi kapanmamış');
    host = text.slice(1, close);
    rest = text.slice(close + 1);
    if (rest && !rest.startsWith(':')) throw new UrlError('Geçersiz host: IPv6 adresinden sonra yalnızca :port gelebilir');
  } else {
    const colon = text.indexOf(':');
    host = colon === -1 ? text : text.slice(0, colon);
    rest = colon === -1 ? '' : text.slice(colon);
  }
  const result: Pick<UrlFields, 'host' | 'port'> = {};
  if (host) result.host = decode(host);
  if (rest) result.port = parsePort(rest.slice(1));
  return result;
}

function parsePort(text: string): number {
  const port = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!(port >= 1 && port <= 65535)) throw new UrlError(`Geçersiz port “${text}”; 1–65535 arasında olmalı`);
  return port;
}

function multiHost() {
  return new UrlError('Birden çok host içeren URL desteklenmez; tek bir sunucu adresi yapıştırın');
}

/** İlk ayırıcıdan böler; ayırıcı yoksa ikinci parça `undefined`. */
function split(text: string, separator: string): [string, string | undefined] {
  const index = text.indexOf(separator);
  return index === -1 ? [text, undefined] : [text.slice(0, index), text.slice(index + 1)];
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new UrlError(`Geçersiz yüzde kodlaması: “${text}”`);
  }
}
