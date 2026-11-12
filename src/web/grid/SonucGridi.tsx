import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { NULL_LABEL, cellDisplay, initialColumnWidths, type TextWidth } from '../../core/grid/gosterim';
import { isDefaultCell, type GridRow } from '../../core/grid/bekleyen';
import { MIN_COLUMN_WIDTH, PAGE_ROWS } from '../../core/grid/sabitler';
import { PLACEHOLDER_TABLE, insertStatements } from '../../core/grid/insert';
import type { ColumnSort } from '../../core/tablo-sayfasi';
import { extendTo, isSelected, navigate, selectCell, selectedValues, selectionRange, type Cell, type Selection } from '../../core/grid/secim';
import { toTsv } from '../../core/grid/tsv';
import { Menu, menuBelow, type MenuItem, type MenuPosition } from '../ortak/Menu';
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
/** Salt okunur tam değer kutusunun yüksekliği (px); CSS `.hucre-degeri` ile aynı. */
const VALUE_BOX_HEIGHT = 144;

interface Props {
  /** Grid'in erişilebilir adı. */
  etiket: string;
  kolonlar: readonly string[];
  /** Kolon tip OID'leri; "INSERT olarak kopyala" literal'lere `::tip` ekini bunlardan yazar. */
  tipler?: readonly number[];
  /** Hedefin Katalog önbelleğindeki OID → tip adı; yerleşik olmayan tipler bununla çözülür. */
  tipAdlari?: ReadonlyMap<number, string>;
  /** Ham metin değerler; NULL `null`. */
  satirlar: readonly (readonly (string | null)[])[];
  /** Sonucun toplam satırı (yüklenenlerden fazla olabilir); bilinmiyorsa `null`. */
  toplamSatir: number | null;
  /**
   * Görünen aralık yüklü satırların sonuna yaklaştı; her çizimden sonra yeniden bildirilebilir,
   * çift isteği önlemek çağıranın işidir.
   */
  onSonaYaklasti?: () => void;
  /** Verilirse kolon adı tıklanabilir (Tablo sekmesi: `ORDER BY`'ı doldurur). */
  onKolonTikla?: (kolon: number) => void;
  /** Başlıktan konan sıralama; `aria-sort` ve ok olarak görünür. */
  siralama?: { kolon: number; yon: ColumnSort } | null;
  /**
   * Verilirse hücreler düzenlenir (Tablo sekmesi): düzenleyici kapanırken kaydedilen ham metin ya
   * da NULL (Ctrl/Cmd+Shift+N, sağ tık). Yoksa tam değer salt okunur açılır ve `saltOkunurNedeni`
   * söylenir.
   */
  onDuzenle?: (satir: number, kolon: number, deger: string | null) => void;
  saltOkunurNedeni?: string;
  /** Düzenlenebilir grid'de yazılamayan kolonun nedeni (`bytea`, generated); yazılabiliyorsa `null`. */
  kolonSaltOkunur?: (kolon: number) => string | null;
  /** Bekleyen değişikliğin satır işaretleri: eklendi / silinecek ve değişen (eklenende dokunulan) kolonlar. */
  satirIsareti?: (satir: number) => Pick<GridRow, 'durum' | 'degisen'> | undefined;
  /** Uygulanırken hata alan satırlar. */
  hataliSatirlar?: ReadonlySet<number>;
  /** Satır ekleme ve silme (sağ tık); verilmezse menüde yoklar. */
  onSatirEkle?: () => void;
  onSatirSil?: (satirlar: number[]) => void;
  onSilmeyiGeriAl?: (satirlar: number[]) => void;
  /** Çok hücreli yapıştırma: seçimin sol üst köşesi ve panodaki düz metin. */
  onYapistir?: (baslangic: Cell, metin: string) => void;
  /** Her artışında seçim son satırın ilk hücresine gider (eklenen satır). */
  sonSatiraGit?: number;
}

const DELETED_REASON = 'Silinecek satır düzenlenemez; önce silmeyi geri alın.';
const DEFAULT_LABEL = 'DEFAULT';
const DURUM_ETIKETI = { eklendi: 'eklendi', silinecek: 'silinecek' } as const;

const READ_ONLY_REASON = 'Konsol sonuçları salt okunur; düzenleme PK’lı tablonun Tablo sekmesinde.';

