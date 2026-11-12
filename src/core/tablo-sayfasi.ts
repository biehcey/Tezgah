/**
 * Tablo sekmesinin sayfaları (harita Q14, Q16): her sayfa kısa, ayrı, tek ifadelik bir sorgudur.
 * PK'lı tabloda PK sırasıyla keyset (derin sayfalar da hızlı ve tutarlı), PK'sız tabloda
 * `LIMIT … OFFSET …` (sayfalar arası tutarlılık garanti değil). Sunucu bu modülün ürettiği ifadeyi
 * parametreli (extended protocol) çalıştırır.
 */
import { PAGE_ROWS, ROW_LIMIT } from './grid/sabitler';
import { qualifiedName, quoteIdent } from './grid/sql';
import { splitStatements } from './ifade-bolme';

/** Sayfası çekilen ilişki; kolonlar ve PK katalogdan. */
export interface TableMeta {
  sema: string;
  tablo: string;
  /** `attnum` sırasıyla. */
  kolonlar: readonly string[];
  /** PK kolonları, indeks sırasıyla; PK yoksa boş. */
  pk: readonly string[];
}

/** Sonraki sayfanın başı: keyset'te önceki sayfanın son PK değerleri (ham metin), aksi hâlde ofset. */
export type PageCursor = { tur: 'keyset'; degerler: string[] } | { tur: 'offset'; offset: number };

/** Tablo sekmesinin serbest filtre kutuları. */
export type FilterBox = 'where' | 'orderBy';

/** Kullanıcının `WHERE` ve `ORDER BY` kutuları (anahtar kelimesiz); boş metin kutu yok demektir. */
export interface TableFilter {
  where: string;
  orderBy: string;
}

export const NO_FILTER: TableFilter = { where: '', orderBy: '' };

export interface PageQuery {
  text: string;
  values: string[];
  /** `offset`: sayfalar arası tutarlılık garanti değil. */
  mod: 'keyset' | 'offset';
  /** Kullanıcı metinlerinin sorgudaki yeri; Postgres hata konumunu kutuya çevirmek için. */
  kutular: Partial<Record<FilterBox, EmbeddedBox>>;
}

/** Sorguya gömülen kutu metni. */
interface EmbeddedBox {
  /** `text`'teki 0 tabanlı başlangıç ve uzunluk. */
  bas: number;
  uzunluk: number;
  /** Gömülen metnin kutudaki başlangıcı (baştaki boşluk ve yorum atıldı). */
  kayma: number;
  /** Kutudan hemen sonraki ekin (`)`, ` LIMIT`) Postgres'in göstereceği karakteri; kutunun sonu sayılır. */
  ek: number;
}

/** Hatanın düştüğü kutu ve kutudaki 1 tabanlı karakter konumu. */
export interface BoxPosition {
  kutu: FilterBox;
  konum: number;
}

/** Filtre kutusu tek ifade değil: `;` sonrasında metin (ya da psql `\` komutu) var. */
export class FilterError extends Error {
  constructor(readonly kutu: FilterBox) {
    super(`${BOX_LABELS[kutu]} kutusu tek bir ifade olmalı: “;” sonrasındaki metin ve psql komutları gönderilmez.`);
    this.name = 'FilterError';
  }
}

export const BOX_LABELS: Record<FilterBox, string> = { where: 'WHERE', orderBy: 'ORDER BY' };

const list = (names: readonly string[]) => names.map(quoteIdent).join(', ');

/**
 * Kutunun gömülecek metni: lexer'la bölünür, sondaki `;` ve yorum atılır (satır yorumu sorgunun
 * devamını yutamasın). Birden fazla ifade `FilterError`; tek ifade garantisini ayrıca Postgres'in
 * extended protocol'ü verir. Boş kutu `null`.
 */
function boxText(raw: string, kutu: FilterBox): { text: string; start: number } | null {
  const statements = splitStatements(raw);
  if (statements.length > 1 || statements[0]?.meta) throw new FilterError(kutu);
  return statements[0] ?? null;
}

/** PK'lı tablo, kullanıcı `ORDER BY`'ı yok: keyset. Aksi hâlde OFFSET. */
const usesKeyset = (meta: TableMeta, filter: TableFilter) => meta.pk.length > 0 && splitStatements(filter.orderBy).length === 0;

/**
 * Sayfa sorgusu; `cursor` `null` ise ilk sayfa. Kullanıcı `WHERE`'i parantez içinde gömülür;
 * kullanıcı `ORDER BY`'ı varsa PK'lı tabloda da OFFSET ile sayfalanır. İmleç tablonun sayfalama
 * biçimine uymuyorsa (ör. PK değişti) hata fırlatır: yanlış satırlardan devam edilmez.
 */
