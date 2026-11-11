import { describe, expect, it } from 'vitest';
import { cellDisplay, initialColumnWidths } from './gosterim';

describe('Hücre gösterimi', () => {
  it('NULL boş metinden ayrı bir durumdur', () => {
    expect(cellDisplay(null)).toEqual({ null: true });
    expect(cellDisplay('')).toEqual({ null: false, metin: '' });
  });

  it('satır sonları ↵ ile tek satıra iner', () => {
    expect(cellDisplay('a\nb\r\nc\rd')).toEqual({ null: false, metin: 'a↵b↵c↵d' });
  });

  it('yalnızca ilk 1000 karakter basılır, kesildiği … ile belli olur', () => {
    const shown = cellDisplay('x'.repeat(1500));
    expect(shown).toEqual({ null: false, metin: `${'x'.repeat(1000)}…` });
    expect(cellDisplay('y'.repeat(1000))).toEqual({ null: false, metin: 'y'.repeat(1000) });
  });

  it('kesim bir vekil çiftin ortasına denk gelirse yarım karakter basılmaz', () => {
    const value = `${'x'.repeat(999)}😀`;
    expect(cellDisplay(`${value}z`)).toEqual({ null: false, metin: `${'x'.repeat(999)}…` });
  });
});

describe('İlk kolon genişlikleri', () => {
  const PX = 8;
  /** Sabit genişlikli yazı: her karakter 8 px; başlık kalın, karakter başına 9 px. */
  const olc = (metin: string, baslik: boolean) => [...metin].length * (baslik ? 9 : PX);

  it('başlık ve ilk sayfanın en geniş gösterimi kadar, iç boşlukla; en az ve en fazla sınırlı', () => {
    const widths = initialColumnWidths(
      ['id', 'aciklama', 'uzun'],
      [
        ['1', 'kısa', 'u'.repeat(200)],
        ['12345678901', null, 'a\nb'],
      ],
      olc,
    );
    // id: 11 karakter; aciklama: başlık (8 × 9); NULL hücre "NULL" ölçülür; uzun: 400 px sınırı.
    expect(widths).toEqual([11 * PX + 16, 8 * 9 + 16, 400]);
  });

  it('genişlik karakter sayısından değil ölçümden gelir: geniş karakterli kısa değer daha geniş', () => {
    const genis = (metin: string) => [...metin].reduce((w, ch) => w + (ch.codePointAt(0)! > 0x2e80 ? 2 * PX : PX), 0);
    expect(initialColumnWidths(['k'], [['漢字漢字漢字'], ['abcdefghi']], genis)).toEqual([12 * PX + 16]);
  });

  it('kısa kolon da en az 48 px', () => {
    expect(initialColumnWidths(['a'], [['1']], olc)).toEqual([48]);
  });
});
