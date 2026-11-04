/**
 * Postgres hata konumunu editöre eşler (wayfinder 05): `position` ifade metni içinde 1 tabanlı
 * karakter sırasıdır; ifadenin betikteki başlangıç offset'iyle betik satır/sütununa çevrilir.
 */
import { positionOf, type Statement } from './ifade-bolme';

export interface ErrorLocation {
  /** İşaretin başladığı 1 tabanlı satır ve sütun. */
  satir: number;
  sutun: number;
  /** İşaretlenecek aralık, betik offset'i olarak (`bit` hariç). */
  bas: number;
  bit: number;
}

export function errorLocation(script: string, statement: Pick<Statement, 'start' | 'end'>, position?: number): ErrorLocation {
  const { start, end } = statement;
  if (position === undefined || !Number.isFinite(position) || position < 1) {
    return { ...positionOf(script, start), bas: start, bit: end };
  }
  // Postgres karakter sayar; JS dizgesi UTF-16 birimleriyle. Kod noktası kod noktası ilerlenir.
  let offset = start;
  for (let n = 1; n < position && offset < end; n++) {
    offset += (script.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
  }
  // Girdinin sonundaki hata ("at end of input") son karakteri işaretler.
  if (offset >= end) offset = Math.max(start, end - 1);
  let bit = offset + 1;
  while (bit < end && !/\s/.test(script[bit]!)) bit++;
  return { ...positionOf(script, offset), bas: offset, bit };
}
