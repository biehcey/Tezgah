import { CELL_CHARS, MAX_INITIAL_WIDTH, MIN_COLUMN_WIDTH } from './sabitler';

/** Hücrenin tek satırlık gösterimi; NULL boş metinden ayrı bir durumdur. */
export type CellDisplay = { null: true } | { null: false; metin: string };

export const NULL_LABEL = 'NULL';
/** Satır sonlarının hücredeki işareti. */
export const LINE_BREAK = '↵';

/**
 * Değeri hücreye basılacak tek satıra çevirir: satır sonları `↵` olur, ilk 1000 karakterden
 * sonrası `…` ile kesilir. Kolon genişliğindeki kırpma görünümün işidir (CSS).
 */
export function cellDisplay(value: string | null): CellDisplay {
  if (value === null) return { null: true };
  let shown = value;
  if (shown.length > CELL_CHARS) {
    shown = shown.slice(0, CELL_CHARS);
    // Kesim bir vekil çiftin ortasına denk geldiyse yarım karakter basılmaz.
    const last = shown.charCodeAt(shown.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) shown = shown.slice(0, -1);
    shown += '…';
  }
  return { null: false, metin: shown.replace(/\r\n|\r|\n/g, LINE_BREAK) };
}

/** Kolon kenarlarının iç boşluğu (px). */
const CELL_PADDING = 16;

/**
 * İlk sayfadan ölçülen kolon genişlikleri: başlığın ve hücre gösterimlerinin en uzunu, sabit
 * genişlikli yazıda `karakterPx` ile; en az 48, en fazla 400 px.
 */
export function initialColumnWidths(kolonlar: readonly string[], satirlar: readonly (readonly (string | null)[])[], karakterPx: number): number[] {
  return kolonlar.map((ad, c) => {
    let chars = ad.length;
    const cap = Math.ceil(MAX_INITIAL_WIDTH / karakterPx);
    for (const row of satirlar) {
      if (chars >= cap) break;
      const shown = cellDisplay(row[c] ?? null);
      chars = Math.max(chars, shown.null ? NULL_LABEL.length : shown.metin.length);
    }
    return Math.min(Math.max(chars * karakterPx + CELL_PADDING, MIN_COLUMN_WIDTH), MAX_INITIAL_WIDTH);
  });
}