/** Açık değer kutusu: düzenleyici ya da salt okunur tam değer. */
interface ValueBox {
  cell: Cell;
  metin: string;
  /** Boşken gösterilen: değer NULL ya da (eklenen satırda) DEFAULT ve henüz dokunulmadı. */
  yerTutucu?: string;
  duzenle: boolean;
  /** Salt okunur açıldıysa nedeni. */
  neden?: string;
  /** Kullanıcı metne dokundu (yazmaya başlayarak açmak da sayılır); dokunulmayan kutu kaydedilmez. */
  kirli: boolean;
}

/** Düzenleyicinin en fazla satır yüksekliği; sonrası kaydırılır. */
const EDITOR_MAX_LINES = 10;

const SORT_ARIA = { artan: 'ascending', azalan: 'descending' } as const;
const SORT_ARROW = { artan: ' ▲', azalan: ' ▼' } as const;

/** Sona bu kadar satır kala "daha fazla" bildirilir: sayfa, kaydırma bitmeden gelsin. */
const NEAR_END_ROWS = 100;

/**
 * Sonuç grid'i: yalnızca satırlar sanallaştırılır, satır yüksekliği sabittir. Konsol sonuçlarında
 * salt okunurdur; `onDuzenle` verilince (Tablo sekmesi) hücrenin üstünde büyüyen bir `<textarea>`
 * düzenleyici açılır: F2, çift tık ya da yazmaya başlama; Enter kaydet + aşağı, Shift+Enter yeni
 * satır, Esc vazgeç, Tab/Shift+Tab kaydet + yana. Tüm tipler ham metindir. Seçim,
 * gezinme, gösterim ve TSV `core/grid`'dedir; bileşen olayları oraya iletir ve sonucu çizer.
 * Odak roving tabindex ile aktif hücrededir; aktif satır görünümden çıksa da çizilmeye devam eder
 * ki odak kaybolmasın ve klavye gezinmesi sürsün.
 */
