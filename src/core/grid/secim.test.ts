import { describe, expect, it } from 'vitest';
import { isSelected, navigate, selectCell, selectedValues, selectionRange } from './secim';

const SIZE = { satirlar: 10, kolonlar: 4, sayfa: 3 };
const key = (tus: string, mods: { shift?: boolean; ctrl?: boolean } = {}) => ({ tus, shift: false, ctrl: false, ...mods });

describe('Grid gezinme', () => {
  it('oklar aktif hücreyi bir adım taşır ve aralığı tek hücreye indirir', () => {
    const sel = selectCell({ satir: 2, kolon: 1 });
    expect(navigate(sel, key('ArrowDown'), SIZE)).toEqual(selectCell({ satir: 3, kolon: 1 }));
    expect(navigate(sel, key('ArrowUp'), SIZE)).toEqual(selectCell({ satir: 1, kolon: 1 }));
    expect(navigate(sel, key('ArrowRight'), SIZE)).toEqual(selectCell({ satir: 2, kolon: 2 }));
    expect(navigate(sel, key('ArrowLeft'), SIZE)).toEqual(selectCell({ satir: 2, kolon: 0 }));
  });

  it('kenarda ok tuşu hücreyi yerinde bırakır', () => {
    expect(navigate(selectCell({ satir: 0, kolon: 0 }), key('ArrowUp'), SIZE)).toEqual(selectCell({ satir: 0, kolon: 0 }));
    expect(navigate(selectCell({ satir: 9, kolon: 3 }), key('ArrowRight'), SIZE)).toEqual(selectCell({ satir: 9, kolon: 3 }));
  });

  it("Shift+ok çapayı yerinde bırakıp aralığı genişletir; Shift'siz ok aralığı aktif hücreye indirir", () => {
    const once = navigate(selectCell({ satir: 2, kolon: 1 }), key('ArrowDown', { shift: true }), SIZE)!;
    const sonra = navigate(once, key('ArrowRight', { shift: true }), SIZE)!;
    expect(sonra).toEqual({ capa: { satir: 2, kolon: 1 }, aktif: { satir: 3, kolon: 2 } });
    expect(selectionRange(sonra)).toEqual({ ust: 2, alt: 3, sol: 1, sag: 2 });
    expect(navigate(sonra, key('ArrowUp'), SIZE)).toEqual(selectCell({ satir: 2, kolon: 2 }));
  });

  it('aralık çapanın hangi yanında olursa olsun sol üstten sağ alta normalleşir', () => {
    expect(selectionRange({ capa: { satir: 5, kolon: 3 }, aktif: { satir: 1, kolon: 0 } })).toEqual({ ust: 1, alt: 5, sol: 0, sag: 3 });
  });

  it('Home/End satırın ilk/son kolonuna, Ctrl+Home/End ilk/son hücreye gider', () => {
    const sel = selectCell({ satir: 4, kolon: 2 });
    expect(navigate(sel, key('Home'), SIZE)).toEqual(selectCell({ satir: 4, kolon: 0 }));
    expect(navigate(sel, key('End'), SIZE)).toEqual(selectCell({ satir: 4, kolon: 3 }));
    expect(navigate(sel, key('Home', { ctrl: true }), SIZE)).toEqual(selectCell({ satir: 0, kolon: 0 }));
    expect(navigate(sel, key('End', { ctrl: true }), SIZE)).toEqual(selectCell({ satir: 9, kolon: 3 }));
    expect(navigate(sel, key('End', { ctrl: true, shift: true }), SIZE)).toEqual({ capa: { satir: 4, kolon: 2 }, aktif: { satir: 9, kolon: 3 } });
  });

  it('PageUp/PageDown görünen sayfa kadar satır atlar, uçta durur', () => {
    const sel = selectCell({ satir: 4, kolon: 2 });
    expect(navigate(sel, key('PageDown'), SIZE)).toEqual(selectCell({ satir: 7, kolon: 2 }));
    expect(navigate(sel, key('PageUp'), SIZE)).toEqual(selectCell({ satir: 1, kolon: 2 }));
    expect(navigate(selectCell({ satir: 8, kolon: 0 }), key('PageDown'), SIZE)).toEqual(selectCell({ satir: 9, kolon: 0 }));
  });

  it("Tab sağa, Shift+Tab sola gider ve satır sonunda sarar; son hücrede grid'den çıkmak için null döner", () => {
    expect(navigate(selectCell({ satir: 1, kolon: 3 }), key('Tab'), SIZE)).toEqual(selectCell({ satir: 2, kolon: 0 }));
    expect(navigate(selectCell({ satir: 1, kolon: 0 }), key('Tab', { shift: true }), SIZE)).toEqual(selectCell({ satir: 0, kolon: 3 }));
    // Shift+Tab aralığı genişletmez.
    expect(navigate({ capa: { satir: 0, kolon: 0 }, aktif: { satir: 2, kolon: 2 } }, key('Tab', { shift: true }), SIZE)).toEqual(
      selectCell({ satir: 2, kolon: 1 }),
    );
    expect(navigate(selectCell({ satir: 9, kolon: 3 }), key('Tab'), SIZE)).toBeNull();
    expect(navigate(selectCell({ satir: 0, kolon: 0 }), key('Tab', { shift: true }), SIZE)).toBeNull();
  });

  it('gezinme tuşu olmayan tuşlar ve boş grid null döner', () => {
    expect(navigate(selectCell({ satir: 0, kolon: 0 }), key('a'), SIZE)).toBeNull();
    expect(navigate(selectCell({ satir: 0, kolon: 0 }), key('ArrowDown'), { ...SIZE, satirlar: 0 })).toBeNull();
  });
});

describe('Seçili değerler', () => {
  const rows = [
    ['a', 'b', 'c'],
    ['d', null, 'f'],
    ['g', 'h', 'i'],
  ];

  it('aralığın hücrelerini satır satır döndürür', () => {
    expect(selectedValues(rows, { capa: { satir: 2, kolon: 2 }, aktif: { satir: 1, kolon: 1 } })).toEqual([
      [null, 'f'],
      ['h', 'i'],
    ]);
  });

  it('hücrenin seçili olup olmadığını söyler', () => {
    const sel = { capa: { satir: 0, kolon: 0 }, aktif: { satir: 1, kolon: 1 } };
    expect(isSelected(sel, { satir: 1, kolon: 0 })).toBe(true);
    expect(isSelected(sel, { satir: 2, kolon: 0 })).toBe(false);
  });
});
