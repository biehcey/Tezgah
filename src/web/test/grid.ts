import type { GridOlcumuSecenekleri } from '../grid/olcum';

/**
 * jsdom'da yerleşim yok (her öğe 0×0): grid sabit boyutlu bir kaydırma alanıyla çizilir ve ölçüm
 * gözlemcisi bu değeri ezmez. Sabit satır yüksekliğiyle satırlar ölçülmez.
 */
export const JSDOM_OLCUMU: GridOlcumuSecenekleri = {
  initialRect: { width: 1000, height: 400 },
  observeElementRect: () => undefined,
};
