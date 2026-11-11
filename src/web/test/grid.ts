import type { GridOlcumuSecenekleri } from '../grid/olcum';

/**
 * jsdom'da yerleşim yok (her öğe 0×0) ve canvas yok: grid sabit boyutlu bir kaydırma alanıyla
 * çizilir, ölçüm gözlemcisi bu değeri ezmez; yazı genişliği karakter başına 8 px sayılır.
 */
export const JSDOM_OLCUMU: GridOlcumuSecenekleri = {
  sanal: {
    initialRect: { width: 1000, height: 400 },
    observeElementRect: () => undefined,
  },
  metinGenisligi: (metin) => [...metin].length * 8,
};
