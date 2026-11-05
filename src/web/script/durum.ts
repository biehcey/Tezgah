import type { StatementStatus } from '../../core/script-calistirma';

/** İfade durumunun satır işareti ve kartlardaki simgesi. */
export const STATUS_SYMBOLS: Record<StatementStatus, string> = {
  basarili: '✓',
  hatali: '✗',
  calisiyor: '●',
  sirada: '○',
  calistirilmadi: '–',
};

/** Script analizinin işaretlediği ifade: Karışık script'teki transaction dışı ya da reddedilen. */
export type AnalysisMark = 'transactionDisi' | 'reddedilen';

/** Analiz işaretinin satır simgesi, açıklaması ve editördeki satır zemini sınıfı. */
export const ANALYSIS_MARKS: Record<AnalysisMark, { symbol: string; label: string; lineClass: string }> = {
  transactionDisi: { symbol: '⚠', label: 'transaction dışı', lineClass: 'cm-transaction-disi' },
  reddedilen: { symbol: '⛔', label: 'reddedildi', lineClass: 'cm-reddedilen' },
};

export const isAnalysisMark = (mark: StatementStatus | AnalysisMark): mark is AnalysisMark => mark in ANALYSIS_MARKS;

export const STATUS_LABELS: Record<StatementStatus, string> = {
  basarili: 'başarılı',
  hatali: 'hatalı',
  calisiyor: 'çalışıyor…',
  sirada: 'sırada',
  calistirilmadi: 'çalıştırılmadı',
};
