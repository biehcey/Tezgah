import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { JSDOM_OLCUMU } from '../test/grid';
import { GridOlcumu } from './olcum';
import { SonucGridi } from './SonucGridi';

const KOLONLAR = ['id', 'ad', 'not'];

function rows(n: number): (string | null)[][] {
  return Array.from({ length: n }, (_, i) => [String(i + 1), `ad ${i + 1}`, i % 2 === 0 ? null : '']);
}

function setup({ satirlar = rows(5), toplam }: { satirlar?: (string | null)[][]; toplam?: number | null } = {}) {
  const user = userEvent.setup();
  render(
    <GridOlcumu.Provider value={JSDOM_OLCUMU}>
      <SonucGridi etiket="Sonuç 1" kolonlar={KOLONLAR} satirlar={satirlar} toplamSatir={toplam === undefined ? satirlar.length : toplam} />
    </GridOlcumu.Provider>,
  );
  return { user };
}

const grid = () => screen.getByRole('grid', { name: 'Sonuç 1' });
/** Veri satırı `r` (0 tabanlı) ve kolon `c` hücresi; `aria-rowindex` başlıkla 1'den başlar. */
const cell = (r: number, c: number) => {
  const row = grid().querySelector(`[role="row"][aria-rowindex="${r + 2}"]`) as HTMLElement;
  return within(row).getAllByRole('gridcell')[c]!;
};
const selectedTexts = () =>
  within(grid())
    .getAllByRole('gridcell')
    .filter((c) => c.getAttribute('aria-selected') === 'true')
    .map((c) => c.textContent);

