import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM_OLCUMU } from '../test/grid';
import { GridOlcumu } from './olcum';
import { AUTO_SCROLL_MS, SonucGridi } from './SonucGridi';

const KOLONLAR = ['id', 'ad', 'not'];

function rows(n: number): (string | null)[][] {
  return Array.from({ length: n }, (_, i) => [String(i + 1), `ad ${i + 1}`, i % 2 === 0 ? null : '']);
}

function setup({ satirlar = rows(5), toplam, tipler }: { satirlar?: (string | null)[][]; toplam?: number | null; tipler?: number[] } = {}) {
  const user = userEvent.setup();
  render(
    <GridOlcumu.Provider value={JSDOM_OLCUMU}>
      <SonucGridi etiket="Sonuç 1" kolonlar={KOLONLAR} tipler={tipler} satirlar={satirlar} toplamSatir={toplam === undefined ? satirlar.length : toplam} />
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

  it('PageDown/PageUp görünen satır sayısı kadar taşır', async () => {
    const { user } = setup({ satirlar: rows(500) });
    await user.click(cell(0, 1));
    // 400 px yüksekliğin 26 px'i başlık: 374 / 24 = 15 tam satır.
    await user.keyboard('{PageDown}');
    expect(cell(15, 1)).toHaveFocus();
    await user.keyboard('{PageDown}{PageUp}{PageUp}');
    expect(cell(0, 1)).toHaveFocus();
  });

  it('sürüklerken imleç grid’in altına ya da başlığın üstüne çıkınca kaydırıp seçimi genişletir', () => {
    vi.useFakeTimers();
    try {
      setup({ satirlar: rows(500) });
      vi.spyOn(grid(), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 100, width: 1000, height: 400 }));
      fireEvent.mouseDown(cell(0, 1), { button: 0 });
      fireEvent.mouseMove(window, { clientY: 520 });
      act(() => vi.advanceTimersByTime(AUTO_SCROLL_MS * 20));
      expect(cell(20, 1)).toHaveAttribute('aria-selected', 'true');
      expect(cell(20, 1)).toHaveClass('aktif');
      expect(cell(0, 1)).toHaveAttribute('aria-selected', 'true');

      // Başlığın üstü yukarı kaydırır.
      fireEvent.mouseMove(window, { clientY: 110 });
      act(() => vi.advanceTimersByTime(AUTO_SCROLL_MS * 5));
      expect(cell(15, 1)).toHaveClass('aktif');

      // İmleç grid'e dönünce ya da bırakınca kaydırma durur.
      fireEvent.mouseMove(window, { clientY: 300 });
      act(() => vi.advanceTimersByTime(AUTO_SCROLL_MS * 5));
      expect(cell(15, 1)).toHaveClass('aktif');
      fireEvent.mouseMove(window, { clientY: 520 });
      fireEvent.mouseUp(window);
      act(() => vi.advanceTimersByTime(AUTO_SCROLL_MS * 5));
      expect(cell(15, 1)).toHaveClass('aktif');
    } finally {
      vi.useRealTimers();
    }
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

describe('Sonuç grid’i: INSERT olarak kopyala', () => {
  const INT4 = 23;
  const TEXT = 25;

  it('sağ tık menüsü seçili satırları tüm kolonlarıyla yer tutucu tabloya INSERT olarak kopyalar', async () => {
    const { user } = setup({ satirlar: [['1', "O'Brien", null], ['2', 'b', 'x'], ['3', 'c', 'y']], tipler: [INT4, TEXT, 99999] });
    await user.click(cell(0, 1));
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    fireEvent.contextMenu(cell(1, 1));
    await user.click(screen.getByRole('menuitem', { name: 'INSERT olarak kopyala' }));
    expect(await navigator.clipboard.readText()).toBe(
      [
        `INSERT INTO "tablo" ("id", "ad", "not") VALUES ('1'::integer, 'O''Brien'::text, NULL);`,
        `INSERT INTO "tablo" ("id", "ad", "not") VALUES ('2'::integer, 'b'::text, 'x');`,
      ].join('\n'),
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(cell(1, 1)).toHaveFocus();
  });

  it('seçimin dışındaki hücreye sağ tık önce o hücreyi seçer', async () => {
    const { user } = setup({ satirlar: [['1', 'a', 'p'], ['2', 'b', 'q']] });
    await user.click(cell(0, 0));
    fireEvent.contextMenu(cell(1, 2));
    expect(cell(1, 2)).toHaveClass('aktif');
    expect(cell(0, 0)).not.toHaveClass('secili');
    await user.click(screen.getByRole('menuitem', { name: 'INSERT olarak kopyala' }));
    expect(await navigator.clipboard.readText()).toBe(`INSERT INTO "tablo" ("id", "ad", "not") VALUES ('2', 'b', 'q');`);
  });

  it('fareyle açılan menü imlecin yanında, klavyeyle (menü tuşu) açılan hücrenin altında', () => {
    setup();
    fireEvent.mouseDown(cell(0, 1), { button: 2 });
    fireEvent.contextMenu(cell(0, 1), { clientX: 120, clientY: 80 });
    expect(screen.getByRole('menu')).toHaveStyle({ left: '120px', top: '80px' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // Klavyeden: önünde sağ mousedown yok; tarayıcının verdiği koordinat yok sayılır.
    vi.spyOn(cell(0, 1), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 30, y: 50, width: 100, height: 24 }));
    fireEvent.contextMenu(cell(0, 1), { clientX: 5, clientY: 5 });
    expect(screen.getByRole('menu')).toHaveStyle({ left: '30px', top: '74px' });
  });

  it('Escape menüyü kapatır, odak hücreye döner', async () => {
    const { user } = setup();
    await user.click(cell(0, 0));
    fireEvent.contextMenu(cell(0, 0));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(cell(0, 0)).toHaveFocus();
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

  it('ilk kolon genişliği başlığın ve hücrelerin ölçülen yazı genişliğinden gelir', () => {
    const olc = (metin: string, baslik: boolean) => (baslik && metin === 'ad' ? 300 : 10);
    render(
      <GridOlcumu.Provider value={{ ...JSDOM_OLCUMU, metinGenisligi: olc }}>
        <SonucGridi etiket="Sonuç 1" kolonlar={KOLONLAR} satirlar={rows(3)} toplamSatir={3} />
      </GridOlcumu.Provider>,
    );
    const headers = within(grid()).getAllByRole('columnheader');
    expect(headers[1]).toHaveStyle({ width: '316px' });
    expect(headers[0]).toHaveStyle({ width: '48px' });
    expect(cell(0, 1)).toHaveStyle({ width: '316px' });
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

describe('Sonuç grid’i: düzenleyici', () => {
  function editable(satirlar = rows(3)) {
    const user = userEvent.setup();
    const onDuzenle = vi.fn();
    render(
      <GridOlcumu.Provider value={JSDOM_OLCUMU}>
        <SonucGridi etiket="Sonuç 1" kolonlar={KOLONLAR} satirlar={satirlar} toplamSatir={satirlar.length} onDuzenle={onDuzenle} />
      </GridOlcumu.Provider>,
    );
    return { user, onDuzenle };
  }
  const editor = () => screen.getByRole('textbox', { name: /değeri$/ });

  it('yazmaya başlamak düzenleyiciyi o harfle açar; Enter kaydeder ve aşağı iner', async () => {
    const { user, onDuzenle } = editable();
    await user.click(cell(0, 1));
    await user.keyboard('Veli');
    expect(editor()).toHaveValue('Veli');
    expect(editor()).not.toHaveAttribute('readonly');
    await user.keyboard('{Enter}');
    expect(onDuzenle).toHaveBeenCalledWith(0, 1, 'Veli');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(cell(1, 1)).toHaveFocus();
  });

  it('F2 değeri açar; Shift+Enter yeni satır ekler; Esc vazgeçer', async () => {
    const { user, onDuzenle } = editable();
    await user.click(cell(0, 1));
    await user.keyboard('{F2}');
    expect(editor()).toHaveValue('ad 1');
    await user.keyboard('{Shift>}{Enter}{/Shift}x');
    expect(editor()).toHaveValue('ad 1\nx');
    await user.keyboard('{Escape}');
    expect(onDuzenle).not.toHaveBeenCalled();
    expect(cell(0, 1)).toHaveFocus();
  });

  it('çift tık açar; Tab kaydedip sağa, Shift+Tab kaydedip sola geçer', async () => {
    const { user, onDuzenle } = editable();
    await user.dblClick(cell(1, 1));
    await user.keyboard('2{Tab}');
    expect(onDuzenle).toHaveBeenLastCalledWith(1, 1, 'ad 22');
    expect(cell(1, 2)).toHaveFocus();
    await user.keyboard('{F2}z{Shift>}{Tab}{/Shift}');
    expect(onDuzenle).toHaveBeenLastCalledWith(1, 2, 'z');
    expect(cell(1, 1)).toHaveFocus();
  });

  it('dokunmadan kapatılan NULL hücre boş metne dönmez', async () => {
    const { user, onDuzenle } = editable();
    await user.click(cell(0, 2));
    await user.keyboard('{F2}{Enter}');
    expect(onDuzenle).not.toHaveBeenCalled();
  });

  it('düzenleme kapalıyken yazmak düzenleyici açmaz; F2 salt okunur açar ve nedenini söyler', async () => {
    const { user } = setup();
    await user.click(cell(0, 1));
    await user.keyboard('x');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.keyboard('{F2}');
    expect(editor()).toHaveAttribute('readonly');
    expect(screen.getByRole('note')).toHaveTextContent('Konsol sonuçları salt okunur');
    expect(editor()).toHaveAccessibleDescription(expect.stringContaining('salt okunur'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
