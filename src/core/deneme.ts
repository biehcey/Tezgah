/**
 * Deneme modu (wayfinder 16): script Transaction modunda çalışır ve sonunda her zaman geri alınır.
 * Bu modül sunucunun denemede ürettiği SQL'i ve okuduğu sonuçları tutar:
 * - DML yeniden yazımı: PG18+ ve PK'lı tabloda `RETURNING old.*, new.*` (önce/sonra), yoksa
 *   `RETURNING *` (UPDATE'te yeni hâl, INSERT'te eklenen, DELETE'te silinen satır) ve nedeni.
 * - Hedef tablo: DML'in ve tablo DDL'inin dokunduğu tablo adları; katalogdan PK ve şema okuması.
 */
import { isProd, type EnvTag } from './baglanti';
import { PREVIEW_ROWS } from './script-calistirma';
import type { ColumnSchema, Counts, RowChanges, TableRef, TableSchema } from './deneme-farki';
import { qualifiedName, quoteIdent, sqlLiteral, type TableName } from './grid/sql';
import { WORD_CHAR, WORD_START, skipBlockComment, type Statement } from './ifade-bolme';

// ---------- prod'da satır kilidi beklemesi (wayfinder 20) ----------

/**
 * prod'da denemenin satır kilidi beklemesi transaction başında 3 sn ile sınırlanır: deneme prod
 * trafiğinin tuttuğu satırları uzun süre beklemesin. prod dışında `null`. `statement_timeout`
 * yoktur; uzun sorguyu kullanıcı iptal eder.
 */
export function denemeLockTimeout(envTag: EnvTag | null | undefined): string | null {
  return isProd(envTag) ? "SET LOCAL lock_timeout = '3s'" : null;
}

/** `lock_not_available`: satır kilidi `lock_timeout` içinde alınamadı. */
export const LOCK_NOT_AVAILABLE = '55P03';

/** prod denemesinin `55P03` hatasında Postgres'in iletisi ("lock timeout") yerine gösterilir. */
export const LOCK_NOT_AVAILABLE_MESSAGE = 'Kilit alınamadı, prod trafiği bu satırları tutuyor.';

/** Değişiklik önizlemesi verilen komutlar ve başlıktaki fiilleri. */
export const DML_VERBS: Readonly<Record<string, string>> = { INSERT: 'eklendi', UPDATE: 'güncellendi', DELETE: 'silindi' };

export interface DenemeStatement {
  /** Sunucuya gönderilecek metin; ekler yalnızca sona gelir, hata konumları değişmez. */
  text: string;
  /** İfade satır değiştirir (DML); dönen satırları değişiklik önizlemesidir. */
  degistirir: boolean;
  /** Kullanıcı kendi `RETURNING`'ini yazmış; metne dokunulmadı. */
  kendiReturning: boolean;
  /** Önce/sonra yazımında işlem türünü taşıyan kolonun adı (`oldNewSelect`'e verilir). */
  turKolonu?: string;
}

/** Tür kolonu değerleri: `I` eklendi, `U` güncellendi, `D` silindi. */
const INSERTED = 'I';
const DELETED = 'D';
/**
 * `old`/`new` yerine kullanılan takma adlar (PG18 `RETURNING WITH (OLD AS …, NEW AS …)`): tablonun
 * `old` ya da `new` takma adıyla çakışmasın.
 */
const OLD_ALIAS = 'tezgah_once';
const NEW_ALIAS = 'tezgah_sonra';

/** Tablonun kolonlarıyla çakışmayan tür kolonu adı: CTE'de adıyla anıldığı için tek olmalı. */
function kindColumn(kolonlar: readonly string[]): string {
  let name = 'tezgah_tur';
  for (let n = 1; kolonlar.includes(name); n++) name = `tezgah_tur_${n}`;
  return name;
}

/**
 * INSERT/UPDATE/DELETE'in sonuna `RETURNING` ekler. `tablo` (PG18+ sunucuda tablonun PK'sı ve
 * kolonları) PK'lıysa `RETURNING old.*, new.*` ile önce/sonra hâli, yoksa `RETURNING *` ile son
 * hâl döner. Kullanıcı zaten `RETURNING` yazdıysa ifadeye dokunulmaz; önizleme onun döndürdüğüdür.
 * `WITH … DELETE` gibi CTE'li DML yeniden yazılmaz: ana ifadeyi bulmak SQL ayrıştırması ister.
 */
