/**
 * Karar süresi (wayfinder 21): Transaction modunda script bittikten sonra commit/rollback kararı
 * için tanınan süre. Saf durum makinesidir; zaman (`simdi`, ms) dışarıdan verilir. Yetkili sayaç
 * Tezgah sunucusundadır; arayüz aynı kurallarla yalnızca geri sayımı gösterir.
 */
import { isProd, type EnvTag } from './baglanti';

const DAKIKA = 60_000;

/** prod'da 5 dk, diğer ortamlarda ve etiketsiz bağlantılarda 30 dk. */
export function decisionDurationMs(envTag: EnvTag | null): number {
  return isProd(envTag) ? 5 * DAKIKA : 30 * DAKIKA;
}

/** Son bu kadar sürede geri sayım görünür. */
export const COUNTDOWN_MS = DAKIKA;

/**
 * `BEGIN`'den hemen sonra verilen `idle_in_transaction_session_timeout`: Node zamanlayıcısı
 * işlemezken (dizüstü uykuda) uzak sunucuda transaction'ın açık kalmasını önleyen yedek.
 */
export function serverIdleTimeoutMs(durationMs: number): number {
  return durationMs + DAKIKA;
}

export interface DecisionTimer {
  sureMs: number;
  /** Sürenin dolduğu an. */
  bitis: number;
}

export type DecisionPhase = 'bekliyor' | 'geriSayim' | 'doldu';

/** `başlat`: sayım son ifadenin bitişinden (ya da hatadan) başlar. */
export function startDecision(sureMs: number, simdi: number): DecisionTimer {
  return { sureMs, bitis: simdi + sureMs };
}

/** `uzat`: süre o andan baştan başlar; sınırsız. Süre dolduysa `null` (uzatılamaz). */
export function extendDecision(timer: DecisionTimer, simdi: number): DecisionTimer | null {
  if (simdi >= timer.bitis) return null;
  return startDecision(timer.sureMs, simdi);
}

/** `tik`: kalan süre ve evre (son 1 dakikada geri sayım). Kalan süre tam süreyi aşmaz. */
export function decisionStatus(timer: DecisionTimer, simdi: number): { kalanMs: number; evre: DecisionPhase } {
  const kalanMs = Math.min(timer.sureMs, Math.max(0, timer.bitis - simdi));
  return { kalanMs, evre: kalanMs === 0 ? 'doldu' : kalanMs <= COUNTDOWN_MS ? 'geriSayim' : 'bekliyor' };
}

/** `commit isteği`: süre dolduysa (bitiş anı dahil, tolerans yok) reddedilir. */
export function commitRequest(timer: DecisionTimer, simdi: number): 'kabul' | 'sureDoldu' {
  return simdi >= timer.bitis ? 'sureDoldu' : 'kabul';
}

/** Geri sayımın `m:ss` yazılışı; kısmi saniye yukarı yuvarlanır (0:00 yalnızca süre dolunca). */
export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
