/**
 * Bekleyen değişiklik deposu (harita Q20): Tablo sekmesinde yapılmış ama uygulanmamış düzenlemeler
 * ve onlardan üretilen script. Saf ve değişmez: her olay yeni bir depo döndürür. Satırlar PK
 * değerleriyle tanınır; sayfa yeniden çekilse ya da filtre değişse de düzenleme kendi satırında kalır.
 * Değerler "INSERT olarak kopyala" ile aynı literal üreticiyle yazılır: önizlenen, Çalıştırma kaydına
 * geçen ve çalıştırılan SQL aynıdır.
 */
import { qualifiedName, quoteIdent, sqlLiteral } from './sql';

type Value = string | null;
type Row = readonly Value[];

/** Düzenlenen tablo: kolonlar sonuçtaki sırayla, tipleri literal ekiyle (`null`: tipsiz), PK kolonları. */
export interface EditableTable {
  sema: string;
  tablo: string;
  kolonlar: readonly string[];
  tipler: readonly (string | null)[];
  /** PK kolon adları, indeks sırasıyla; boşsa tablo düzenlenemez. */
  pk: readonly string[];
}

/** Düzenlenmiş bir satır: düzenlendiği andaki değerleri ve değişen kolonların yeni değerleri. */
export interface PendingRow {
  /** Satırın kimliği: orijinal PK değerleri (bkz. `rowKey`). */
  anahtar: string;
  orijinal: Row;
  /** Kolon indeksi → yeni değer; yalnızca orijinalden farklı olanlar. */
  degerler: ReadonlyMap<number, Value>;
}

export interface PendingChanges {
  /** İlk düzenlenme sırasıyla. */
  satirlar: readonly PendingRow[];
}

export const NO_CHANGES: PendingChanges = { satirlar: [] };

/** Üretilen script ve her ifadenin ait olduğu satır (`PendingRow.anahtar`). */
export interface PendingScript {
  metin: string;
  ifadeler: { sql: string; satir: string }[];
}

/**
 * Sonuç düzenlenebilir mi: PK'lı tabloda ve PK kolonlarının hepsi sonuçta varsa tablo, aksi hâlde
 * kullanıcıya gösterilecek neden. Satırlar PK'yla tanınır; PK'sız güncelleme yanlış satıra gidebilir.
 */
export function editableTable(table: EditableTable): EditableTable | { kapali: string } {
  if (table.pk.length === 0) return { kapali: 'Düzenleme kapalı: tablonun birincil anahtarı (PK) yok' };
  const missing = table.pk.filter((k) => !table.kolonlar.includes(k));
  if (missing.length > 0) return { kapali: `Düzenleme kapalı: birincil anahtar kolonu (${missing.join(', ')}) sonuçta yok` };
  return table;
}

/** Hata gelen `i`. ifadenin ait olduğu satır (`PendingRow.anahtar`); bilinmiyorsa `null`. */
export function failedRowKey(script: PendingScript, i: number): string | null {
  return script.ifadeler[i]?.satir ?? null;
}

/** Satırın PK değerlerinden kimliği. */
export function rowKey(table: EditableTable, row: Row): string {
  return JSON.stringify(table.pk.map((k) => row[table.kolonlar.indexOf(k)] ?? null));
}

const findRow = (table: EditableTable, changes: PendingChanges, row: Row) => {
  const anahtar = rowKey(table, row);
  return changes.satirlar.find((r) => r.anahtar === anahtar);
};

/**
 * Hücreye yeni değer: aynı hücrenin önceki düzenlemesinin yerine geçer; orijinale dönen hücre,
 * kolonu kalmayan satır da depodan düşer. `row` yüklü (düzenlenmemiş) satırdır.
 */
export function editCell(table: EditableTable, changes: PendingChanges, row: Row, kolon: number, deger: Value): PendingChanges {
  const existing = findRow(table, changes, row);
  const orijinal = existing?.orijinal ?? row;
  const degerler = new Map(existing?.degerler);
  if (orijinal[kolon] === deger) degerler.delete(kolon);
  else degerler.set(kolon, deger);
  const anahtar = existing?.anahtar ?? rowKey(table, row);
  const next: PendingRow = { anahtar, orijinal, degerler };
  if (!existing) return degerler.size === 0 ? changes : { satirlar: [...changes.satirlar, next] };
  return {
    satirlar: degerler.size === 0 ? changes.satirlar.filter((r) => r !== existing) : changes.satirlar.map((r) => (r === existing ? next : r)),
  };
}

/** Satırın görünen hâli: bekleyen değerler orijinalin üstünde. Düzenlenmemiş satır olduğu gibi döner. */
export function shownRow(table: EditableTable, changes: PendingChanges, row: Row): Row {
  const pending = findRow(table, changes, row);
  if (!pending) return row;
  return row.map((v, c) => (pending.degerler.has(c) ? pending.degerler.get(c)! : v));
}

export function isCellChanged(table: EditableTable, changes: PendingChanges, row: Row, kolon: number): boolean {
  return findRow(table, changes, row)?.degerler.has(kolon) ?? false;
}

/** `UPDATE "s"."t" SET <değişen kolonlar> WHERE <tüm PK = orijinal>;` satır başına bir ifade. */
export function pendingScript(table: EditableTable, changes: PendingChanges): PendingScript {
  const name = qualifiedName({ sema: table.sema, ad: table.tablo });
  const assign = (c: number, v: Value) => `${quoteIdent(table.kolonlar[c]!)} = ${sqlLiteral(v, table.tipler[c])}`;
  const ifadeler = changes.satirlar.map((r) => {
    const set = [...r.degerler].sort(([a], [b]) => a - b).map(([c, v]) => assign(c, v));
    const where = table.pk.map((k) => {
      const c = table.kolonlar.indexOf(k);
      return assign(c, r.orijinal[c] ?? null);
    });
    return { sql: `UPDATE ${name} SET ${set.join(', ')} WHERE ${where.join(' AND ')};`, satir: r.anahtar };
  });
  return { metin: ifadeler.map((s) => s.sql).join('\n'), ifadeler };
}
