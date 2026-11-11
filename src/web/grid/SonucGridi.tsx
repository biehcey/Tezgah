import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { NULL_LABEL, cellDisplay, initialColumnWidths, type TextWidth } from '../../core/grid/gosterim';
import { MIN_COLUMN_WIDTH, PAGE_ROWS } from '../../core/grid/sabitler';
import { extendTo, isSelected, navigate, selectCell, selectedValues, type Cell, type Selection } from '../../core/grid/secim';
import { toTsv } from '../../core/grid/tsv';
import { GridOlcumu, canvasTextWidth } from './olcum';

/** Sabit satır ve başlık yüksekliği (px); satırlar ölçülmez. CSS bunları `--grid-*` olarak alır. */
const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 26;
/** Canvas yoksa yazı genişliği: 12px sabit genişlikli yazının yaklaşık karakter genişliği. */
const CHAR_PX = 7.5;
const estimateWidth: TextWidth = (metin) => [...metin].length * CHAR_PX;
/** Sürüklerken imleç grid'in dışındayken her bu kadar ms'de bir satır kaydırılır. */
export const AUTO_SCROLL_MS = 40;
/** Tam değer kutusunun en az genişliği (px). */
const VALUE_BOX_MIN_WIDTH = 320;

interface Props {
  /** Grid'in erişilebilir adı. */
  etiket: string;
  kolonlar: readonly string[];
  /** Ham metin değerler; NULL `null`. */
  satirlar: readonly (readonly (string | null)[])[];
  /** Sonucun toplam satırı (yüklenenlerden fazla olabilir); bilinmiyorsa `null`. */
  toplamSatir: number | null;
  /**
   * Görünen aralık yüklü satırların sonuna yaklaştı; her çizimden sonra yeniden bildirilebilir,
   * çift isteği önlemek çağıranın işidir.
   */
  onSonaYaklasti?: () => void;
}

/** Sona bu kadar satır kala "daha fazla" bildirilir: sayfa, kaydırma bitmeden gelsin. */
const NEAR_END_ROWS = 100;

/**
 * Salt okunur sonuç grid'i: yalnızca satırlar sanallaştırılır, satır yüksekliği sabittir. Seçim,
 * gezinme, gösterim ve TSV `core/grid`'dedir; bileşen olayları oraya iletir ve sonucu çizer.
 * Odak roving tabindex ile aktif hücrededir; aktif satır görünümden çıksa da çizilmeye devam eder
 * ki odak kaybolmasın ve klavye gezinmesi sürsün.
 */