export function tablePageQuery(meta: TableMeta, cursor: PageCursor | null, filter: TableFilter = NO_FILTER): PageQuery {
  const where = boxText(filter.where, 'where');
  const orderBy = boxText(filter.orderBy, 'orderBy');
  const kutular: PageQuery['kutular'] = {};
  let text = `SELECT ${list(meta.kolonlar)} FROM ${qualifiedName({ sema: meta.sema, ad: meta.tablo })}`;
  const embed = (kutu: FilterBox, prefix: string, box: { text: string; start: number }, ek: number, suffix = '') => {
    kutular[kutu] = { bas: text.length + prefix.length, uzunluk: box.text.length, kayma: box.start, ek };
    text += `${prefix}${box.text}${suffix}`;
  };
  // Yarım ifadede Postgres kapanış parantezini gösterir.
  if (where !== null) embed('where', ' WHERE (', where, 1, ')');

  if (usesKeyset(meta, filter)) {
    if (cursor && (cursor.tur !== 'keyset' || cursor.degerler.length !== meta.pk.length)) {
      throw new Error('Sayfa imleci tablonun PK’sına uymuyor; tabloyu yeniden yükleyin.');
    }
    if (cursor) {
      const params = cursor.degerler.map((_, i) => `$${i + 1}`).join(', ');
      text += `${where === null ? ' WHERE' : ' AND'} (${list(meta.pk)}) > (${params})`;
    }
    text += ` ORDER BY ${list(meta.pk)} LIMIT ${PAGE_ROWS}`;
    return { text, values: cursor ? [...cursor.degerler] : [], mod: 'keyset', kutular };
  }
  const offset = cursor === null ? 0 : cursor.tur === 'offset' ? cursor.offset : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Sayfa imleci tabloya uymuyor; tabloyu yeniden yükleyin.');
  // Yarım ifadede Postgres arkadan gelen `LIMIT`'i gösterir (araya bir boşluk girer).
  if (orderBy !== null) embed('orderBy', ' ORDER BY ', orderBy, 2);
  text += ` LIMIT ${PAGE_ROWS} OFFSET ${offset}`;
  return { text, values: [], mod: 'offset', kutular };
}

/**
 * Postgres'in sorgudaki 1 tabanlı hata konumu bir kullanıcı kutusuna (ya da hemen arkasındaki eke)
 * düşüyorsa o kutu ve kutunun metnindeki 1 tabanlı konum; aksi hâlde `null`. Konum UTF-16
 * birimiyle sayılır: kutudan önce BMP dışı karakter varsa kayabilir.
 */
export function filterErrorPosition(query: PageQuery, position: number | undefined): BoxPosition | null {
  if (position === undefined) return null;
  for (const kutu of ['where', 'orderBy'] as const) {
    const box = query.kutular[kutu];
    if (!box || position <= box.bas || position > box.bas + box.uzunluk + box.ek) continue;
    const inBox = Math.min(position - box.bas, box.uzunluk + 1);
    return { kutu, konum: box.kayma + inBox };
  }
  return null;
}

/** Filtre çubuğunda gösterilen sayfa hatası: kutudaysa kutu ve konumla, SQLSTATE'le. */
export function pageErrorText(error: TablePageError): string {
  const state = error.sqlstate ? ` (SQLSTATE ${error.sqlstate})` : '';
  if (!error.kutu) return `${error.hata}${state}`;
  const place = error.kutuKonumu ? `${BOX_LABELS[error.kutu]}, ${error.kutuKonumu}. karakter` : BOX_LABELS[error.kutu];
  return `${place}: ${error.hata}${state}`;
}

/** Başlıktan konan sıralamanın yönü. */
export type ColumnSort = 'artan' | 'azalan';

/** `ORDER BY` kutusu yalnızca bu kolonun başlıktan konan sıralamasıysa yönü; değilse `null`. */
export function columnSort(orderBy: string, column: string): ColumnSort | null {
  const text = orderBy.trim().replace(/\s+/g, ' ');
  const quoted = quoteIdent(column);
  if (text === quoted) return 'artan';
  // `DESC` büyük/küçük harf duyarsız; tırnaklı ad ise birebir olmalı.
  if (text.startsWith(quoted) && text.slice(quoted.length).toUpperCase() === ' DESC') return 'azalan';
  return null;
}

/** Kolonlardan biri `ORDER BY` kutusunun başlık sıralamasıysa o kolonun indeksi ve yönü. */
export function headerSort(kolonlar: readonly string[], orderBy: string): { kolon: number; yon: ColumnSort } | null {
  for (const [kolon, ad] of kolonlar.entries()) {
    const yon = columnSort(orderBy, ad);
    if (yon) return { kolon, yon };
  }
  return null;
}

/** Kolon başlığına tık: `"kolon"` → `"kolon" DESC` → boş; başka bir sıralama varsa artan başlar. */
export function cycleOrderBy(orderBy: string, column: string): string {
  const quoted = quoteIdent(column);
  switch (columnSort(orderBy, column)) {
    case 'artan':
      return `${quoted} DESC`;
    case 'azalan':
      return '';
    default:
      return quoted;
  }
}

