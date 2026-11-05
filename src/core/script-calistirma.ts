/**
 * Script çalıştırmanın WebSocket sözleşmesi (wayfinder 06, ADR-0002) ve arayüzün olaylardan
 * kurduğu çalıştırma görünümü. Olaylar ifade indeksiyle gelir; indeksler `splitStatements`'in
 * aynı betik için verdiği sıradır.
 */
import { splitStatements, positionOf, type Statement } from './ifade-bolme';
import type { Target } from './veritabani-secimi';

/** SELECT önizlemesinde sunucudan çekilen en fazla satır. */
export const PREVIEW_ROWS = 100;

// ---------- İstemci → sunucu ----------

export type ClientMessage =
  | { type: 'run'; target: Target; script: string }
  | { type: 'commit' }
  | { type: 'rollback' }
  /** Karar süresini baştan başlatır. */
  | { type: 'uzat' }
  | { type: 'iptal' };

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'commit' || m.type === 'rollback' || m.type === 'uzat' || m.type === 'iptal') return { type: m.type };
  if (m.type !== 'run' || typeof m.script !== 'string') return null;
  const target = m.target as Record<string, unknown> | null | undefined;
  if (typeof target?.connectionId !== 'string' || typeof target.database !== 'string') return null;
  return { type: 'run', target: { connectionId: target.connectionId, database: target.database }, script: m.script };
}

// ---------- Sunucu → istemci ----------

/** Kolon adları ve metin olarak değerler (NULL `null`). */
export interface Preview {
  kolonlar: string[];
  satirlar: (string | null)[][];
}

/**
 * Çalıştırmanın sonu. `sureDoldu`: Karar süresi doldu, transaction geri alındı. `hata`: çalıştırma
 * başlayamadı, bağlantı koptu ya da commit başarısız oldu.
 */
export type RunResult = 'commit' | 'rollback' | 'sureDoldu' | 'iptal' | 'hata';

export type ServerEvent =
  | { type: 'started'; i: number }
  | { type: 'done'; i: number; rowCount: number | null; ms: number; komut: string; onizleme?: Preview }
  | { type: 'error'; i: number; sqlstate: string | null; mesaj: string; satir: number; sutun: number; bas: number; bit: number; ms: number }
  /** Script bitti, transaction açık; hatadan sonra commit edilemez. `kalanMs`: Karar süresi. */
  | { type: 'kararBekleniyor'; commitEdilebilir: boolean; kalanMs: number }
  /** "Uzat" sunucuda işlendi; Karar süresi baştan başladı. */
  | { type: 'uzatildi'; kalanMs: number }
  | { type: 'bitti'; sonuc: RunResult; mesaj?: string }
  /** İstek reddedildi; çalıştırma sürüyor. */
  | { type: 'uyari'; tur: 'commitReddedildi' | 'mesgul' | 'gecersizIstek'; mesaj: string };

// ---------- Arayüzün görünümü ----------

export type StatementStatus = 'sirada' | 'calisiyor' | 'basarili' | 'hatali' | 'calistirilmadi';

export interface StatementView {
  i: number;
  /** İfadenin başladığı 1 tabanlı satır. */
  satir: number;
  /** Sunucu dönmeden önce ilk anahtar kelime; sonra komut etiketi. */
  komut: string;
  durum: StatementStatus;
  ms?: number;
  rowCount?: number | null;
  onizleme?: Preview;
  hata?: { sqlstate: string | null; mesaj: string; satir: number; sutun: number; bas: number; bit: number };
}

export type RunPhase = 'calisiyor' | 'karar' | 'bitti';

export interface RunView {
  script: string;
  ifadeler: StatementView[];
  evre: RunPhase;
  commitEdilebilir: boolean;
  /** İstemci commit/rollback/uzat/iptal gönderdi, yanıt bekleniyor. */
  bekleyenIstek: 'commit' | 'rollback' | 'uzat' | 'iptal' | null;
  /**
   * Sunucunun bildirdiği kalan Karar süresi; `surum` her bildirimde artar ki arayüz geri sayımı
   * o andan yeniden kursun. Yetkili sayaç sunucudadır.
   */
  kararSuresi?: { kalanMs: number; surum: number };
  sonuc?: RunResult;
  mesaj?: string;
  /** Son reddedilen istek ya da uyarı. */
  uyari?: string;
}

export function startRunView(script: string): RunView {
  return {
    script,
    ifadeler: splitStatements(script).map((s, i) => statementView(script, s, i)),
    evre: 'calisiyor',
    commitEdilebilir: false,
    bekleyenIstek: null,
  };
}

function statementView(script: string, s: Statement, i: number): StatementView {
  return { i, satir: positionOf(script, s.start).satir, komut: s.keywords[0] ?? s.text.slice(0, 12), durum: 'sirada' };
}

export function applyEvent(view: RunView, event: ServerEvent): RunView {
  const update = (i: number, patch: Partial<StatementView>) => ({
    ...view,
    ifadeler: view.ifadeler.map((s) => (s.i === i ? { ...s, ...patch } : s)),
  });
  switch (event.type) {
    case 'started':
      return update(event.i, { durum: 'calisiyor' });
    case 'done':
      return update(event.i, {
        durum: 'basarili',
        komut: event.komut,
        ms: event.ms,
        rowCount: event.rowCount,
        onizleme: event.onizleme,
      });
    case 'error': {
      const { type: _t, i, ms, ...hata } = event;
      const next = update(i, { durum: 'hatali', ms, hata });
      return { ...next, ifadeler: next.ifadeler.map((s) => (s.durum === 'sirada' ? { ...s, durum: 'calistirilmadi' } : s)) };
    }
    case 'kararBekleniyor':
      return { ...view, evre: 'karar', commitEdilebilir: event.commitEdilebilir, kararSuresi: nextTimer(view, event.kalanMs) };
    case 'uzatildi':
      return { ...view, bekleyenIstek: null, kararSuresi: nextTimer(view, event.kalanMs) };
    case 'bitti':
      return {
        ...view,
        evre: 'bitti',
        bekleyenIstek: null,
        sonuc: event.sonuc,
        mesaj: event.mesaj,
        ifadeler: view.ifadeler.map((s) =>
          s.durum === 'sirada' || s.durum === 'calisiyor' ? { ...s, durum: 'calistirilmadi' } : s,
        ),
      };
    case 'uyari':
      return { ...view, bekleyenIstek: null, uyari: event.mesaj };
  }
}

function nextTimer(view: RunView, kalanMs: number): RunView['kararSuresi'] {
  return { kalanMs, surum: (view.kararSuresi?.surum ?? 0) + 1 };
}

/**
 * Editörün hedefi değiştirilebilir mi; değiştirilemiyorsa neden. Açık transaction'ın hedefi
 * başlıkta görünenle aynı kalmalı: script çalışırken ve karar beklenirken hedef kilitlidir.
 */
export function targetLock(view: RunView | null): string | null {
  switch (view?.evre) {
    case 'karar':
      return 'Commit/rollback kararı bekleniyor';
    case 'calisiyor':
      return 'Script çalışıyor';
    default:
      return null;
  }
}
