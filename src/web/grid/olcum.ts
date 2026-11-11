import type { VirtualizerOptions } from '@tanstack/react-virtual';
import { createContext } from 'react';
import type { TextWidth } from '../../core/grid/gosterim';

/**
 * Grid'in tarayıcı ölçümleri. Tarayıcıda boştur: kaydırma alanı `ResizeObserver` ile, yazı
 * genişliği canvas ile hücrenin kendi yazı tipinden ölçülür. jsdom'da yerleşim ve canvas
 * olmadığından testler sabit bir kaydırma alanı ve yazı ölçüsü verir.
 */
export interface GridOlcumuSecenekleri {
  sanal?: Partial<Pick<VirtualizerOptions<HTMLDivElement, Element>, 'initialRect' | 'observeElementRect'>>;
  metinGenisligi?: TextWidth;
}

export const GridOlcumu = createContext<GridOlcumuSecenekleri>({});

/**
 * Hücre ve başlık öğelerinin hesaplanmış yazı tipiyle canvas üzerinde ölçen `TextWidth`;
 * canvas yoksa `null`.
 */
export function canvasTextWidth(hucre: CSSStyleDeclaration, baslik: CSSStyleDeclaration): TextWidth | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const font = (s: CSSStyleDeclaration) => `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const fonts = { hucre: font(hucre), baslik: font(baslik) };
  return (metin, isHeader) => {
    const f = isHeader ? fonts.baslik : fonts.hucre;
    if (ctx.font !== f) ctx.font = f;
    return ctx.measureText(metin).width;
  };
}
