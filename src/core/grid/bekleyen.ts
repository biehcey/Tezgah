/**
 * Bekleyen değişiklik deposu (harita Q20, Q21): Tablo sekmesinde yapılmış ama uygulanmamış
 * düzenlemeler, eklenen ve silinecek satırlar, onlardan üretilen script. Saf ve değişmez: her olay
 * yeni bir depo döndürür. Yüklü satırlar PK değerleriyle tanınır; sayfa yeniden çekilse ya da filtre
 * değişse de değişiklik kendi satırında kalır. Eklenen satırların kimliği depodadır ve grid'de yüklü
 * satırların ardından gelir. Değerler "INSERT olarak kopyala" ile aynı literal üreticiyle yazılır:
 * önizlenen, Çalıştırma kaydına geçen ve çalıştırılan SQL aynıdır.
 */
import type { Cell } from './secim';
import { qualifiedName, quoteIdent, sqlLiteral } from './sql';
import { parseTsv } from './tsv';

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
  /** Üretilmiş (generated) kolon adları; salt okunur. */
  uretilmis: readonly string[];
}

/** Düzenlenmiş yüklü satır: düzenlendiği andaki değerleri ve değişen kolonların yeni değerleri. */
export interface PendingRow {
  /** Satırın kimliği: orijinal PK değerleri (bkz. `rowKey`). */
  anahtar: string;
  orijinal: Row;
  /** Kolon indeksi → yeni değer; yalnızca orijinalden farklı olanlar. */
  degerler: ReadonlyMap<number, Value>;
}

/** Silinecek yüklü satır. */
export interface DeletedRow {
  anahtar: string;
  orijinal: Row;
}

/** Eklenen satır: yalnızca dokunulan kolonlar; gerisi INSERT'e girmez (DEFAULT). */
export interface NewRow {
  /** `yeni:<n>`; PK anahtarlarıyla çakışmaz. */
  anahtar: string;
  degerler: ReadonlyMap<number, Value>;
}

export interface PendingChanges {
  /** Düzenlenen yüklü satırlar, ilk düzenlenme sırasıyla. */
  guncellenen: readonly PendingRow[];
  /** Silinecek satırlar, silinme sırasıyla. */
  silinen: readonly DeletedRow[];
  /** Eklenen satırlar, eklenme sırasıyla. */
  eklenen: readonly NewRow[];
  /** Sonraki eklenen satırın numarası. */
  sonrakiYeni: number;
}

export const NO_CHANGES: PendingChanges = { guncellenen: [], silinen: [], eklenen: [], sonrakiYeni: 1 };

/** Grid satırının depodaki karşılığı: yüklü satır (sunucudan gelen değerleriyle) ya da eklenen satır. */
export type RowRef = { yuklu: Row } | { yeni: string };

/** Grid'de çizilen satır. */
export interface GridRow {
  ref: RowRef;
  /** Değişikliğin kimliği (`PendingRow`/`DeletedRow`/`NewRow.anahtar`). */
  anahtar: string;
  /** Görünen değerler: bekleyenler orijinalin üstünde; eklenen satırın dokunulmayan kolonu `null`. */
  degerler: Row;
  durum: 'eklendi' | 'silinecek' | null;
  /** Değişen kolonlar (eklenen satırda dokunulanlar; gerisi DEFAULT), artan sırayla. */
  degisen: readonly number[];
}

/** Üretilen script ve her ifadenin ait olduğu değişiklik (`anahtar`). */
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

/** Kolon yazılamıyorsa nedeni: `bytea` (düzenleme kapsam dışı) ve üretilmiş kolonlar. */
export function readOnlyReason(table: EditableTable, kolon: number): string | null {
  const ad = table.kolonlar[kolon]!;
  if (table.uretilmis.includes(ad)) return `“${ad}” üretilmiş (generated) kolon: salt okunur`;
  if (table.tipler[kolon] === 'bytea') return `“${ad}” bytea kolonu: salt okunur`;
  return null;
}

/** Hata gelen `i`. ifadenin ait olduğu değişiklik (`GridRow.anahtar`); bilinmiyorsa `null`. */
export function failedRowKey(script: PendingScript, i: number): string | null {
  return script.ifadeler[i]?.satir ?? null;
}

/** Yüklü satırın PK değerlerinden kimliği. */
export function rowKey(table: EditableTable, row: Row): string {
  return JSON.stringify(table.pk.map((k) => row[table.kolonlar.indexOf(k)] ?? null));
}

/** Bekleyen değişiklik sayısı: düzenlenen, silinecek ve eklenen satırlar. */
export function pendingCount(changes: PendingChanges): number {
  return changes.guncellenen.length + changes.silinen.length + changes.eklenen.length;
}

const sortedKeys = (m: ReadonlyMap<number, Value>) => [...m.keys()].sort((a, b) => a - b);
const NONE: readonly number[] = [];

