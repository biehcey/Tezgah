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
 * Ölçülen gösterimin en fazla uzunluğu: 400 px sınırını en dar yazıda da aşmaya yeter; 1000
 * karakterlik hücreyi baştan sona ölçmeye gerek yok.
 */
const MEASURE_CHARS = 200;

/** Metnin hücre yazısıyla piksel genişliği; başlık kalın yazılır. */
export type TextWidth = (metin: string, baslik: boolean) => number;

/**
 * İlk sayfadan ölçülen kolon genişlikleri: başlığın ve hücre gösterimlerinin en genişi, iç
 * boşlukla; en az 48, en fazla 400 px. Ölçüm gerçek yazıyla yapıldığından geniş karakterler
 * (CJK, emoji) ve kalın başlık da hesaba girer.
 */
export function initialColumnWidths(kolonlar: readonly string[], satirlar: readonly (readonly (string | null)[])[], olc: TextWidth): number[] {
  const cap = MAX_INITIAL_WIDTH - CELL_PADDING;
  return kolonlar.map((ad, c) => {
    let widest = olc(ad, true);
    for (const row of satirlar) {
      if (widest >= cap) break;
      const shown = cellDisplay(row[c] ?? null);
      widest = Math.max(widest, olc(shown.null ? NULL_LABEL : shown.metin.slice(0, MEASURE_CHARS), false));
    }
    return Math.min(Math.max(Math.ceil(widest) + CELL_PADDING, MIN_COLUMN_WIDTH), MAX_INITIAL_WIDTH);
  });
}
