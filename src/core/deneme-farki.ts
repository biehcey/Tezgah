/**
 * Deneme farkı (wayfinder 16): ifade başına dönen önce/sonra satırları ve DDL'in şema anlık
 * görüntüleri tablo bazında birleşir. Satırlar PK anahtarıyla eşlenir; aynı satıra birden çok ifade
 * dokunursa ilk "önce" ve son "sonra" alınır.
 */
import { PREVIEW_ROWS } from './script-calistirma';

/** Tablonun kimliği (`pg_class.oid`) ve görünen adı (`şema.ad`). */
export interface TableRef {
  oid: string;
  ad: string;
}

/** Kolon sırasıyla metin değerler (NULL `null`). */
export type Row = (string | null)[];

export interface Counts {
  eklendi: number;
  guncellendi: number;
  silindi: number;
}

/** Bir DML ifadesinin PK'lı tablodaki önce/sonra satırları (PG18+ `RETURNING old.*, new.*`). */
export interface RowChanges {
  tablo: TableRef;
  kolonlar: string[];
  /** PK kolonları; `kolonlar`'ın içindedir. */
  anahtar: string[];
  /** INSERT'te `once`, DELETE'te `sonra` yok. */
  satirlar: { once: Row | null; sonra: Row | null }[];
  /** Sunucudan çekilmeyen (ilk 100'den sonraki) satırların türlere göre sayısı. */
  gorulmeyen: Counts;
}

export interface ColumnSchema {
  /** `pg_attribute.attnum`; yeniden adlandırma ve tür değişikliğinde aynı kalır. */
  no: number;
  ad: string;
  tip: string;
  bos: boolean;
  varsayilan: string | null;
}

export interface TableSchema {
  ad: string;
  kolonlar: ColumnSchema[];
}

/** DDL ifadesinden önceki ve sonraki şema; tablo yoksa `null`. */
export interface SchemaChange {
  oid: string;
  once: TableSchema | null;
  sonra: TableSchema | null;
}

export interface SchemaLine {
  tur: '+' | '−' | '~';
  metin: string;
}

export interface DiffRow {
  tur: 'eklendi' | 'guncellendi' | 'silindi';
  once: Row | null;
  sonra: Row | null;
  /** Güncellemede değeri değişen kolonlar. */
  degisen: string[];
}

export interface TableDiff extends Counts {
  tablo: TableRef;
  kolonlar: string[];
  /** İlk 100 satır; değerler `kolonlar` sırasıyla. */
  satirlar: DiffRow[];
  /** Gösterilmeyen satır sayısı. */
  daha: number;
  /**
   * Sayılar yaklaşık: sunucudan çekilmeyen satırlar birleştirilemez; tabloya birden çok ifade
   * dokunduysa aynı satır birden çok kez sayılmış olabilir.
   */
  yaklasik: boolean;
  sema: SchemaLine[];
}

/** Bir ifadenin farka kattıkları; ikisi de yoksa ifade farkı etkilemez. */
export interface StatementChanges {
  fark?: RowChanges;
  sema?: SchemaChange[];
}

type Values = Map<string, string | null>;

interface Entry {
  once: Values | null;
  sonra: Values | null;
}

interface Table {
  tablo: TableRef;
  kolonlar: string[];
  entries: Entry[];
  byKey: Map<string, Entry>;
  gorulmeyen: Counts;
  /** Tabloya dokunan DML ifadesi sayısı. */
  ifadeler: number;
  ilkSema?: TableSchema | null;
  sonSema?: TableSchema | null;
}

export function mergeChanges(statements: readonly StatementChanges[]): TableDiff[] {
  const tables = new Map<string, Table>();
  const table = (tablo: TableRef): Table => {
    let t = tables.get(tablo.oid);
    if (!t) {
      t = { tablo, kolonlar: [], entries: [], byKey: new Map(), gorulmeyen: { eklendi: 0, guncellendi: 0, silindi: 0 }, ifadeler: 0 };
      tables.set(tablo.oid, t);
    }
    // Son görülen ad: tablo deneme içinde yeniden adlandırılmış olabilir.
    t.tablo = tablo;
    return t;
  };

  for (const { fark, sema } of statements) {
    if (fark) addRows(table(fark.tablo), fark);
    for (const change of sema ?? []) {
      const ad = change.sonra?.ad ?? change.once?.ad;
      if (ad === undefined) continue;
      const t = table({ oid: change.oid, ad });
      if (t.ilkSema === undefined) t.ilkSema = change.once;
      t.sonSema = change.sonra;
    }
  }

  return [...tables.values()].map(toDiff).filter((d) => d.satirlar.length > 0 || d.daha > 0 || d.sema.length > 0);
}

