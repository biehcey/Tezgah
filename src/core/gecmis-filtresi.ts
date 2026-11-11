/**
 * Sorgu geçmişi paneli için Çalıştırma kayıtlarının filtresi (ikinci dilim, 1.2). Sunucu sayfalarken,
 * arayüz sonucu gösterirken aynı eşlemeyi kullanır.
 */
import type { RecordResult, RunRecord, StartedLine, TargetSnapshot } from './calistirma-kaydi';

/** Paneldeki sonuç filtresinin seçenekleri. "bilinmiyor" bunlardan biri değildir: her zaman görünür. */
export const ALL_RESULT_GROUPS = ['basarili', 'hata', 'deneme', 'rollback'] as const;
export type ResultGroup = (typeof ALL_RESULT_GROUPS)[number];

/** Autocommit başarısı kayda `commit` olarak yazılır (mod `autocommit`). */
const GROUP_OF: Record<RecordResult, ResultGroup> = {
  commit: 'basarili',
  okuma: 'basarili',
  hata: 'hata',
  iptal: 'hata',
  'deneme-rollback': 'deneme',
  rollback: 'rollback',
  'karar-suresi-doldu': 'rollback',
  'kopma-rollback': 'rollback',
};

/**
 * Kaydın sonuç grubu; `bitti` satırı olmayan ya da daha yeni bir Tezgah'ın yazdığı bilinmeyen
 * sonuçta `null` (bilinmiyor).
 */
export function resultGroup(sonuc: RunRecord['sonuc']): ResultGroup | null {
  return Object.hasOwn(GROUP_OF, sonuc) ? GROUP_OF[sonuc as RecordResult] : null;
}

/** Hedef = bağlantı + veritabanı (çalıştırma anındaki anlık kopyadan). */
export interface HistoryTarget {
  baglantiId: string;
  veritabani: string;
}

export interface HistoryFilter {
  /** `null`: tüm hedefler. */
  hedef: HistoryTarget | null;
  /** Script'te büyük/küçük harf duyarsız aranır; boşsa süzmez. */
  metin: string;
  /** Seçili sonuç grupları; "bilinmiyor" bunlardan bağımsız olarak her zaman görünür. */
  sonuclar: readonly ResultGroup[];
  /** Başlama zamanı bu andan önce olmayanlar (dahil); `null`: alt sınır yok. */
  baslangic: Date | null;
  /** Başlama zamanı bu andan önce olanlar (hariç); `null`: üst sınır yok. */
  bitis: Date | null;
}

/**
 * Büyük/küçük harf eşlemesi yerelden bağımsızdır: Türkçe kurallarıyla `INSERT` → `ınsert` olur ve
 * `insert` araması onu bulamazdı.
 */
const lowerCase = (text: string) => text.toLowerCase();

export function matchesHistoryFilter(record: RunRecord, filter: HistoryFilter): boolean {
  const { basladi } = record;
  if (filter.hedef && (basladi.hedef.baglantiId !== filter.hedef.baglantiId || basladi.hedef.veritabani !== filter.hedef.veritabani)) {
    return false;
  }
  const group = resultGroup(record.sonuc);
  if (group !== null && !filter.sonuclar.includes(group)) return false;
  const started = Date.parse(basladi.zaman);
  if (filter.baslangic && started < filter.baslangic.getTime()) return false;
  if (filter.bitis && started >= filter.bitis.getTime()) return false;
  const needle = lowerCase(filter.metin.trim());
  return needle === '' || lowerCase(basladi.script).includes(needle);
}

/** Geçmişin sırası: yeniden eskiye; aynı anda başlayanlar `runId`'ye göre (azalan). */
export function compareNewestFirst(a: RunRecord, b: RunRecord): number {
  return compareKeys(historyKey(b), historyKey(a));
}

/** Sıradaki konum; sayfalama imleci budur. */
export interface HistoryKey {
  zaman: string;
  runId: string;
}

export const historyKey = (record: RunRecord): HistoryKey => ({ zaman: record.basladi.zaman, runId: record.runId });

/** Artan sıra: önce zaman, sonra `runId`. */
export function compareKeys(a: HistoryKey, b: HistoryKey): number {
  const byTime = Date.parse(a.zaman) - Date.parse(b.zaman);
  if (byTime !== 0) return byTime;
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}

/** Filtreye uyan kayıtlar, yeniden eskiye. */
export function filterHistory(records: readonly RunRecord[], filter: HistoryFilter): RunRecord[] {
  return records.filter((r) => matchesHistoryFilter(r, filter)).sort(compareNewestFirst);
}