export function SonucGridi({ etiket, kolonlar, satirlar, toplamSatir, onSonaYaklasti }: Props) {
  const olcum = useContext(GridOlcumu);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstPage = satirlar.slice(0, PAGE_ROWS);
  // Ölçü verilmediyse (tarayıcı) genişlik, yazı tipi okunabilsin diye ilk çizimden hemen sonra ölçülür.
  const [measured, setWidths] = useState(() => (olcum.metinGenisligi ? initialColumnWidths(kolonlar, firstPage, olcum.metinGenisligi) : null));
  const widths = measured ?? kolonlar.map(() => MIN_COLUMN_WIDTH);
  const [sel, setSel] = useState<Selection>(() => selectCell({ satir: 0, kolon: 0 }));
  /** Tam değeri gösterilen hücre (F2 / çift tık). */
  const [valueCell, setValueCell] = useState<Cell | null>(null);
  /** Sonraki çizimden sonra aktif hücre odaklanmalı (klavye, tık, değer kutusunun kapanması). */
  const focusPending = useRef(false);
  const dragging = useRef(false);
  /** Sürüklerken imleç grid'in üstünde (-1) ya da altında (1); kaydırma zamanlayıcısı. */
  const autoScroll = useRef<{ yon: -1 | 1; zamanlayici: number } | null>(null);
  const resize = useRef<{ kolon: number; x: number; genislik: number } | null>(null);

  const virtualizer = useVirtualizer({
    count: satirlar.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    useFlushSync: false,
    // Aktif satır her zaman çizilir: odaktaki hücre kaydırmayla DOM'dan çıkmaz.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const active = sel.aktif.satir;
      if (active >= satirlar.length || indexes.includes(active)) return indexes;
      return [...indexes, active].sort((a, b) => a - b);
    },
    ...olcum.sanal,
  });
  /** Zamanlayıcı ve pencere dinleyicileri güncel seçimi buradan okur. */
  const latest = useRef({ sel, satirSayisi: satirlar.length, virtualizer });
  latest.current = { sel, satirSayisi: satirlar.length, virtualizer };
  const items = virtualizer.getVirtualItems();
  const offsets = useMemo(() => widths.reduce<number[]>((acc, w, i) => [...acc, acc[i]! + w], [0]), [widths]);

  useLayoutEffect(() => {
    if (!focusPending.current) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-hucre="${sel.aktif.satir}:${sel.aktif.kolon}"]`);
    if (!el) return;
    el.focus();
    focusPending.current = false;
  });

  // Görünen aralığın sonu (overscan ve hep çizilen aktif satır hariç).
  const visibleEnd = virtualizer.range?.endIndex;
  useEffect(() => {
    if (visibleEnd !== undefined && visibleEnd >= satirlar.length - NEAR_END_ROWS) onSonaYaklasti?.();
  });

  useLayoutEffect(() => {
    if (measured) return;
    const grid = scrollRef.current!;
    const header = grid.querySelector('.grid-kolon-basligi') ?? grid;
    const cell = grid.querySelector('.grid-hucresi') ?? grid;
    const olc = canvasTextWidth(getComputedStyle(cell), getComputedStyle(header)) ?? estimateWidth;
    setWidths(initialColumnWidths(kolonlar, firstPage, olc));
    // Yalnızca ilk çizimde: sonraki genişlikler kullanıcının sürüklemesidir.
  }, []);

  useEffect(() => {
    function stopAutoScroll() {
      if (autoScroll.current) window.clearInterval(autoScroll.current.zamanlayici);
      autoScroll.current = null;
    }
    // Sürükleme imleci grid'in dışına taşıyınca aktif satır her adımda bir satır ilerler ve görünür kalır.
    function step() {
      const { sel: s, satirSayisi, virtualizer: v } = latest.current;
      const satir = Math.min(Math.max(s.aktif.satir + (autoScroll.current?.yon ?? 0), 0), satirSayisi - 1);
      if (satir === s.aktif.satir) return;
      const next = extendTo(s, { satir, kolon: s.aktif.kolon });
      latest.current.sel = next;
      setSel(next);
      v.scrollToIndex(satir);
    }
    function onMove(e: globalThis.MouseEvent) {
      const rect = dragging.current ? scrollRef.current?.getBoundingClientRect() : undefined;
      const yon = !rect ? 0 : e.clientY < rect.top + HEADER_HEIGHT ? -1 : e.clientY > rect.bottom ? 1 : 0;
      if (yon === 0) return stopAutoScroll();
      if (autoScroll.current?.yon === yon) return;
      stopAutoScroll();
      autoScroll.current = { yon, zamanlayici: window.setInterval(step, AUTO_SCROLL_MS) };
    }
    function onUp() {
      dragging.current = false;
      stopAutoScroll();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      stopAutoScroll();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function moveTo(next: Selection) {
    setSel(next);
    focusPending.current = true;
    virtualizer.scrollToIndex(next.aktif.satir);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      // Pano izni reddedilirse kopyalanacak başka yol yok; grid durumu değişmez.
      navigator.clipboard?.writeText(toTsv(selectedValues(satirlar, sel))).catch(() => {});
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      setValueCell(sel.aktif);
      return;
    }
    const visible = (virtualizer.scrollRect?.height ?? 0) - HEADER_HEIGHT;
    const size = { satirlar: satirlar.length, kolonlar: kolonlar.length, sayfa: Math.max(1, Math.floor(visible / ROW_HEIGHT)) };
    const next = navigate(sel, { tus: e.key, shift: e.shiftKey, ctrl }, size);
    if (!next) return;
    e.preventDefault();
    moveTo(next);
  }

  function onCellMouseDown(e: MouseEvent, cell: Cell) {
    if (e.button !== 0) return;
    // Metin seçimi yerine hücre seçimi; odak çizimden sonra aktif hücreye verilir.
    e.preventDefault();
    setValueCell(null);
    setSel((s) => (e.shiftKey ? extendTo(s, cell) : selectCell(cell)));
    focusPending.current = true;
    dragging.current = true;
  }

  function onCellMouseEnter(cell: Cell) {
    if (dragging.current) setSel((s) => extendTo(s, cell));
  }

  function closeValue() {
    setValueCell(null);
    focusPending.current = true;
  }

  function onResizeStart(e: PointerEvent<HTMLElement>, kolon: number) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resize.current = { kolon, x: e.clientX, genislik: widths[kolon]! };
  }

  function onResizeMove(e: PointerEvent<HTMLElement>) {
    const r = resize.current;
    if (!r) return;
    const genislik = Math.max(MIN_COLUMN_WIDTH, r.genislik + e.clientX - r.x);
    setWidths(widths.map((w, i) => (i === r.kolon ? genislik : w)));
  }

  const value = valueCell ? (satirlar[valueCell.satir]?.[valueCell.kolon] ?? null) : null;

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={etiket}
      aria-rowcount={toplamSatir === null ? -1 : toplamSatir + 1}
      aria-colcount={kolonlar.length}
      aria-multiselectable="true"
      aria-readonly="true"
      className="sonuc-gridi"
      style={{ '--grid-satir': `${ROW_HEIGHT}px`, '--grid-baslik': `${HEADER_HEIGHT}px` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <div className="grid-icerik" style={{ height: virtualizer.getTotalSize(), width: offsets.at(-1) }}>
        <div role="rowgroup" className="grid-basligi">
          <div role="row" aria-rowindex={1} className="grid-satiri">
            {kolonlar.map((ad, c) => (
              <div key={c} role="columnheader" aria-colindex={c + 1} className="grid-kolon-basligi" style={{ width: widths[c] }} title={ad}>
                <span className="grid-kolon-adi">{ad}</span>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${ad} genişliği`}
                  className="grid-kolon-tutamaci"
                  onPointerDown={(e) => onResizeStart(e, c)}
                  onPointerMove={onResizeMove}
                  onPointerUp={() => (resize.current = null)}
                  onPointerCancel={() => (resize.current = null)}
                />
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {items.map((item) => {
            const r = item.index;
            const row = satirlar[r]!;
            return (
              <div key={r} role="row" aria-rowindex={r + 2} className="grid-satiri grid-veri-satiri" style={{ transform: `translateY(${item.start}px)` }}>
                {kolonlar.map((_, c) => {
                  const cell = { satir: r, kolon: c };
                  const shown = cellDisplay(row[c] ?? null);
                  const selected = isSelected(sel, cell);
                  const active = sel.aktif.satir === r && sel.aktif.kolon === c;
                  return (
                    <div
                      key={c}
                      role="gridcell"
                      aria-colindex={c + 1}
                      aria-selected={selected}
                      tabIndex={active ? 0 : -1}
                      data-hucre={`${r}:${c}`}
                      className={`grid-hucresi${shown.null ? ' null' : ''}${selected ? ' secili' : ''}${active ? ' aktif' : ''}`}
                      style={{ width: widths[c] }}
                      onMouseDown={(e) => onCellMouseDown(e, cell)}
                      onMouseEnter={() => onCellMouseEnter(cell)}
                      onDoubleClick={() => setValueCell(cell)}
                    >
                      {shown.null ? NULL_LABEL : shown.metin}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {valueCell && (
          <textarea
            className="hucre-degeri"
            readOnly
            autoFocus
            aria-label={`${kolonlar[valueCell.kolon]} değeri`}
            value={value ?? ''}
            placeholder={value === null ? NULL_LABEL : undefined}
            style={{
              top: HEADER_HEIGHT + valueCell.satir * ROW_HEIGHT,
              left: offsets[valueCell.kolon],
              width: Math.max(widths[valueCell.kolon]!, VALUE_BOX_MIN_WIDTH),
            }}
            onKeyDown={(e) => {
              // Kutudaki tuşlar (oklar, Ctrl+C) grid'de gezinmez.
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                closeValue();
              }
            }}
            onBlur={() => setValueCell(null)}
          />
        )}
      </div>
    </div>
  );
}
