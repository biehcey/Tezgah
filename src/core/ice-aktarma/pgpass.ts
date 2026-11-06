/**
 * `.pgpass` (Windows'ta `pgpass.conf`) ayrıştırma ve libpq'nun şifre eşleme kuralı. IO yok: metin girer,
 * satırlar ve İçe aktarma adayları çıkar. Biçim: `host:port:veritabanı:kullanıcı:şifre`; `\:` ve `\\`
 * kaçışlıdır, `#` ile başlayan satır yorumdur, `*` alanı her değerle eşleşir.
 */
import { DEFAULT_DATABASE, DEFAULT_SSL } from '../baglanti';
import type { SourceCandidate } from './gruplama';
import { PGPASS_SOURCE_ID } from './sozlesme';

/** Bir `.pgpass` satırı; `*` jokeri olduğu gibi tutulur. */
export interface PgpassEntry {
  /** 1 tabanlı satır numarası. */
  line: number;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

export const WILDCARD = '*';

/** Satırları okur; yorum, boş, eksik alanlı ve şifresi boş satırlar atlanır. */
export function parsePgpass(text: string): PgpassEntry[] {
  const entries: PgpassEntry[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '' || raw.startsWith('#')) return;
    const fields = splitFields(raw);
    if (fields.length < 5) return;
    const [host, port, database, user, password] = fields as [string, string, string, string, string];
    if (password === '') return;
    entries.push({ line: index + 1, host, port, database, user, password });
  });
  return entries;
}

/** Kaçışlara uyarak `:` ile böler; libpq gibi şifre ilk kaçışsız `:`'ta biter. */
function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let i = 0; i < line.length && fields.length < 5; i++) {
    const ch = line[i]!;
    if (ch === '\\' && i + 1 < line.length) current += line[++i]!;
    else if (ch === ':') {
      fields.push(current);
      current = '';
    } else current += ch;
  }
  if (fields.length < 5) fields.push(current);
  return fields;
}

/** libpq kaçışlı `\*`'ı düz yıldız sayar; burada ayrım yapılmaz (`*` adlı host ya da kullanıcı olmaz). */
function matches(field: string, value: string): boolean {
  return field === WILDCARD || field === value;
}

export interface PgpassLookup {
  host: string;
  port: number;
  database: string;
  user: string;
}

/** Bulunan şifre ve hangi satırdan geldiği; `wildcard` satırda en az bir `*` olduğunu söyler. */
export interface PgpassMatch {
  line: number;
  password: string;
  wildcard: boolean;
}

/** libpq kuralı: dört alanı da eşleşen ilk satır. */
export function findPassword(entries: readonly PgpassEntry[], { host, port, database, user }: PgpassLookup): PgpassMatch | null {
  const found = entries.find(
    (e) => matches(e.host, host) && matches(e.port, String(port)) && matches(e.database, database) && matches(e.user, user),
  );
  if (!found) return null;
  const wildcard = [found.host, found.port, found.database, found.user].includes(WILDCARD);
  return { line: found.line, password: found.password, wildcard };
}

/** Somut bir `.pgpass` satırından çıkan aday; şifresi sonradan libpq kuralıyla aranır. */
export interface PgpassCandidate {
  line: number;
  host: string;
  port: number;
  user: string;
  /** Başlangıç veritabanı: satırdaki somut veritabanı ya da `postgres`. */
  database: string;
}

/** Host, port ve kullanıcısı somut (joker değil) satırlar aday olur; joker satırlar yalnızca şifre kaynağıdır. */
export function pgpassCandidates(entries: readonly PgpassEntry[]): PgpassCandidate[] {
  return entries.flatMap((e) => {
    if ([e.host, e.port, e.user].includes(WILDCARD)) return [];
    if (!/^\d+$/.test(e.port)) return [];
    const port = Number(e.port);
    if (port < 1 || port > 65535) return [];
    const database = e.database === WILDCARD ? DEFAULT_DATABASE : e.database;
    return [{ line: e.line, host: e.host, port, user: e.user, database }];
  });
}

/** Gruplamaya giren kaynak adayları: ad host'tur, klasörsüz, SSL `prefer`, tünelsiz. */
export function pgpassSourceCandidates(entries: readonly PgpassEntry[], fileName: string): SourceCandidate[] {
  return pgpassCandidates(entries).map((c) => ({
    source: { id: PGPASS_SOURCE_ID, label: `${fileName} satır ${c.line}` },
    name: c.host,
    host: c.host,
    port: c.port,
    user: c.user,
    database: c.database,
    databases: [c.database],
    ssh: null,
    ...DEFAULT_SSL,
    envTag: null,
    envReason: null,
    folder: null,
    warnings: [],
    tunnelUnmapped: false,
  }));
}