export function withReturning(
  statement: Statement,
  tablo: { anahtar: readonly string[]; kolonlar: readonly string[] } = { anahtar: [], kolonlar: [] },
): DenemeStatement {
  if (!Object.hasOwn(DML_VERBS, statement.keywords[0] ?? '')) return { text: statement.text, degistirir: false, kendiReturning: false };
  // `words` dizge, yorum ve tırnaklı adları içermez; çıplak `returning` ayrılmış kelimedir.
  if (statement.words.includes('RETURNING')) return { text: statement.text, degistirir: true, kendiReturning: true };
  const [key] = tablo.anahtar;
  if (key === undefined) return { text: `${statement.text} RETURNING *`, degistirir: true, kendiReturning: false };
  // PK NOT NULL'dır: eski değeri NULL olan satır eklenmiş, yeni değeri NULL olan silinmiştir.
  const k = quoteIdent(key);
  const turKolonu = kindColumn(tablo.kolonlar);
  const kind = `CASE WHEN ${OLD_ALIAS}.${k} IS NULL THEN '${INSERTED}' WHEN ${NEW_ALIAS}.${k} IS NULL THEN '${DELETED}' ELSE 'U' END AS ${turKolonu}`;
  const returning = `RETURNING WITH (OLD AS ${OLD_ALIAS}, NEW AS ${NEW_ALIAS}) ${kind}, ${OLD_ALIAS}.*, ${NEW_ALIAS}.*`;
  return { text: `${statement.text} ${returning}`, degistirir: true, kendiReturning: false, turKolonu };
}

/**
 * `cte` adlı veri değiştiren CTE'yi (`… RETURNING <turKolonu>, old.*, new.*`) kapatan sorgu: ilk üç
 * kolon toplam, eklenen ve silinen satır sayısıdır (pencere `LIMIT`'ten önce sayar), ardından CTE'nin
 * kolonları. İstemciye en fazla 100 satır gider.
 */
export function oldNewSelect(cte: string, turKolonu: string): string {
  return (
    `) SELECT count(*) OVER (), count(*) FILTER (WHERE ${turKolonu} = '${INSERTED}') OVER (), ` +
    `count(*) FILTER (WHERE ${turKolonu} = '${DELETED}') OVER (), * FROM ${cte} LIMIT ${PREVIEW_ROWS}`
  );
}

/** `oldNewSelect` sonucu: kolon adları ve metin değerli satırlar (`rowMode: 'array'`). */
export function decodeOldNew(
  names: string[],
  rows: unknown[][],
): { rowCount: number } & Pick<RowChanges, 'kolonlar' | 'satirlar' | 'gorulmeyen'> {
  // toplam, eklenen, silinen, tür, old.* (n kolon), new.* (n kolon)
  const width = (names.length - 4) / 2;
  const cell = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const shown: Counts = { eklendi: 0, guncellendi: 0, silindi: 0 };
  const satirlar = rows.map((row) => {
    const once = row.slice(4, 4 + width).map(cell);
    const sonra = row.slice(4 + width).map(cell);
    if (row[3] === INSERTED) {
      shown.eklendi++;
      return { once: null, sonra };
    }
    if (row[3] === DELETED) {
      shown.silindi++;
      return { once, sonra: null };
    }
    shown.guncellendi++;
    return { once, sonra };
  });
  const [total, inserted, deleted] = rows[0] ? [0, 1, 2].map((i) => Number(rows[0]![i])) : [0, 0, 0];
  return {
    rowCount: total!,
    kolonlar: names.slice(4, 4 + width),
    satirlar,
    gorulmeyen: {
      eklendi: inserted! - shown.eklendi,
      guncellendi: total! - inserted! - deleted! - shown.guncellendi,
      silindi: deleted! - shown.silindi,
    },
  };
}

type Token = { tur: 'kelime'; deger: string; anahtar: string } | { tur: 'ad'; deger: string } | { tur: 'simge'; deger: string };

/**
 * İfadenin başındaki adları ve anahtar kelimeleri okur; ilk tanınmayan simgede (ör. `(`) durur.
 * Yalnızca tablo adını bulmaya yeter: yorumlar atlanır, `"…"` adları açılır.
 */