/** Grid'in satırları: yüklüler (bekleyen değerleri ve işaretleriyle), ardından eklenenler. */
export function gridRows(table: EditableTable, changes: PendingChanges, loaded: readonly Row[]): GridRow[] {
  const updated = new Map(changes.guncellenen.map((r) => [r.anahtar, r]));
  const deleted = new Set(changes.silinen.map((r) => r.anahtar));
  const rows = loaded.map((row): GridRow => {
    const ref = { yuklu: row };
    const anahtar = rowKey(table, row);
    if (deleted.has(anahtar)) return { ref, anahtar, degerler: row, durum: 'silinecek', degisen: NONE };
    const pending = updated.get(anahtar);
    if (!pending) return { ref, anahtar, degerler: row, durum: null, degisen: NONE };
    const degerler = row.map((v, c) => (pending.degerler.has(c) ? pending.degerler.get(c)! : v));
    return { ref, anahtar, degerler, durum: null, degisen: sortedKeys(pending.degerler) };
  });
  for (const r of changes.eklenen) {
    const degerler = table.kolonlar.map((_, c) => r.degerler.get(c) ?? null);
    rows.push({ ref: { yeni: r.anahtar }, anahtar: r.anahtar, degerler, durum: 'eklendi', degisen: sortedKeys(r.degerler) });
  }
  return rows;
}

/** Eklenen satırın dokunulmayan hücresi: INSERT'e girmez, `DEFAULT` gösterilir. */
export function isDefaultCell(row: Pick<GridRow, 'durum' | 'degisen'> | undefined, kolon: number): boolean {
  return row?.durum === 'eklendi' && !row.degisen.includes(kolon);
}

/**
 * Bekleyen değişiklikler listesi, SQL sırasıyla (DELETE → UPDATE → INSERT): silinen satır
 * `− pk = değer · silinecek`, düzenlenen `pk = değer · değişen kolonlar`, eklenen
 * `+ yeni satır · dokunulan kolonlar` (hiçbiri yoksa `DEFAULT VALUES`).
 */
export function pendingItems(table: EditableTable, changes: PendingChanges): { anahtar: string; metin: string }[] {
  const key = (orijinal: Row) => table.pk.map((k) => `${k} = ${orijinal[table.kolonlar.indexOf(k)] ?? 'NULL'}`).join(', ');
  const cols = (degerler: ReadonlyMap<number, Value>) => sortedKeys(degerler).map((c) => table.kolonlar[c]).join(', ');
  return [
    ...changes.silinen.map((r) => ({ anahtar: r.anahtar, metin: `− ${key(r.orijinal)} · silinecek` })),
    ...changes.guncellenen.map((r) => ({ anahtar: r.anahtar, metin: `${key(r.orijinal)} · ${cols(r.degerler)}` })),
    ...changes.eklenen.map((r) => ({ anahtar: r.anahtar, metin: `+ yeni satır · ${r.degerler.size === 0 ? 'DEFAULT VALUES' : cols(r.degerler)}` })),
  ];
}

/** Yeni, boş satır (tüm kolonlar DEFAULT); grid'in sonunda görünür. */
export function addRow(changes: PendingChanges): PendingChanges {
  return { ...changes, eklenen: [...changes.eklenen, { anahtar: `yeni:${changes.sonrakiYeni}`, degerler: new Map() }], sonrakiYeni: changes.sonrakiYeni + 1 };
}

/**
 * Hücreye yeni değer. Yüklü satırda aynı hücrenin önceki düzenlemesinin yerine geçer; orijinale
 * dönen hücre, kolonu kalmayan satır da depodan düşer. Eklenen satırda kolon dokunulmuş olur.
 * Salt okunur kolon ve silinecek satır yok sayılır.
 */
export function editCell(table: EditableTable, changes: PendingChanges, ref: RowRef, kolon: number, deger: Value): PendingChanges {
  if (readOnlyReason(table, kolon) !== null) return changes;
  if ('yeni' in ref) {
    return {
      ...changes,
      eklenen: changes.eklenen.map((r) => (r.anahtar === ref.yeni ? { ...r, degerler: new Map(r.degerler).set(kolon, deger) } : r)),
    };
  }
  const anahtar = rowKey(table, ref.yuklu);
  if (changes.silinen.some((r) => r.anahtar === anahtar)) return changes;
  const existing = changes.guncellenen.find((r) => r.anahtar === anahtar);
  const orijinal = existing?.orijinal ?? ref.yuklu;
  const degerler = new Map(existing?.degerler);
  if (orijinal[kolon] === deger) degerler.delete(kolon);
  else degerler.set(kolon, deger);
  const next: PendingRow = { anahtar, orijinal, degerler };
  let guncellenen: readonly PendingRow[];
  if (!existing) guncellenen = degerler.size === 0 ? changes.guncellenen : [...changes.guncellenen, next];
  else guncellenen = degerler.size === 0 ? changes.guncellenen.filter((r) => r !== existing) : changes.guncellenen.map((r) => (r === existing ? next : r));
  return guncellenen === changes.guncellenen ? changes : { ...changes, guncellenen };
}