function addRows(t: Table, { kolonlar, anahtar, satirlar, gorulmeyen }: RowChanges) {
  for (const k of kolonlar) if (!t.kolonlar.includes(k)) t.kolonlar.push(k);
  t.gorulmeyen = addCounts(t.gorulmeyen, gorulmeyen);
  t.ifadeler++;
  const values = (row: Row | null): Values | null => row && new Map(kolonlar.map((k, i) => [k, row[i] ?? null]));
  const key = (v: Values) => JSON.stringify(anahtar.map((k) => v.get(k) ?? null));

  for (const row of satirlar) {
    const once = values(row.once);
    const sonra = values(row.sonra);
    const current = once ?? sonra;
    if (!current) continue;
    const existing = t.byKey.get(key(current));
    // Zincir tutarlı olmalı: güncellenen/silinen satır yaşıyor, eklenen satır daha önce silinmiş.
    const continues = existing !== undefined && (once ? existing.sonra !== null : existing.sonra === null);
    const entry = continues ? existing : { once, sonra };
    if (continues) {
      t.byKey.delete(key(current));
      entry.sonra = sonra;
    } else t.entries.push(entry);
    // Eklenip silinen satırın izlenecek anahtarı kalmaz.
    const last = entry.sonra ?? entry.once;
    if (last) t.byKey.set(key(last), entry);
  }
}

function toDiff(t: Table): TableDiff {
  const row = (v: Values | null): Row | null => v && t.kolonlar.map((k) => v.get(k) ?? null);
  const rows: DiffRow[] = [];
  for (const { once, sonra } of t.entries) {
    if (!once && !sonra) continue;
    if (!once) rows.push({ tur: 'eklendi', once: null, sonra: row(sonra), degisen: [] });
    else if (!sonra) rows.push({ tur: 'silindi', once: row(once), sonra: null, degisen: [] });
    else {
      // Yalnızca iki hâlde de bulunan kolonlar karşılaştırılır (DDL ile eklenen kolon değişmiş sayılmaz).
      const degisen = t.kolonlar.filter((k) => once.has(k) && sonra.has(k) && once.get(k) !== sonra.get(k));
      rows.push({ tur: 'guncellendi', once: row(once), sonra: row(sonra), degisen });
    }
  }
  const count = (tur: DiffRow['tur']) => rows.filter((r) => r.tur === tur).length;
  const counts = addCounts({ eklendi: count('eklendi'), guncellendi: count('guncellendi'), silindi: count('silindi') }, t.gorulmeyen);
  const unseen = total(t.gorulmeyen);
  const shown = rows.slice(0, PREVIEW_ROWS);
  return {
    tablo: t.tablo,
    ...counts,
    kolonlar: t.kolonlar,
    satirlar: shown,
    daha: rows.length - shown.length + unseen,
    yaklasik: unseen > 0 && t.ifadeler > 1,
    sema: t.ilkSema === undefined ? [] : schemaDiff(t.ilkSema, t.sonSema ?? null),
  };
}

function addCounts(a: Counts, b: Counts): Counts {
  return { eklendi: a.eklendi + b.eklendi, guncellendi: a.guncellendi + b.guncellendi, silindi: a.silindi + b.silindi };
}

function total(c: Counts): number {
  return c.eklendi + c.guncellendi + c.silindi;
}

function describeColumn({ ad, tip, bos, varsayilan }: ColumnSchema): string {
  return `${ad} ${tip} ${bos ? 'NULL' : 'NOT NULL'}${varsayilan === null ? '' : ` DEFAULT ${varsayilan}`}`;
}

/** İki şema arasındaki fark, ör. `+ kolon son_giris timestamptz NULL`. Kolonlar `attnum` ile eşlenir. */
export function schemaDiff(once: TableSchema | null, sonra: TableSchema | null): SchemaLine[] {
  if (!once && !sonra) return [];
  if (!once) return [{ tur: '+', metin: `tablo ${sonra!.ad}` }, ...sonra!.kolonlar.map((k) => ({ tur: '+' as const, metin: `kolon ${describeColumn(k)}` }))];
  if (!sonra) return [{ tur: '−', metin: `tablo ${once.ad}` }];
  const lines: SchemaLine[] = [];
  if (once.ad !== sonra.ad) lines.push({ tur: '~', metin: `tablo ${once.ad} → ${sonra.ad}` });
  const after = new Map(sonra.kolonlar.map((k) => [k.no, k]));
  const before = new Set(once.kolonlar.map((k) => k.no));
  for (const k of once.kolonlar) {
    const next = after.get(k.no);
    if (!next) lines.push({ tur: '−', metin: `kolon ${describeColumn(k)}` });
    else if (describeColumn(k) !== describeColumn(next)) lines.push({ tur: '~', metin: `kolon ${describeColumn(k)} → ${describeColumn(next)}` });
  }
  for (const k of sonra.kolonlar) if (!before.has(k.no)) lines.push({ tur: '+', metin: `kolon ${describeColumn(k)}` });
  return lines;
}