function headTokens(text: string, limit = 24): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length && tokens.length < limit) {
    const c = text[i]!;
    if (/\s/.test(c)) i++;
    else if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = skipBlockComment(text, i);
      if (close === -1) break;
      i = close;
    } else if (c === '"') {
      let to = i + 1;
      let value = '';
      for (;;) {
        if (to >= text.length) return tokens;
        if (text[to] === '"') {
          if (text[to + 1] !== '"') break;
          value += '"';
          to += 2;
        } else value += text[to++];
      }
      tokens.push({ tur: 'ad', deger: value });
      i = to + 1;
    } else if (WORD_START.test(c)) {
      let to = i + 1;
      while (to < text.length && WORD_CHAR.test(text[to]!)) to++;
      const word = text.slice(i, to);
      tokens.push({ tur: 'kelime', deger: word.toLowerCase(), anahtar: word.toUpperCase() });
      i = to;
    } else if (c === '.' || c === ',') {
      tokens.push({ tur: 'simge', deger: c });
      i++;
    } else break;
  }
  return tokens;
}

/** `tokens[at]`'ten başlayan, şemayla nitelenebilen bir adı okur. */
function readName(tokens: Token[], at: number): { name: TableName; next: number } | null {
  const part = (t: Token | undefined) => (t && t.tur !== 'simge' ? t.deger : null);
  const first = part(tokens[at]);
  if (first === null) return null;
  if (tokens[at + 1]?.deger === '.' && tokens[at + 1]?.tur === 'simge') {
    const second = part(tokens[at + 2]);
    if (second === null) return null;
    return { name: { sema: first, ad: second }, next: at + 3 };
  }
  return { name: { ad: first }, next: at + 1 };
}

/** `tokens[at]`'ten itibaren anahtar kelime dizisini atlar; eşleşmezse `at` döner. */
function skip(tokens: Token[], at: number, ...words: string[]): number {
  for (const [k, word] of words.entries()) {
    const t = tokens[at + k];
    if (t?.tur !== 'kelime' || t.anahtar !== word) return at;
  }
  return at + words.length;
}

/** INSERT/UPDATE/DELETE'in hedef tablosu; CTE'li ya da tanınmayan biçimde `null`. */
export function dmlTarget(statement: Statement): TableName | null {
  const tokens = headTokens(statement.text);
  const verb = tokens[0]?.tur === 'kelime' ? tokens[0].anahtar : '';
  let at: number;
  if (verb === 'INSERT') {
    at = skip(tokens, 1, 'INTO');
    if (at === 1) return null;
  } else if (verb === 'UPDATE') at = skip(tokens, 1, 'ONLY');
  else if (verb === 'DELETE') {
    at = skip(tokens, 1, 'FROM');
    if (at === 1) return null;
    at = skip(tokens, at, 'ONLY');
  } else return null;
  return readName(tokens, at)?.name ?? null;
}

/**
 * Şemasını değiştirebilen tablo DDL'inin (`ALTER TABLE`, `CREATE … TABLE`, `DROP TABLE`) dokunduğu
 * tablolar; başka ifadede boş.
 */
export function ddlTargets(statement: Statement): TableName[] {
  const tokens = headTokens(statement.text);
  const verb = tokens[0]?.tur === 'kelime' ? tokens[0].anahtar : '';
  if (verb === 'ALTER') {
    let at = skip(tokens, 1, 'TABLE');
    if (at === 1) return [];
    at = skip(tokens, at, 'IF', 'EXISTS');
    at = skip(tokens, at, 'ONLY');
    const read = readName(tokens, at);
    return read ? [read.name] : [];
  }
  if (verb === 'CREATE') {
    let at = 1;
    for (const modifier of ['GLOBAL', 'LOCAL', 'TEMP', 'TEMPORARY', 'UNLOGGED']) at = skip(tokens, at, modifier);
    const table = skip(tokens, at, 'TABLE');
    if (table === at) return [];
    const read = readName(tokens, skip(tokens, table, 'IF', 'NOT', 'EXISTS'));
    return read ? [read.name] : [];
  }
  if (verb === 'DROP') {
    let at = skip(tokens, 1, 'TABLE');
    if (at === 1) return [];
    at = skip(tokens, at, 'IF', 'EXISTS');
    const names: TableName[] = [];
    for (;;) {
      const read = readName(tokens, at);
      if (!read) break;
      names.push(read.name);
      if (tokens[read.next]?.deger !== ',' || tokens[read.next]?.tur !== 'simge') break;
      at = read.next + 1;
    }
    return names;
  }
  return [];
}

