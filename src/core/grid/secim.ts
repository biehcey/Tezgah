/**
 * Grid'in seçim modeli ve klavye gezinmesi. Seçim bir çapa ile aktif hücre arasındaki dikdörtgen
 * aralıktır; odak ve kaydırma aktif hücreyi izler, Shift ile genişletmede çapa yerinde kalır.
 */

export interface Cell {
  satir: number;
  kolon: number;
}

export interface Selection {
  capa: Cell;
  aktif: Cell;
}

/** Aralığın normalleşmiş sınırları (dahil). */
export interface Range {
  ust: number;
  alt: number;
  sol: number;
  sag: number;
}

export interface GridSize {
  satirlar: number;
  kolonlar: number;
  /** PageUp/PageDown'ın atladığı satır sayısı (görünen satırlar). */
  sayfa: number;
}

/** Bir tuş olayı; `ctrl` Ctrl ya da Cmd. */
export interface NavKey {
  tus: string;
  shift: boolean;
  ctrl: boolean;
}

export function selectCell(cell: Cell): Selection {
  return { capa: cell, aktif: cell };
}

/** Çapayı yerinde bırakıp aralığı `cell`'e kadar genişletir (Shift+tık). */
export function extendTo(sel: Selection, cell: Cell): Selection {
  return { capa: sel.capa, aktif: cell };
}

export function selectionRange({ capa, aktif }: Selection): Range {
  return {
    ust: Math.min(capa.satir, aktif.satir),
    alt: Math.max(capa.satir, aktif.satir),
    sol: Math.min(capa.kolon, aktif.kolon),
    sag: Math.max(capa.kolon, aktif.kolon),
  };
}

export function isSelected(sel: Selection, { satir, kolon }: Cell): boolean {
  const r = selectionRange(sel);
  return satir >= r.ust && satir <= r.alt && kolon >= r.sol && kolon <= r.sag;
}

/** Aralıktaki değerler, satır satır. */
export function selectedValues<T>(rows: readonly (readonly T[])[], sel: Selection): T[][] {
  const r = selectionRange(sel);
  return rows.slice(r.ust, r.alt + 1).map((row) => row.slice(r.sol, r.sag + 1));
}

/**
 * Tuşun ürettiği yeni seçim. Oklar, Home/End, Ctrl+Home/End ve PageUp/PageDown Shift ile aralığı
 * genişletir. Tab/Shift+Tab sağa/sola gider ve satır sonunda sarar; grid'in ilk/son hücresinde
 * `null` döner ki odak grid'den çıkabilsin. Gezinme tuşu değilse ya da grid boşsa `null`.
 */
export function navigate(sel: Selection, key: NavKey, size: GridSize): Selection | null {
  if (size.satirlar === 0 || size.kolonlar === 0) return null;
  const { satir, kolon } = sel.aktif;
  const sonSatir = size.satirlar - 1;
  const sonKolon = size.kolonlar - 1;
  if (key.tus === 'Tab') {
    const index = satir * size.kolonlar + kolon + (key.shift ? -1 : 1);
    if (index < 0 || index > size.satirlar * size.kolonlar - 1) return null;
    return selectCell({ satir: Math.floor(index / size.kolonlar), kolon: index % size.kolonlar });
  }
  let next: Cell;
  switch (key.tus) {
    case 'ArrowDown':
      next = { satir: satir + 1, kolon };
      break;
    case 'ArrowUp':
      next = { satir: satir - 1, kolon };
      break;
    case 'ArrowRight':
      next = { satir, kolon: kolon + 1 };
      break;
    case 'ArrowLeft':
      next = { satir, kolon: kolon - 1 };
      break;
    case 'Home':
      next = key.ctrl ? { satir: 0, kolon: 0 } : { satir, kolon: 0 };
      break;
    case 'End':
      next = key.ctrl ? { satir: sonSatir, kolon: sonKolon } : { satir, kolon: sonKolon };
      break;
    case 'PageDown':
      next = { satir: satir + Math.max(size.sayfa, 1), kolon };
      break;
    case 'PageUp':
      next = { satir: satir - Math.max(size.sayfa, 1), kolon };
      break;
    default:
      return null;
  }
  const cell = clamp(next, size);
  return key.shift ? extendTo(sel, cell) : selectCell(cell);
}

function clamp({ satir, kolon }: Cell, size: GridSize): Cell {
  return {
    satir: Math.min(Math.max(satir, 0), size.satirlar - 1),
    kolon: Math.min(Math.max(kolon, 0), size.kolonlar - 1),
  };
}
