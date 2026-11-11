/**
 * Tablo sekmesinin sayfaları (harita Q14, Q16): her sayfa kısa, ayrı, tek ifadelik bir sorgudur.
 * PK'lı tabloda PK sırasıyla keyset (derin sayfalar da hızlı ve tutarlı), PK'sız tabloda
 * `LIMIT … OFFSET …` (sayfalar arası tutarlılık garanti değil). Sunucu bu modülün ürettiği ifadeyi
 * parametreli (extended protocol) çalıştırır.
 */
import { PAGE_ROWS, ROW_LIMIT } from './grid/sabitler';
import { qualifiedName, quoteIdent } from './grid/sql';

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

export interface PageQuery {
  text: string;
  values: string[];
  /** `offset`: sayfalar arası tutarlılık garanti değil. */
  mod: 'keyset' | 'offset';
}

const list = (names: readonly string[]) => names.map(quoteIdent).join(', ');

/**
 * Sayfa sorgusu; `cursor` `null` ise ilk sayfa. İmleç tablonun sayfalama biçimine uymuyorsa
 * (ör. PK değişti) hata fırlatır: yanlış satırlardan devam edilmez.
 */
export function tablePageQuery(meta: TableMeta, cursor: PageCursor | null): PageQuery {
  const select = `SELECT ${list(meta.kolonlar)} FROM ${qualifiedName({ sema: meta.sema, ad: meta.tablo })}`;
  if (meta.pk.length > 0) {
    if (cursor && (cursor.tur !== 'keyset' || cursor.degerler.length !== meta.pk.length)) {
      throw new Error('Sayfa imleci tablonun PK’sına uymuyor; tabloyu yeniden yükleyin.');
    }
    const order = `ORDER BY ${list(meta.pk)} LIMIT ${PAGE_ROWS}`;
    if (!cursor) return { text: `${select} ${order}`, values: [], mod: 'keyset' };
    const params = cursor.degerler.map((_, i) => `$${i + 1}`).join(', ');
    return { text: `${select} WHERE (${list(meta.pk)}) > (${params}) ${order}`, values: [...cursor.degerler], mod: 'keyset' };
  }
  const offset = cursor === null ? 0 : cursor.tur === 'offset' ? cursor.offset : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Sayfa imleci tabloya uymuyor; tabloyu yeniden yükleyin.');
  return { text: `${select} LIMIT ${PAGE_ROWS} OFFSET ${offset}`, values: [], mod: 'offset' };
}

/** Çekilen sayfadan sonraki sayfanın imleci; sayfa dolu değilse son sayfadır (`null`). */
export function nextCursor(meta: TableMeta, cursor: PageCursor | null, rows: readonly (readonly (string | null)[])[]): PageCursor | null {
  const last = rows.at(-1);
  if (rows.length < PAGE_ROWS || !last) return null;
  if (meta.pk.length > 0) {
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

export interface TablePageRequest {
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

/** Sayfa sorgusu Postgres'te hata verdi (400 gövdesi). */
export interface TablePageError {
  hata: string;
  sqlstate?: string;
  /** İfadedeki 1 tabanlı karakter konumu. */
  konum?: number;
}

export const OFFSET_NOTE = 'Bu tablo OFFSET ile sayfalanıyor: sayfalar arası tutarlılık garanti değil.';

/** İstek gövdesini doğrular; geçersizse `null`. */
export function parseTablePageRequest(raw: unknown): TablePageRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { sema, tablo, sonraki = null } = raw as Record<string, unknown>;
  if (typeof sema !== 'string' || typeof tablo !== 'string' || tablo === '') return null;
  const cursor = parseCursor(sonraki);
  return cursor === undefined ? null : { sema, tablo, sonraki: cursor };
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
