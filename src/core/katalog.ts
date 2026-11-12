/**
 * Katalog önbelleği (GLOSSARY): bir hedefin görünür şemalarındaki ilişkiler, kolonları ve tipleri.
 * Sunucu okur ve tutar; arayüz bundan editör tamamlamasını, tablo listesini ve tablo aramasını kurar.
 * Fonksiyonlar tamamlamaya girmez.
 */
import type { Statement } from './ifade-bolme';
import { quoteIdent } from './grid/sql';

/** `pg_class.relkind`: tablo, view, materialized view, bölümlü tablo, foreign tablo. */
export type RelationKind = 'r' | 'v' | 'm' | 'p' | 'f';
export const RELATION_KINDS: readonly RelationKind[] = ['r', 'v', 'm', 'p', 'f'];

export interface CatalogColumn {
  ad: string;
  /** `format_type(atttypid, atttypmod)`, ör. `character varying(20)`. */
  tip: string;
  tipOid: number;
  notNull: boolean;
  /** `atthasdef`: kolonun varsayılan ifadesi var. */
  varsayilan: boolean;
  /** `attgenerated`: üretilmiş kolon (yazılamaz). */
  uretilmis: boolean;
}

export interface CatalogRelation {
  sema: string;
  ad: string;
  tur: RelationKind;
  /** `attnum` sırasıyla. */
  kolonlar: CatalogColumn[];
  /** PK kolonları, indeks sırasıyla; PK yoksa boş. */
  pk: string[];
  /** `pg_class.reltuples`: tahmini satır sayısı; `-1` hiç analiz edilmedi. */
  reltuples: number;
}

/** `GET …/katalog` yanıtı. */
export interface Catalog {
  /** `(current_schemas(false))[1]`: `search_path`'in ilk (var olan) şeması; yoksa `null`. */
  defaultSchema: string | null;
  /** Katalogun okunduğu görünür şemalar, sunucudaki sırayla. */
  semalar: string[];
  /** Şema, sonra ad sırasıyla. */
  iliskiler: CatalogRelation[];
  /** Görünür şemalar + `pg_catalog` tiplerinin OID → `format_type` adı. */
  tipler: Record<string, string>;
  /** Görünür şemalardaki kullanıcı tipleri (enum, domain, bileşik, aralık…), `format_type` adıyla. */
  kullaniciTipleri: string[];
}

/** Katalogun tip eşlemesi; "INSERT olarak kopyala" OID'leri bununla çözer. */
export function typeMap(catalog: Catalog): Map<number, string> {
  return new Map(Object.entries(catalog.tipler).map(([oid, ad]) => [Number(oid), ad]));
}

// --- Tamamlama ---

/** `@codemirror/lang-sql`'in `Completion`'ıyla yapısal olarak uyumlu öneri. */
export interface CompletionOption {
  label: string;
  type: string;
  detail?: string;
  apply?: string;
}

/** `@codemirror/lang-sql`'in `SQLNamespace`'iyle yapısal olarak uyumlu ağaç. */
export type CompletionNamespace =
  | { [name: string]: CompletionNamespace }
  | { self: CompletionOption; children: CompletionNamespace }
  | readonly CompletionOption[];

export interface CompletionConfig {
  schema: CompletionNamespace;
  /** Verilirse bu şemanın tabloları öneksiz önerilir. */
  defaultSchema?: string;
  /** Verilirse bu tablonun (`defaultSchema`'da) kolonları öneksiz önerilir. */
  defaultTable?: string;
}

const KIND_LABELS: Record<RelationKind, string> = {
  r: 'tablo',
  v: 'view',
  m: 'materialized view',
  p: 'bölümlü tablo',
  f: 'foreign tablo',
};

/** Postgres'in ayrılmış anahtar kelimeleri: tanımlayıcı olarak tırnak ister. */
const RESERVED = new Set(
  (
    'all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation ' +
    'column concurrently constraint create cross current_catalog current_date current_role current_schema current_time ' +
    'current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign freeze ' +
    'from full grant group having ilike in initially inner intersect into is isnull join lateral leading left like limit ' +
    'localtime localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references ' +
    'returning right select session_user similar some symmetric system_user table tablesample then to trailing true union ' +
    'unique user using variadic verbose when where window with'
  ).split(' '),
);

/** Çıplak yazılınca aynı adı veren tanımlayıcı mı (küçük harf, anahtar kelime değil). */
function isBareIdent(name: string): boolean {
  return /^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name);
}

function option(label: string, type: string, detail?: string): CompletionOption {
  return { label, type, ...(detail !== undefined && { detail }), ...(!isBareIdent(label) && { apply: quoteIdent(label) }) };
}

/** lang-sql nesne anahtarlarındaki `.`'yı yol ayırıcısı sayar; adın parçası olan nokta kaçışlanır. */
const namespaceKey = (name: string) => name.replaceAll('.', '\\.');

/**
 * Katalog → editör tamamlaması: görünür şemaların ilişkileri ve kolonları (tip `detail`'de).
 * `defaultSchema` görünürse onun tabloları öneksiz de önerilir.
 */
export function catalogCompletion(catalog: Catalog, visibleSchemas: readonly string[]): CompletionConfig {
  const visible = new Set(visibleSchemas);
  const schema: Record<string, { self: CompletionOption; children: Record<string, CompletionNamespace> }> = {};
  for (const r of catalog.iliskiler) {
    if (!visible.has(r.sema)) continue;
    const entry = (schema[namespaceKey(r.sema)] ??= { self: option(r.sema, 'namespace'), children: {} });
    entry.children[namespaceKey(r.ad)] = {
      self: option(r.ad, 'type', KIND_LABELS[r.tur]),
      children: r.kolonlar.map((k) => option(k.ad, 'property', k.tip)),
    };
  }
  const defaultSchema = catalog.defaultSchema;
  return { schema, ...(defaultSchema !== null && visible.has(defaultSchema) && { defaultSchema }) };
}

