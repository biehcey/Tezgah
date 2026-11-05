/**
 * Deneme modu (wayfinder 16): script Transaction modunda çalışır ve sonunda her zaman geri alınır.
 * DML ifadeleri neyi değiştirdiklerini döndürsün diye yeniden yazılır; dönen satırlar ifade başına
 * değişiklik önizlemesidir (UPDATE'te yeni hâl, INSERT'te eklenen, DELETE'te silinen satır).
 */
import type { Statement } from './ifade-bolme';

/** Değişiklik önizlemesi verilen komutlar ve başlıktaki fiilleri. */
export const DML_VERBS: Readonly<Record<string, string>> = { INSERT: 'eklendi', UPDATE: 'güncellendi', DELETE: 'silindi' };

export interface DenemeStatement {
  /** Sunucuya gönderilecek metin; ekler yalnızca sona gelir, hata konumları değişmez. */
  text: string;
  /** İfade satır değiştirir (DML); dönen satırları değişiklik önizlemesidir. */
  degistirir: boolean;
}

/**
 * INSERT/UPDATE/DELETE'in sonuna `RETURNING *` ekler. Kullanıcı zaten `RETURNING` yazdıysa ifadeye
 * dokunulmaz; önizleme onun döndürdüğüdür. `WITH … DELETE` gibi CTE'li DML yeniden yazılmaz: ana
 * ifadeyi bulmak SQL ayrıştırması ister.
 */
export function withReturning(statement: Statement): DenemeStatement {
  if (!Object.hasOwn(DML_VERBS, statement.keywords[0] ?? '')) return { text: statement.text, degistirir: false };
  // `words` dizge, yorum ve tırnaklı adları içermez; çıplak `returning` ayrılmış kelimedir.
  if (statement.words.includes('RETURNING')) return { text: statement.text, degistirir: true };
  return { text: `${statement.text} RETURNING *`, degistirir: true };
}