/** Satırları siler: eklenen satır depodan düşer (SQL üretmez), yüklü satırın düzenlemeleri düşer. */
export function deleteRows(table: EditableTable, changes: PendingChanges, refs: readonly RowRef[]): PendingChanges {
  let { guncellenen, silinen, eklenen } = changes;
  for (const ref of refs) {
    if ('yeni' in ref) {
      eklenen = eklenen.filter((r) => r.anahtar !== ref.yeni);
      continue;
    }
    const anahtar = rowKey(table, ref.yuklu);
    if (silinen.some((r) => r.anahtar === anahtar)) continue;
    const existing = guncellenen.find((r) => r.anahtar === anahtar);
    guncellenen = guncellenen.filter((r) => r !== existing);
    silinen = [...silinen, { anahtar, orijinal: existing?.orijinal ?? ref.yuklu }];
  }
  return { ...changes, guncellenen, silinen, eklenen };
}

/** Silmeyi geri alır; silinmeden önceki düzenlemeler geri gelmez. */
export function restoreRows(table: EditableTable, changes: PendingChanges, refs: readonly RowRef[]): PendingChanges {
  const keys = new Set(refs.flatMap((ref) => ('yuklu' in ref ? [rowKey(table, ref.yuklu)] : [])));
  return { ...changes, silinen: changes.silinen.filter((r) => !keys.has(r.anahtar)) };
}

/**
 * Panodaki TSV'yi `start` hücresinden başlayarak yazar (kalan seçim yok sayılır, doldurma yok).
 * Grid'in sonunu aşan satırlar yeni satır olur; yeni satırda yalnızca yapıştırılan kolonlar
 * dokunulmuştur. Kolon taşması, salt okunur kolon ya da silinecek satır tüm yapıştırmayı reddeder.
 */
export function pasteTsv(table: EditableTable, changes: PendingChanges, rows: readonly Pick<GridRow, 'ref' | 'durum'>[], start: Cell, metin: string): PendingChanges | { hata: string } {
  const matrix = parseTsv(metin);
  if (matrix.length === 0) return changes;
  const reject = (neden: string) => ({ hata: `Yapıştırma reddedildi: ${neden}.` });
  const width = Math.max(...matrix.map((r) => r.length));
  const room = table.kolonlar.length - start.kolon;
  if (width > room) return reject(`${width} kolon yapıştırılıyor, seçimden itibaren ${room} kolon var`);
  for (let c = start.kolon; c < start.kolon + width; c++) {
    const reason = readOnlyReason(table, c);
    if (reason) return reject(reason);
  }
  if (matrix.some((_, i) => rows[start.satir + i]?.durum === 'silinecek')) return reject('silinecek satıra yapıştırılamaz; önce silmeyi geri alın');
  let next = changes;
  matrix.forEach((values, i) => {
    let ref = rows[start.satir + i]?.ref;
    if (!ref) {
      next = addRow(next);
      ref = { yeni: next.eklenen.at(-1)!.anahtar };
    }
    for (const [j, v] of values.entries()) next = editCell(table, next, ref, start.kolon + j, v);
  });
  return next;
}

/**
 * Script, DELETE → UPDATE → INSERT sırasıyla; değişiklik başına bir ifade.
 * `DELETE … WHERE <tüm PK>`, `UPDATE … SET <değişen kolonlar> WHERE <tüm PK = orijinal>`,
 * `INSERT` yalnızca dokunulan kolonlarla (hiçbiri dokunulmadıysa `DEFAULT VALUES`).
 */
export function pendingScript(table: EditableTable, changes: PendingChanges): PendingScript {
  const name = qualifiedName({ sema: table.sema, ad: table.tablo });
  const literal = (c: number, v: Value) => sqlLiteral(v, table.tipler[c]);
  const assign = (c: number, v: Value) => `${quoteIdent(table.kolonlar[c]!)} = ${literal(c, v)}`;
  const where = (orijinal: Row) =>
    table.pk
      .map((k) => {
        const c = table.kolonlar.indexOf(k);
        return assign(c, orijinal[c] ?? null);
      })
      .join(' AND ');
  const deletes = changes.silinen.map((r) => ({ sql: `DELETE FROM ${name} WHERE ${where(r.orijinal)};`, satir: r.anahtar }));
  const updates = changes.guncellenen.map((r) => {
    const set = sortedKeys(r.degerler).map((c) => assign(c, r.degerler.get(c)!));
    return { sql: `UPDATE ${name} SET ${set.join(', ')} WHERE ${where(r.orijinal)};`, satir: r.anahtar };
  });
  const inserts = changes.eklenen.map((r) => {
    const cols = sortedKeys(r.degerler);
    const sql =
      cols.length === 0
        ? `INSERT INTO ${name} DEFAULT VALUES;`
        : `INSERT INTO ${name} (${cols.map((c) => quoteIdent(table.kolonlar[c]!)).join(', ')}) VALUES (${cols.map((c) => literal(c, r.degerler.get(c)!)).join(', ')});`;
    return { sql, satir: r.anahtar };
  });
  const ifadeler = [...deletes, ...updates, ...inserts];
  return { metin: ifadeler.map((s) => s.sql).join('\n'), ifadeler };
}