/** `RETURNING old.*, new.*` desteği olan en eski sürüm (`server_version_num`). */
export const OLD_NEW_MIN_VERSION = 180000;

/** `SHOW server_version_num` sonucu; tanınmazsa 0 (önce/sonra farkı denenmez). */
export function parseServerVersion(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : 0;
}

/** Önce/sonra farkı yerine `RETURNING` önizlemesine düşülmesinin nedeni. */
export type FallbackReason = 'surum' | 'anahtar' | 'returning' | 'sarmal';

export const FALLBACK_NOTES: Readonly<Record<FallbackReason, string>> = {
  surum: 'Sunucu PostgreSQL 18’den eski; önce/sonra farkı yerine ifadenin döndürdüğü satırlar gösteriliyor.',
  anahtar: 'Tabloda birincil anahtar yok; satırlar eşlenemediği için önce/sonra farkı yerine ifadenin döndürdüğü satırlar gösteriliyor.',
  returning: 'İfadenin kendi RETURNING’i var; önce/sonra farkı yerine onun döndürdüğü satırlar gösteriliyor.',
  sarmal: 'Önce/sonra farkı bu ifadede alınamadı; ifadenin döndürdüğü satırlar gösteriliyor.',
};

/** Katalogdan okunan tablo: kimliği, PK kolonları (sırayla) ve kolonları. */
export interface TableInfo {
  tablo: TableRef;
  anahtar: string[];
  sema: TableSchema;
}

/**
 * Tablonun kimliğini, PK'sını ve kolonlarını tek JSON metni olarak döndüren katalog sorgusu.
 * Basit sorgu protokolüyle gider (parametresiz); ad `to_regclass` ile oturumun `search_path`'inde
 * çözülür. Tablo yoksa satır dönmez.
 */
export function tableInfoQuery(by: { ad: TableName } | { oid: string }): string {
  let where: string;
  if ('oid' in by) {
    if (!/^\d+$/.test(by.oid)) throw new Error(`Geçersiz oid: ${by.oid}`);
    where = `c.oid = ${by.oid}::oid`;
  } else where = `c.oid = to_regclass(${sqlLiteral(qualifiedName(by.ad))})`;
  return [
    'SELECT json_build_object(',
    "'oid', c.oid::text,",
    "'ad', format('%I.%I', n.nspname, c.relname),",
    "'anahtar', coalesce((SELECT json_agg(a.attname ORDER BY k.ord) FROM pg_index i",
    ' CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)',
    ' JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum',
    " WHERE i.indrelid = c.oid AND i.indisprimary), '[]'::json),",
    "'kolonlar', coalesce((SELECT json_agg(json_build_object('no', a.attnum, 'ad', a.attname,",
    " 'tip', format_type(a.atttypid, a.atttypmod), 'bos', NOT a.attnotnull, 'varsayilan', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)",
    ' FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum',
    " WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '[]'::json)",
    `)::text AS tezgah_tablo FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${where}`,
  ].join('');
}

/** `tableInfoQuery` sonucunun ilk hücresi; beklenen biçimde değilse `null`. */
export function parseTableInfo(value: unknown): TableInfo | null {
  if (typeof value !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  const o = raw as { oid?: unknown; ad?: unknown; anahtar?: unknown; kolonlar?: unknown } | null;
  if (typeof o?.oid !== 'string' || typeof o.ad !== 'string') return null;
  if (!Array.isArray(o.anahtar) || !o.anahtar.every((k) => typeof k === 'string')) return null;
  if (!Array.isArray(o.kolonlar)) return null;
  const kolonlar: ColumnSchema[] = [];
  for (const k of o.kolonlar as Record<string, unknown>[]) {
    if (typeof k?.no !== 'number' || typeof k.ad !== 'string' || typeof k.tip !== 'string' || typeof k.bos !== 'boolean') return null;
    kolonlar.push({ no: k.no, ad: k.ad, tip: k.tip, bos: k.bos, varsayilan: typeof k.varsayilan === 'string' ? k.varsayilan : null });
  }
  return { tablo: { oid: o.oid, ad: o.ad }, anahtar: o.anahtar as string[], sema: { ad: o.ad, kolonlar } };
}