/** Çekilen sayfadan sonraki sayfanın imleci; sayfa dolu değilse son sayfadır (`null`). */
export function nextCursor(
  meta: TableMeta,
  cursor: PageCursor | null,
  rows: readonly (readonly (string | null)[])[],
  filter: TableFilter = NO_FILTER,
): PageCursor | null {
  const last = rows.at(-1);
  if (rows.length < PAGE_ROWS || !last) return null;
  if (usesKeyset(meta, filter)) {
    return { tur: 'keyset', degerler: meta.pk.map((k) => last[meta.kolonlar.indexOf(k)] ?? '') };
  }
  return { tur: 'offset', offset: (cursor?.tur === 'offset' ? cursor.offset : 0) + rows.length };
}

type Rows = (string | null)[][];

export interface LoadedRows {
  satirlar: Rows;
  /** Sonraki sayfanın imleci; son sayfadaysa ya da sınıra ulaşıldıysa `null`. */
  sonraki: PageCursor | null;
  /** 100.000 satır sınırına ulaşıldı, devamı var ama istenmez. */
  sinir: boolean;
}

/**
 * Gelen sayfa yüklü satırların sonuna eklenir; toplam `ROW_LIMIT`'te kesilir. Devamı olan sonuç
 * sınıra ulaşınca sınır işaretlenir ve imleç düşer: daha fazla istenmez.
 */
export function appendPage(loaded: Rows, page: { satirlar: Rows; sonraki: PageCursor | null }): LoadedRows {
  const satirlar = [...loaded, ...page.satirlar];
  const sinir = satirlar.length > ROW_LIMIT || (satirlar.length === ROW_LIMIT && page.sonraki !== null);
  return { satirlar: sinir ? satirlar.slice(0, ROW_LIMIT) : satirlar, sonraki: sinir ? null : page.sonraki, sinir };
}

const COUNT = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** `pg_class.reltuples` başlıkta: `-1` (hiç analiz edilmedi) "≈ bilinmiyor", aksi hâlde `≈ N satır`. */
export function rowEstimate(reltuples: number): string {
  return reltuples < 0 ? '≈ bilinmiyor' : `≈ ${COUNT.format(Math.round(reltuples))} satır`;
}

// --- Uç sözleşmesi: `POST …/veritabanlari/:db/tablo-sayfasi` ---

/** Uygulanan filtre her sayfa isteğinde yeniden gönderilir; sunucu durum tutmaz. */
export interface TablePageRequest extends TableFilter {
  sema: string;
  tablo: string;
  /** `null`: ilk sayfa. */
  sonraki: PageCursor | null;
}

export interface TablePageResponse {
  kolonlar: string[];
  /** Kolon tip OID'leri. */
  tipler: number[];
  /** Ham metin değerler; NULL `null`. */
  satirlar: (string | null)[][];
  /** Sonraki sayfanın imleci; son sayfadaysa `null`. */
  sonraki: PageCursor | null;
  /** OFFSET ile sayfalanıyor: sayfalar arası tutarlılık garanti değil. */
  tutarlilikNotu: boolean;
  /** İlk sayfada: o anki `pg_class.reltuples` (`-1` hiç analiz edilmedi). */
  satirTahmini?: number;
}

/** Sayfa sorgusu Postgres'te hata verdi ya da filtre reddedildi (400 gövdesi). */
export interface TablePageError {
  hata: string;
  sqlstate?: string;
  /** İfadedeki 1 tabanlı karakter konumu. */
  konum?: number;
  /** Hata bir filtre kutusunda: hangisi ve (biliniyorsa) kutunun metnindeki 1 tabanlı konum. */
  kutu?: BoxPosition['kutu'];
  kutuKonumu?: BoxPosition['konum'];
}

export const OFFSET_NOTE = 'Bu tablo OFFSET ile sayfalanıyor: sayfalar arası tutarlılık garanti değil.';

/** İstek gövdesini doğrular; geçersizse `null`. */
export function parseTablePageRequest(raw: unknown): TablePageRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { sema, tablo, where = '', orderBy = '', sonraki = null } = raw as Record<string, unknown>;
  if (typeof sema !== 'string' || typeof tablo !== 'string' || tablo === '') return null;
  if (typeof where !== 'string' || typeof orderBy !== 'string') return null;
  const cursor = parseCursor(sonraki);
  return cursor === undefined ? null : { sema, tablo, where, orderBy, sonraki: cursor };
}

function parseCursor(raw: unknown): PageCursor | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  if (c.tur === 'keyset' && Array.isArray(c.degerler) && c.degerler.every((v) => typeof v === 'string')) {
    return { tur: 'keyset', degerler: c.degerler as string[] };
  }
  if (c.tur === 'offset' && typeof c.offset === 'number') return { tur: 'offset', offset: c.offset };
  return undefined;
}