/**
 * Tablo sekmesinin `WHERE` / `ORDER BY` kutuları: editörle aynı ağaç, ama varsayılan şema tablonun
 * şeması ve tablonun kolonları öneksiz önerilir.
 */
export function filterCompletion(catalog: Catalog, visibleSchemas: readonly string[], sema: string, tablo: string): CompletionConfig {
  return { schema: catalogCompletion(catalog, visibleSchemas).schema, defaultSchema: sema, defaultTable: tablo };
}

/**
 * Tablo listesi ve Cmd/Ctrl+K tablo araması: görünür şemaların ilişkileri, büyük/küçük harf
 * duyarsız alt dize ("şema.ad" biçimi de eşleşir). Adı sorguyla başlayanlar önce; sonra şema, ad.
 */
export function searchTables(catalog: Catalog, visibleSchemas: readonly string[], query: string): CatalogRelation[] {
  const q = query.trim().toLowerCase();
  const visible = new Set(visibleSchemas);
  const scored: { r: CatalogRelation; prefix: boolean }[] = [];
  for (const r of catalog.iliskiler) {
    if (!visible.has(r.sema)) continue;
    const ad = r.ad.toLowerCase();
    if (q === '' || ad.includes(q) || `${r.sema.toLowerCase()}.${ad}`.includes(q)) {
      scored.push({ r, prefix: q !== '' && (ad.startsWith(q) || `${r.sema.toLowerCase()}.${ad}`.startsWith(q)) });
    }
  }
  const byName = (a: CatalogRelation, b: CatalogRelation) => compare(a.sema, b.sema) || compare(a.ad, b.ad);
  return scored.sort((a, b) => Number(b.prefix) - Number(a.prefix) || byName(a.r, b.r)).map((s) => s.r);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// --- DDL sonrası yenileme ---

const CATALOG_VERBS = new Set(['CREATE', 'ALTER', 'DROP', 'IMPORT']);

/** Script katalogu değiştirebilen bir ifade içeriyor mu (DDL ya da `SELECT … INTO`). */
export function changesCatalog(statements: readonly Statement[]): boolean {
  return statements.some((s) => {
    const verb = s.keywords[0];
    if (verb === undefined) return false;
    return CATALOG_VERBS.has(verb) || (verb === 'SELECT' && s.words.includes('INTO'));
  });
}

// --- Okuma ---

/** Katalog sorgularının satırları; tüm değerler metin olarak gelir (bkz. sunucunun `RAW_TYPES`'ı). */
export interface CatalogRows {
  /** Görünür şemalar, sunucudaki sırayla. */
  semalar: readonly string[];
  defaultSchema: string | null;
  /** İlişki başına en az bir satır; kolonu olmayan ilişkide kolon alanları `null`. */
  iliskiler: readonly Record<string, string | null>[];
  tipler: readonly Record<string, string | null>[];
}

/** Postgres'in `bool` metni (`t` ya da `::text` ile `true`). */
export const pgBool = (v: string | null | undefined) => v === 't' || v === 'true';

/**
 * Sorgu satırlarından katalog: kolon satırları ilişkilerine toplanır, PK kolonları indeks sırasına
 * dizilir. Tanınmayan `relkind` atlanır.
 */
export function buildCatalog({ semalar, defaultSchema, iliskiler, tipler }: CatalogRows): Catalog {
  const relations = new Map<string, CatalogRelation & { pkSira: { ad: string; sira: number }[] }>();
  for (const row of iliskiler) {
    const tur = row.tur as RelationKind;
    if (!RELATION_KINDS.includes(tur) || row.sema == null || row.ad == null) continue;
    const key = `${row.sema}\u0000${row.ad}`;
    let r = relations.get(key);
    if (!r) {
      const reltuples = Number(row.satir);
      r = { sema: row.sema, ad: row.ad, tur, kolonlar: [], pk: [], reltuples: Number.isFinite(reltuples) ? reltuples : -1, pkSira: [] };
      relations.set(key, r);
    }
    if (row.kolon == null) continue;
    r.kolonlar.push({
      ad: row.kolon,
      tip: row.tip ?? '',
      tipOid: Number(row.tip_oid),
      notNull: pgBool(row.not_null),
      varsayilan: pgBool(row.varsayilan),
      // `attgenerated`: boş dize değilse üretilmiş (`s` stored, PG18'de `v` virtual).
      uretilmis: (row.uretilmis ?? '') !== '',
    });
    if (row.pk_sira != null) r.pkSira.push({ ad: row.kolon, sira: Number(row.pk_sira) });
  }
  const list = [...relations.values()].map(({ pkSira, ...r }) => ({ ...r, pk: pkSira.sort((a, b) => a.sira - b.sira).map((p) => p.ad) }));
  list.sort((a, b) => compare(a.sema, b.sema) || compare(a.ad, b.ad));
  const typeNames: Record<string, string> = {};
  const userTypes: string[] = [];
  for (const row of tipler) {
    if (row.oid == null || row.ad == null) continue;
    typeNames[row.oid] = row.ad;
    if (pgBool(row.kullanici)) userTypes.push(row.ad);
  }
  return { defaultSchema, semalar: [...semalar], iliskiler: list, tipler: typeNames, kullaniciTipleri: userTypes.sort(compare) };
}