export function SonucGridi({
  etiket,
  kolonlar,
  tipler,
  tipAdlari,
  satirlar,
  toplamSatir,
  onSonaYaklasti,
  onKolonTikla,
  siralama = null,
  onDuzenle,
  saltOkunurNedeni = READ_ONLY_REASON,
  kolonSaltOkunur,
  satirIsareti,
  hataliSatirlar,
  onSatirEkle,
  onSatirSil,
  onSilmeyiGeriAl,
  onYapistir,
  sonSatiraGit,
}: Props) {
  const olcum = useContext(GridOlcumu);
  const noteId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstPage = satirlar.slice(0, PAGE_ROWS);
  // Ölçü verilmediyse (tarayıcı) genişlik, yazı tipi okunabilsin diye ilk çizimden hemen sonra ölçülür.
  const [measured, setWidths] = useState(() => (olcum.metinGenisligi ? initialColumnWidths(kolonlar, firstPage, olcum.metinGenisligi) : null));
  const widths = measured ?? kolonlar.map(() => MIN_COLUMN_WIDTH);
  const [sel, setSel] = useState<Selection>(() => selectCell({ satir: 0, kolon: 0 }));
  /** F2 / çift tık / yazmaya başlama ile açılan değer kutusu. */
  const [box, setBox] = useState<ValueBox | null>(null);
  /** Kutu kapanırken (kaydet ya da vazgeç) gelen blur ikinci kez kaydetmesin. */
  const boxOpen = useRef(false);
  /** Açık sağ tık menüsü ve açıldığı andaki seçim. */
  const [menu, setMenu] = useState<(MenuPosition & { sel: Selection; key: number }) | null>(null);
  /** Son `contextmenu` sağ fare tuşundan mı geldi (yoksa menü tuşu / Shift+F10). */
  const rightPressed = useRef(false);
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

  // Satır eklenince seçim yeni (son) satıra gider; ilk çizimde değil.
  const lastGoTo = useRef(sonSatiraGit);
  useEffect(() => {
    if (sonSatiraGit === lastGoTo.current) return;
    lastGoTo.current = sonSatiraGit;
    if (satirlar.length > 0) moveTo(selectCell({ satir: satirlar.length - 1, kolon: 0 }));
  });

  /** Hücre neden yazılamıyor; yazılabiliyorsa `null`. */
  function cellReadOnlyReason({ satir, kolon }: Cell): string | null {
    if (!onDuzenle) return saltOkunurNedeni;
    if (satirIsareti?.(satir)?.durum === 'silinecek') return DELETED_REASON;
    return kolonSaltOkunur?.(kolon) ?? null;
  }

  /** Seçili, yazılabilir hücreleri NULL yapar. */
  function setNull(s: Selection) {
    const r = selectionRange(s);
    for (let satir = r.ust; satir <= r.alt; satir++)
      for (let kolon = r.sol; kolon <= r.sag; kolon++) if (cellReadOnlyReason({ satir, kolon }) === null) onDuzenle?.(satir, kolon, null);
  }

  /** Aralığın satırları. */
  const selectedRows = (s: Selection) => {
    const r = selectionRange(s);
    return Array.from({ length: r.alt - r.ust + 1 }, (_, i) => r.ust + i).filter((i) => i < satirlar.length);
  };

  const isNullKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n';

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (isNullKey(e)) {
      e.preventDefault();
      if (onDuzenle && satirlar.length > 0) setNull(sel);
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copyText(toTsv(selectedValues(satirlar, sel)));
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      openBox(sel.aktif);
      return;
    }
    // Seçili hücrede yazmaya başlamak düzenleyiciyi açar ve değeri o harfle değiştirir;
    // hücre yazılamıyorsa tam değer nedeniyle salt okunur açılır.
    if (onDuzenle && e.key.length === 1 && !ctrl && !e.altKey && satirlar.length > 0) {
      e.preventDefault();
      openBox(sel.aktif, cellReadOnlyReason(sel.aktif) === null ? e.key : undefined);
      return;
    }
    const next = navigate(sel, { tus: e.key, shift: e.shiftKey, ctrl }, gridSize());
    if (!next) return;
    e.preventDefault();
    moveTo(next);
  }

  function gridSize() {
    const visible = (virtualizer.scrollRect?.height ?? 0) - HEADER_HEIGHT;
    return { satirlar: satirlar.length, kolonlar: kolonlar.length, sayfa: Math.max(1, Math.floor(visible / ROW_HEIGHT)) };
  }

  /** Değer kutusu: düzenlenebilir grid'de düzenleyici, değilse salt okunur tam değer. `yazilan`: yazmaya başlayarak açıldı. */
  function openBox(cell: Cell, yazilan?: string) {
    const value = satirlar[cell.satir]?.[cell.kolon] ?? null;
    boxOpen.current = true;
    if (yazilan !== undefined) {
      setBox({ cell, metin: yazilan, duzenle: true, kirli: true });
      return;
    }
    const neden = cellReadOnlyReason(cell);
    const yerTutucu = isDefaultCell(satirIsareti?.(cell.satir), cell.kolon) ? DEFAULT_LABEL : value === null ? NULL_LABEL : undefined;
    setBox({ cell, metin: value ?? '', yerTutucu, duzenle: neden === null, ...(neden !== null && { neden }), kirli: false });
  }

  /** Kutuyu kapatır; `save`: dokunulan düzenleme kaydedilir. `move`: ardından seçimin gideceği tuş. */
  function closeBox(save: boolean, move?: { tus: string; shift: boolean } | 'odaksiz') {
    if (!box || !boxOpen.current) return;
    boxOpen.current = false;
    setBox(null);
    if (save && box.duzenle && box.kirli) onDuzenle?.(box.cell.satir, box.cell.kolon, box.metin);
    // Odak grid dışına gittiyse (blur) geri çekilmez.
    if (move === 'odaksiz') return;
    const next = move && navigate(selectCell(box.cell), { ...move, ctrl: false }, gridSize());
    if (next) moveTo(next);
    else focusPending.current = true;
  }

  function onBoxKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Kutudaki tuşlar (oklar, Ctrl+C) grid'de gezinmez.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBox(false);
      return;
    }
    if (!box?.duzenle) return;
    if (isNullKey(e)) {
      e.preventDefault();
      boxOpen.current = false;
      setBox(null);
      onDuzenle?.(box.cell.satir, box.cell.kolon, null);
      focusPending.current = true;
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      closeBox(true, { tus: 'ArrowDown', shift: false });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      closeBox(true, { tus: 'Tab', shift: e.shiftKey });
    }
  }

  function onCellMouseDown(e: MouseEvent, cell: Cell) {
    rightPressed.current = e.button === 2;
    if (e.button !== 0) return;
    // Metin seçimi yerine hücre seçimi; odak çizimden sonra aktif hücreye verilir.
    e.preventDefault();
    // Açık düzenleme kaydedilir (blur gelmeden önce; odak hücreye gidecek).
    closeBox(true);
    setSel((s) => (e.shiftKey ? extendTo(s, cell) : selectCell(cell)));
    focusPending.current = true;
    dragging.current = true;
  }

  function onCellMouseEnter(cell: Cell) {
    if (dragging.current) setSel((s) => extendTo(s, cell));
  }

  /** Sağ tık seçimin dışındaysa önce o hücreyi seçer; menü o seçimle çalışır. */
  function onCellContextMenu(e: MouseEvent<HTMLElement>, cell: Cell) {
    e.preventDefault();
    const next = isSelected(sel, cell) ? sel : selectCell(cell);
    setSel(next);
    // Klavyeden (menü tuşu, Shift+F10) açılınca tarayıcının koordinatı imleç değildir: hücrenin altı.
    const at = rightPressed.current ? { x: e.clientX, y: e.clientY } : menuBelow(e);
    rightPressed.current = false;
    setMenu((m) => ({ ...at, sel: next, key: (m?.key ?? 0) + 1 }));
  }

  const closeMenu = useCallback(() => {
    setMenu(null);
    focusPending.current = true;
  }, []);

  function copyAsInsert(s: Selection) {
    const r = selectionRange(s);
    const sql = insertStatements({ tablo: PLACEHOLDER_TABLE, kolonlar, tipler, katalog: tipAdlari, satirlar: satirlar.slice(r.ust, r.alt + 1) });
    copyText(sql);
  }

  /** Sağ tık menüsü: düzenlenebilir grid'de NULL ve satır eylemleri, her zaman INSERT olarak kopyala. */
  function menuItems(s: Selection): MenuItem[] {
    const items: MenuItem[] = [];
    if (onDuzenle) {
      const rows = selectedRows(s);
      const deleted = rows.filter((r) => satirIsareti?.(r)?.durum === 'silinecek');
      items.push({ label: 'NULL yap', onSelect: () => setNull(s) });
      if (onSatirEkle) items.push({ label: 'Satır ekle', onSelect: onSatirEkle });
      if (onSatirSil && deleted.length < rows.length) items.push({ label: 'Satırları sil', danger: true, onSelect: () => onSatirSil(rows.filter((r) => !deleted.includes(r))) });
      if (onSilmeyiGeriAl && deleted.length > 0) items.push({ label: 'Silmeyi geri al', onSelect: () => onSilmeyiGeriAl(deleted) });
    }
    items.push({ label: 'INSERT olarak kopyala', onSelect: () => copyAsInsert(s) });
    return items;
  }

  /** Düzenleyici açıkken yapıştırma kutunun kendi işidir; grid'de TSV seçimin sol üst köşesinden yazılır. */
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!onYapistir || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    const r = selectionRange(sel);
    onYapistir({ satir: r.ust, kolon: r.sol }, e.clipboardData.getData('text/plain'));
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

  return (
    <>
      <div
        ref={scrollRef}
        role="grid"
        aria-label={etiket}
        aria-rowcount={toplamSatir === null ? -1 : toplamSatir + 1}
        aria-colcount={kolonlar.length}
        aria-multiselectable="true"
        aria-readonly={onDuzenle ? undefined : 'true'}
        className="sonuc-gridi"
        style={{ '--grid-satir': `${ROW_HEIGHT}px`, '--grid-baslik': `${HEADER_HEIGHT}px` } as CSSProperties}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <div className="grid-icerik" style={{ height: virtualizer.getTotalSize(), width: offsets.at(-1) }}>
          <div role="rowgroup" className="grid-basligi">
            <div role="row" aria-rowindex={1} className="grid-satiri">
              {kolonlar.map((ad, c) => {
                const sort = siralama?.kolon === c ? siralama.yon : null;
                return (
                  <div
                    key={c}
                    role="columnheader"
                    aria-colindex={c + 1}
                    aria-sort={sort ? SORT_ARIA[sort] : undefined}
                    className="grid-kolon-basligi"
                    style={{ width: widths[c] }}
                    title={ad}
                  >
                    {onKolonTikla ? (
                      // Odak hücrelerde (roving tabindex) kalır; klavyeyle sıralama ORDER BY kutusundan.
                      <button type="button" tabIndex={-1} className="grid-kolon-adi grid-siralama" aria-label={ad} onClick={() => onKolonTikla(c)}>
                        {ad}
                        {sort && <span aria-hidden="true">{SORT_ARROW[sort]}</span>}
                      </button>
                    ) : (
                      <span className="grid-kolon-adi">{ad}</span>
                    )}
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
                );
              })}
            </div>
          </div>
          <div role="rowgroup">
            {items.map((item) => {
              const r = item.index;
              const row = satirlar[r]!;
              const failed = hataliSatirlar?.has(r) ?? false;
              const mark = satirIsareti?.(r);
              const durum = mark?.durum ?? null;
              return (
                <div
                  key={r}
                  role="row"
                  aria-rowindex={r + 2}
                  aria-invalid={failed || undefined}
                  aria-description={durum ? DURUM_ETIKETI[durum] : undefined}
                  className={`grid-satiri grid-veri-satiri${failed ? ' hatali' : ''}${durum ? ` ${durum}` : ''}`}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {kolonlar.map((_, c) => {
                    const cell = { satir: r, kolon: c };
                    const changed = mark?.degisen.includes(c) ?? false;
                    const varsayilan = isDefaultCell(mark, c);
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
                        className={`grid-hucresi${varsayilan ? ' varsayilan' : shown.null ? ' null' : ''}${selected ? ' secili' : ''}${active ? ' aktif' : ''}${changed ? ' degisti' : ''}`}
                        style={{ width: widths[c] }}
                        onMouseDown={(e) => onCellMouseDown(e, cell)}
                        onMouseEnter={() => onCellMouseEnter(cell)}
                        onDoubleClick={() => openBox(cell)}
                        onContextMenu={(e) => onCellContextMenu(e, cell)}
                      >
                        {varsayilan ? DEFAULT_LABEL : shown.null ? NULL_LABEL : shown.metin}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {box && (
            <textarea
              className={`hucre-degeri${box.duzenle ? ' duzenleyici' : ''}`}
              readOnly={!box.duzenle}
              aria-describedby={box.duzenle ? undefined : noteId}
              autoFocus
              aria-label={`${kolonlar[box.cell.kolon]} değeri`}
              value={box.metin}
              placeholder={box.yerTutucu}
              // Düzenleyici içerikle büyür; salt okunur kutu sabit yükseklikte kaydırılır.
              rows={box.duzenle ? Math.min(Math.max(box.metin.split('\n').length, 1), EDITOR_MAX_LINES) : undefined}
              style={{
                top: HEADER_HEIGHT + box.cell.satir * ROW_HEIGHT,
                left: offsets[box.cell.kolon],
                width: Math.max(widths[box.cell.kolon]!, VALUE_BOX_MIN_WIDTH),
              }}
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onChange={(e) => setBox({ ...box, metin: e.target.value, yerTutucu: undefined, kirli: true })}
              onKeyDown={onBoxKeyDown}
              // Başka yere tıklamak düzenlemeyi kaydeder (IntelliJ gibi); Esc vazgeçer.
              onBlur={() => closeBox(true, 'odaksiz')}
            />
          )}
          {box && !box.duzenle && (
            // Düzenlemenin neden kapalı olduğu kutunun hemen altında.
            <p
              id={noteId}
              role="note"
              className="hucre-degeri-notu kucuk"
              style={{
                top: HEADER_HEIGHT + box.cell.satir * ROW_HEIGHT + VALUE_BOX_HEIGHT,
                left: offsets[box.cell.kolon],
                width: Math.max(widths[box.cell.kolon]!, VALUE_BOX_MIN_WIDTH),
              }}
            >
              {box.neden ?? saltOkunurNedeni}
            </p>
          )}
        </div>
      </div>
      {menu && (
        <Menu
          key={menu.key}
          x={menu.x}
          y={menu.y}
          label={`${etiket} menüsü`}
          items={menuItems(menu.sel)}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

/** Pano izni reddedilirse kopyalanacak başka yol yok; grid durumu değişmez. */
function copyText(metin: string) {
  navigator.clipboard?.writeText(metin).catch(() => {});
}
