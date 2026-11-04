/**
 * Cmd/Ctrl+K hızlı geçiş: hedeflerin bulanık araması, bağlı bağlantıların gizli veritabanları ve
 * yapıştırılan `postgres://` URL'iyle aynı sunucuya giden bağlantılar. Arayüzden bağımsızdır.
 */
import { DEFAULT_PORT, isProd, type Connection } from './baglanti';
import { isConnectionUrl, parseConnectionUrl, type UrlFields } from './baglanti-url';
import { isTarget, type Target } from './veritabani-secimi';

/** Aksanları ve büyük/küçük harfi (Türkçe ı/İ dahil) yok sayan karşılaştırma biçimi. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i');
}

const SEPARATOR = /[\s/_\-.@:]/;

/**
 * Sorgunun harfleri metinde sırayla geçiyorsa puan, geçmiyorsa `null`. Boşluklar yok sayılır.
 * Kelime başına ve bir öncekinin hemen arkasına düşen harfler daha çok puan alır.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, '');
  const t = fold(text);
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const index = t.indexOf(char, from);
    if (index === -1) return null;
    score += 1;
    if (index === previous + 1) score += 3;
    else if (index === 0 || SEPARATOR.test(t[index - 1]!)) score += 3;
    previous = index;
    from = index + 1;
  }
  return score;
}

/** Paletteki bir hedef satırı: `bağlantı / veritabanı`. */
export interface TargetItem {
  connectionId: string;
  database: string;
  label: string;
  prod: boolean;
  /** Editörün şu anki hedefi. */
  current: boolean;
}

export function targetLabel(connection: Pick<Connection, 'name'>, database: string): string {
  return `${connection.name} / ${database}`;
}

function item(connection: Connection, database: string, target: Target | null): TargetItem {
  return {
    connectionId: connection.id,
    database,
    label: targetLabel(connection, database),
    prod: isProd(connection.envTag),
    current: isTarget(target, connection.id, database),
  };
}

/** Eşleşmeyenleri atar, kalanları puana göre (eşitlikte verilen sırayla) dizer. */
function rank(items: TargetItem[], query: string): TargetItem[] {
  return items
    .map((entry, index) => ({ entry, index, score: fuzzyScore(query, entry.label) }))
    .filter((r): r is typeof r & { score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.entry);
}

/**
 * *Hedefler*: tüm bağlantıların kayıtlı Veritabanı seçimindeki (görünür) veritabanları; bağlanmadan
 * bilinir. Boş sorguda bağlantı ve seçim sırasıyla.
 */
export function searchTargets(connections: readonly Connection[], query: string, target: Target | null): TargetItem[] {
  return rank(
    connections.flatMap((c) => c.databaseSelection.map((d) => item(c, d.database, target))),
    query,
  );
}

/**
 * *Gizli veritabanları*: bağlı bağlantıların sunucuda olup Veritabanı seçiminde olmayan
 * veritabanları. Listeyi kalabalıklaştırmasın diye yalnızca sorgu varken aranır.
 * `serverDatabases` yalnızca bağlı bağlantıları içerir (kimlik → `pg_database` listesi).
 */
export function searchHiddenDatabases(
  connections: readonly Connection[],
  serverDatabases: Readonly<Record<string, readonly string[]>>,
  query: string,
): TargetItem[] {
  if (!query.trim()) return [];
  return rank(
    connections.flatMap((c) => {
      const visible = new Set(c.databaseSelection.map((d) => d.database));
      return (serverDatabases[c.id] ?? []).filter((d) => !visible.has(d)).map((d) => item(c, d, null));
    }),
    query,
  );
}

export type UrlMatchResult = { ok: true; fields: UrlFields; matches: TargetItem[] } | { ok: false; reason: string };

/**
 * Palete yapıştırılan `postgres://` URL'i: aynı host (büyük/küçük harf duyarsız), port (yoksa 5432)
 * ve kullanıcıya giden mevcut bağlantılar; kullanıcı yazılmadıysa o sunucudaki tümü. Hedef URL'deki
 * veritabanıdır, yazılmadıysa bağlantının başlangıç veritabanı. Metin URL değilse `null`.
 */
export function matchUrl(connections: readonly Connection[], text: string, target: Target | null): UrlMatchResult | null {
  if (!isConnectionUrl(text)) return null;
  const parsed = parseConnectionUrl(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const { fields } = parsed;
  const host = (fields.host ?? 'localhost').toLowerCase();
  const port = fields.port ?? DEFAULT_PORT;
  const matches = connections
    .filter((c) => c.host.toLowerCase() === host && c.port === port && (fields.user === undefined || c.user === fields.user))
    .map((c) => item(c, fields.database ?? c.database, target));
  return { ok: true, fields, matches };
}