// ---------- `GET /api/calistirma-kayitlari` sözleşmesi ----------

/** Paneldeki bir kayıt: yalnızca gösterilen ve sekmede açmak için gereken alanlar. */
export interface HistoryEntry {
  runId: string;
  zaman: string;
  hedef: TargetSnapshot;
  mod: StartedLine['mod'];
  deneme: boolean;
  sonuc: RunRecord['sonuc'];
  script: string;
}

export interface HistoryPage {
  kayitlar: HistoryEntry[];
  /** Sonraki (daha eski) sayfanın imleci; son sayfada `null`. */
  sonraki: string | null;
}

export interface HistoryQuery extends HistoryFilter {
  /** Önceki sayfanın `sonraki` değeri; ilk sayfada `null`. */
  imlec: string | null;
  limit: number;
}

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

export function historyEntry(record: RunRecord): HistoryEntry {
  const { runId, zaman, hedef, mod, deneme, script } = record.basladi;
  return { runId, zaman, hedef, mod, deneme, sonuc: record.sonuc, script };
}

/** İmleç opaktır; içinde son kaydın sıradaki konumu vardır. */
export function encodeCursor(key: HistoryKey): string {
  return `${key.zaman}|${key.runId}`;
}

export function decodeCursor(cursor: string): HistoryKey | null {
  const at = cursor.indexOf('|');
  if (at === -1) return null;
  const zaman = cursor.slice(0, at);
  const runId = cursor.slice(at + 1);
  return Number.isNaN(Date.parse(zaman)) || runId === '' ? null : { zaman, runId };
}

/** Sorgunun URL parametreleri (`new URLSearchParams(...)` için); varsayılan değerler yazılmaz. */
export function historySearchParams(query: HistoryQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.hedef) {
    params.baglanti = query.hedef.baglantiId;
    params.veritabani = query.hedef.veritabani;
  }
  if (query.metin.trim() !== '') params.metin = query.metin;
  if (ALL_RESULT_GROUPS.some((g) => !query.sonuclar.includes(g))) params.sonuc = query.sonuclar.join(',');
  if (query.baslangic) params.baslangic = query.baslangic.toISOString();
  if (query.bitis) params.bitis = query.bitis.toISOString();
  if (query.imlec) params.imlec = query.imlec;
  if (query.limit !== DEFAULT_HISTORY_LIMIT) params.limit = String(query.limit);
  return params;
}

/** `URLSearchParams`'ın core'un ihtiyaç duyduğu kısmı. */
export interface SearchParams {
  get(name: string): string | null;
}

export type ParsedHistoryQuery = { ok: true; query: HistoryQuery; cursor: HistoryKey | null } | { ok: false; hata: string };

/** `historySearchParams`'ın tersi; sunucu doğrular. */
export function parseHistorySearchParams(params: SearchParams): ParsedHistoryQuery {
  const fail = (hata: string): ParsedHistoryQuery => ({ ok: false, hata });
  const baglantiId = params.get('baglanti');
  const veritabani = params.get('veritabani');
  if ((baglantiId === null) !== (veritabani === null) || baglantiId === '' || veritabani === '') {
    return fail('Hedef için baglanti ve veritabani birlikte verilmeli');
  }
  const rawResults = params.get('sonuc');
  const sonuclar: readonly string[] = rawResults === null ? ALL_RESULT_GROUPS : rawResults === '' ? [] : rawResults.split(',');
  if (!sonuclar.every((s): s is ResultGroup => (ALL_RESULT_GROUPS as readonly string[]).includes(s))) {
    return fail(`Sonuç şunlardan olmalı: ${ALL_RESULT_GROUPS.join(', ')}`);
  }
  const date = (name: string): Date | null | undefined => {
    const raw = params.get(name);
    if (raw === null) return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? undefined : at;
  };
  const baslangic = date('baslangic');
  const bitis = date('bitis');
  if (baslangic === undefined || bitis === undefined) return fail('Tarih ISO 8601 biçiminde olmalı');
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_HISTORY_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) return fail(`limit 1–${MAX_HISTORY_LIMIT} arasında olmalı`);
  const imlec = params.get('imlec');
  const cursor = imlec === null ? null : decodeCursor(imlec);
  if (imlec !== null && cursor === null) return fail('Geçersiz imleç');
  return {
    ok: true,
    cursor,
    query: {
      hedef: baglantiId !== null && veritabani !== null ? { baglantiId, veritabani } : null,
      metin: params.get('metin') ?? '',
      sonuclar,
      baslangic,
      bitis,
      imlec,
      limit,
    },
  };
}
