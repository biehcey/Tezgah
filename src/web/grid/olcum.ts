import type { VirtualizerOptions } from '@tanstack/react-virtual';
import { createContext } from 'react';

/**
 * Grid sanallaştırıcısının ölçüm seçenekleri. Tarayıcıda boştur (kaydırma alanı `ResizeObserver`
 * ile ölçülür); jsdom'da yerleşim olmadığından testler sabit bir `initialRect` verir.
 */
export type GridOlcumuSecenekleri = Partial<Pick<VirtualizerOptions<HTMLDivElement, Element>, 'initialRect' | 'observeElementRect'>>;

export const GridOlcumu = createContext<GridOlcumuSecenekleri>({});