describe('Sonuç grid’i: çizim', () => {
  it('başlıklar ve satırlar ham metinle çizilir; NULL boş metinden ayrışır', () => {
    setup();
    expect(within(grid()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(KOLONLAR);
    expect(cell(0, 1)).toHaveTextContent('ad 1');
    expect(cell(0, 2)).toHaveTextContent('NULL');
    expect(cell(0, 2)).toHaveClass('null');
    expect(cell(1, 2)).toHaveTextContent(/^$/);
    expect(cell(1, 2)).not.toHaveClass('null');
  });

  it('çok satırlı değer tek satırda ↵ ile gösterilir', () => {
    setup({ satirlar: [['1', 'a\nb', null]] });
    expect(cell(0, 1)).toHaveTextContent('a↵b');
  });

  it('büyük sonuçta yalnızca görünen satırlar DOM’da', () => {
    setup({ satirlar: rows(500) });
    const rendered = within(grid()).getAllByRole('row').length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(100);
  });

  it('erişilebilirlik: toplam bilinmezken aria-rowcount -1; satır ve kolon indeksleri', () => {
    setup({ toplam: null });
    expect(grid()).toHaveAttribute('aria-rowcount', '-1');
    expect(grid()).toHaveAttribute('aria-colcount', '3');
    expect(cell(2, 1)).toHaveAttribute('aria-colindex', '2');
  });

  it('toplam biliniyorsa aria-rowcount yüklenenlerden fazla olsa da başlık dahil toplam satırdır', () => {
    setup({ satirlar: rows(5), toplam: 750 });
    expect(grid()).toHaveAttribute('aria-rowcount', '751');
  });
});

describe('Sonuç grid’i: gezinme ve seçim', () => {
  it('roving tabindex: grid’e Tab ile girilince ilk hücre odaklanır, yalnızca aktif hücre sekme sırasında', async () => {
    const { user } = setup();
    await user.tab();
    expect(cell(0, 0)).toHaveFocus();
    expect(cell(0, 0)).toHaveAttribute('tabindex', '0');
    expect(cell(0, 1)).toHaveAttribute('tabindex', '-1');
  });

  it('oklar, Home/End ve Ctrl+End aktif hücreyi taşır', async () => {
    const { user } = setup();
    await user.click(cell(0, 0));
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(cell(1, 1)).toHaveFocus();
    expect(cell(1, 1)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(cell(1, 2)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(cell(1, 0)).toHaveFocus();
    await user.keyboard('{Control>}{End}{/Control}');
    expect(cell(4, 2)).toHaveFocus();
  });

  it('Shift+ok aralık seçer; Shift+tık çapadan aralığı genişletir', async () => {
    const { user } = setup();
    await user.click(cell(0, 0));
    await user.keyboard('{Shift>}{ArrowDown}{ArrowRight}{/Shift}');
    expect(selectedTexts()).toEqual(['1', 'ad 1', '2', 'ad 2']);
    await user.click(cell(2, 1));
    await user.keyboard('{Shift>}');
    await user.click(cell(3, 2));
    await user.keyboard('{/Shift}');
    expect(selectedTexts()).toEqual(['ad 3', 'NULL', 'ad 4', '']);
  });

  it('fareyle sürükleyince aralık seçilir', async () => {
    const { user } = setup();
    await user.pointer([{ keys: '[MouseLeft>]', target: cell(0, 1) }, { target: cell(1, 2) }, { keys: '[/MouseLeft]' }]);
    expect(selectedTexts()).toEqual(['ad 1', 'NULL', 'ad 2', '']);
  });

  it('aktif hücre kaydırmayla görünümden çıksa da DOM’da kalır; odak ve klavye gezinmesi sürer', async () => {
    const { user } = setup({ satirlar: rows(500) });
    await user.click(cell(0, 0));
    const scroller = grid();
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 300 * 24 });
    fireEvent.scroll(scroller);
    expect(grid().querySelector('[aria-rowindex="302"]')).not.toBeNull();
    expect(cell(0, 0)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(cell(1, 0)).toHaveFocus();
  });

  it('Ctrl+C seçili aralığı başlıksız TSV olarak kopyalar; NULL boş', async () => {
    const { user } = setup({ satirlar: [['1', 'a\tb', null], ['2', 'say "hi"', 'x']] });
    await user.click(cell(0, 0));
    await user.keyboard('{Shift>}{ArrowDown}{End}{/Shift}');
    await user.keyboard('{Control>}c{/Control}');
    expect(await navigator.clipboard.readText()).toBe('1\t"a\tb"\t\n2\t"say ""hi"""\tx');
  });

  it('Cmd+C de kopyalar', async () => {
    const { user } = setup();
    await user.click(cell(1, 1));
    await user.keyboard('{Meta>}c{/Meta}');
    expect(await navigator.clipboard.readText()).toBe('ad 2');
  });
});

describe('Sonuç grid’i: tam değer ve kolon genişliği', () => {
  it('F2 tam değeri salt okunur textarea’da açar; Esc kapatıp hücreye döner', async () => {
    const uzun = `${'x'.repeat(1200)}\nson`;
    const { user } = setup({ satirlar: [['1', uzun, null]] });
    await user.click(cell(0, 1));
    await user.keyboard('{F2}');
    const editor = screen.getByRole('textbox', { name: 'ad değeri' });
    expect(editor).toHaveValue(uzun);
    expect(editor).toHaveAttribute('readonly');
    expect(editor).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(cell(0, 1)).toHaveFocus();
  });

  it('çift tık tam değeri açar; NULL boş metinden ayrı söylenir', async () => {
    const { user } = setup();
    await user.dblClick(cell(0, 2));
    const editor = screen.getByRole('textbox', { name: 'not değeri' });
    expect(editor).toHaveValue('');
    expect(editor).toHaveAttribute('placeholder', 'NULL');
  });

  it('kolon genişliği başlıktaki tutamaçtan sürüklenerek değişir', () => {
    setup();
    const header = within(grid()).getAllByRole('columnheader')[1]!;
    const before = parseFloat(header.style.width);
    const handle = within(header).getByRole('separator');
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 });
    expect(parseFloat(header.style.width)).toBe(before + 60);
    expect(parseFloat(cell(0, 1).style.width)).toBe(before + 60);
  });
});
