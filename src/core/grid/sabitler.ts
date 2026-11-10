/** Grid'in ortak sınırları (ikinci dilim spec'i, "core: grid"). */

/** SELECT sonucunda bir seferde sunucudan çekilen satır (ilk sayfa ve her "daha fazla"). */
export const PAGE_ROWS = 500;
/** Bir sonuçta yüklenebilecek en fazla satır; tarayıcı yükseklik sınırının altında kalır. */
export const ROW_LIMIT = 100_000;
/** Hücreye basılan en fazla karakter; değerin tamamı bellekte kalır. */
export const CELL_CHARS = 1000;
/** İlk sayfadan ölçülen kolon genişliğinin sınırları (px). */
export const MAX_INITIAL_WIDTH = 400;
export const MIN_COLUMN_WIDTH = 48;
