import type { StatementStatus } from '../../core/script-calistirma';

/** İfade durumunun satır işareti ve kartlardaki simgesi. */
export const STATUS_SYMBOLS: Record<StatementStatus, string> = {
  basarili: '✓',
  hatali: '✗',
  calisiyor: '●',
  sirada: '○',
  calistirilmadi: '–',
};

export const STATUS_LABELS: Record<StatementStatus, string> = {
  basarili: 'başarılı',
  hatali: 'hatalı',
  calisiyor: 'çalışıyor…',
  sirada: 'sırada',
  calistirilmadi: 'çalıştırılmadı',
};
