import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../../core/baglanti';
import { filterCompletion, typeMap } from '../../core/katalog';
import type { TableTab } from '../../core/konsol-sekmeleri';
import { ROW_LIMIT_MESSAGE } from '../../core/script-calistirma';
import {
  BOX_LABELS,
  OFFSET_NOTE,
  appendPage,
  cycleOrderBy,
  headerSort,
  pageErrorText,
  rowEstimate,
  type FilterBox,
  type LoadedRows,
  type TableFilter,
  type TablePageResponse,
} from '../../core/tablo-sayfasi';
import { targetSchemas } from '../../core/veritabani-secimi';
import { ApiError, useApi } from '../api/client';
import { SonucGridi } from '../grid/SonucGridi';
import type { CatalogEntry } from '../katalog/kataloglar';
import { FiltreKutusu } from './FiltreKutusu';

interface Props {
  tab: TableTab;
  /** Sekmenin hedefi; bağlantısı silinmişse `null`. */
  target: { connection: Connection; database: string } | null;
  /** Bu oturumda listeden açıldı: ilk sayfa hemen çekilir. Geri gelen sekme "Yükle"yi bekler. */
  autoLoad: boolean;
  /** Hedefin katalogu (varsa); filtre kutularının tamamlaması ve INSERT tip adları bundan. */
  catalog?: CatalogEntry;
  /** ↻: hedefin katalogunu yeniler; sunucu kolonları ve PK'yı oradan okur. */
  onRefreshCatalog: () => Promise<unknown>;
  /** Uygulanan `WHERE` / `ORDER BY` sekmeye (ve diske) yazılır. */
  onFilterChange: (filter: TableFilter) => void;
  hidden: boolean;
}

/** Yüklü sayfalar: ilk sayfanın kolonları ve notu, eklenen satırlar, sonraki sayfanın durumu. */
type Loaded = Pick<TablePageResponse, 'kolonlar' | 'tipler' | 'tutarlilikNotu'> &
  LoadedRows & {
    /** Bu sayfaları üreten filtre; sonraki sayfalar onunla istenir. */
    filtre: TableFilter;
    /** Sonraki sayfa yolda. */
    yukleniyor: boolean;
    /** Sonraki sayfa okunamadı; yeniden ↻ ile. */
    hata: string | null;
  };

type View =
  | { durum: 'bekliyor' }
  /** Denendi ama sorgu reddedildi; hata filtre çubuğunda. */
  | { durum: 'sonucsuz' }
  | { durum: 'hata'; hata: string }
  | { durum: 'hazir'; sayfa: Loaded };

/** Filtre çubuğunda gösterilen sorgu hatası; `kutu` varsa o kutunun yanında. */
interface QueryError {
  metin: string;
  kutu: FilterBox | null;
}

/** Tablonun tüm satırları yüklendi: satır sayısı bilinir. */
const complete = (s: Loaded) => s.sonraki === null && !s.sinir;

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.body?.sqlstate) return `${err.message} (SQLSTATE ${err.body.sqlstate})`;
  return err instanceof Error ? err.message : String(err);
}

/** Sayfa sorgusu reddedildi (Postgres hatası ya da çok ifadeli filtre): grid önceki sonuçla kalır. */
function queryError(err: unknown): QueryError | null {
  if (!(err instanceof ApiError) || err.status !== 400 || !err.body?.hata) return null;
  const { hata, sqlstate, kutu, kutuKonumu } = err.body;
  return { metin: pageErrorText({ hata, sqlstate, kutu, kutuKonumu }), kutu: kutu ?? null };
}

const BOXES: readonly FilterBox[] = ['where', 'orderBy'];

/**
 * Tablo sekmesi: editörsüz, başlıkta `≈ N satır`, serbest `WHERE` / `ORDER BY` kutuları, altında
 * grid. Her sayfa sunucuda kısa, ayrı, salt okunur, tek ifadelik bir sorgudur; sekme açık
 * transaction tutmaz. Sona yaklaşınca sonraki sayfa istenir. Geri gelen sekme bağlanmaz: veri
 * "Yükle" ile çekilir.
 */
export function TabloSekmesi({ tab, target, autoLoad, catalog, onRefreshCatalog, onFilterChange, hidden }: Props) {
  const api = useApi();
  const [view, setView] = useState<View>({ durum: 'bekliyor' });
  /** İlk sayfa yolda; varsa önceki sonuç görünmeye devam eder. */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<QueryError | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  /** Kutulardaki (henüz uygulanmamış olabilir) metin. */
  const [draft, setDraftState] = useState<TableFilter>({ where: tab.where, orderBy: tab.orderBy });
  /** Taslağın eşzamanlı kopyası: CodeMirror'ın Enter'ı son tuşun render'ından önce gelebilir. */
  const draftRef = useRef(draft);
  const setDraft = (next: TableFilter) => {
    draftRef.current = next;
    setDraftState(next);
  };
  /** Her başarılı yükleme grid'i yeniden kurar (seçim, kaydırma, kolon genişlikleri). */
  const [gridKey, setGridKey] = useState(0);
  /** Her yükleme yeni bir nesil: eski yanıtlar yazılmaz. */
  const current = useRef(0);
  const name = `${tab.sema}.${tab.tablo}`;
  const connectionId = target?.connection.id;
  const database = target?.database;

  const onFilterChangeRef = useRef(onFilterChange);
  onFilterChangeRef.current = onFilterChange;

  /** İlk sayfa; `persist`: yeni uygulanan filtre, sayfa gelince sekmeye yazılır (reddedilen yazılmaz). */
  const load = useCallback(
    (filtre: TableFilter, persist = false) => {
      if (connectionId === undefined || database === undefined) return;
      const gen = ++current.current;
      setLoading(true);
      api.readTablePage(connectionId, database, { sema: tab.sema, tablo: tab.tablo, ...filtre, sonraki: null }).then(
        (page) => {
          if (current.current !== gen) return;
          if (persist) onFilterChangeRef.current(filtre);
          if (page.satirTahmini !== undefined) setEstimate(page.satirTahmini);
          const { kolonlar, tipler, tutarlilikNotu } = page;
          setLoading(false);
          setError(null);
          setGridKey(gen);
          setView({
            durum: 'hazir',
            sayfa: { kolonlar, tipler, tutarlilikNotu, filtre, ...appendPage([], page), yukleniyor: false, hata: null },
          });
        },
        (err: unknown) => {
          if (current.current !== gen) return;
          setLoading(false);
          const rejected = queryError(err);
          if (rejected) {
            setError(rejected);
            setView((v) => (v.durum === 'hazir' ? v : { durum: 'sonucsuz' }));
          } else {
            setError(null);
            setView({ durum: 'hata', hata: errorText(err) });
          }
        },
      );
    },
    [api, connectionId, database, tab.sema, tab.tablo],
  );

  const applied = useMemo(() => ({ where: tab.where, orderBy: tab.orderBy }), [tab.where, tab.orderBy]);

  /** Kutular (Enter) ya da kolon başlığı: ilk sayfa filtreyle çekilir; gelirse filtre sekmeye yazılır. */
  const apply = (filtre: TableFilter) => load(filtre, true);

  /**
   * ↻: önce katalog yenilenir (başka araçla yapılan DDL sonrası kolonlar ve PK güncel olsun), sonra
   * ilk sayfa uygulanan filtreyle yeniden çekilir.
   */
  const reload = useCallback(() => {
    const gen = ++current.current;
    setLoading(true);
    onRefreshCatalog().then(
      () => current.current === gen && load(applied),
      (err: unknown) => {
        if (current.current !== gen) return;
        setLoading(false);
        setView({ durum: 'hata', hata: `Katalog okunamadı: ${errorText(err)}` });
      },
    );
  }, [onRefreshCatalog, load, applied]);

  // Listeden açılan sekme ilk çizimde yükler; geri gelen sekme hiçbir istek göndermez.
  const started = useRef(false);
  useEffect(() => {
    if (!autoLoad || started.current || connectionId === undefined) return;
    started.current = true;
    load(applied);
  }, [autoLoad, connectionId, load, applied]);

  /** Yoldaki sonraki sayfa isteğinin nesli; aynı sayfa iki kez istenmez. */
  const moreInFlight = useRef<number | null>(null);

  const loadMore = useCallback(() => {
    // Yeni ilk sayfa yoldayken eski sonucun devamı istenmez: yanıtı yeni sonuca eklenirdi.
    if (loading || view.durum !== 'hazir' || connectionId === undefined || database === undefined) return;
    const { sonraki, yukleniyor, hata, filtre } = view.sayfa;
    const gen = current.current;
    if (sonraki === null || yukleniyor || hata !== null || moreInFlight.current === gen) return;
    moreInFlight.current = gen;
    const update = (change: (s: Loaded) => Loaded) =>
      setView((v) => (current.current !== gen || v.durum !== 'hazir' ? v : { durum: 'hazir', sayfa: change(v.sayfa) }));
    update((s) => ({ ...s, yukleniyor: true }));
    const settle = () => {
      if (moreInFlight.current === gen) moreInFlight.current = null;
    };
    api.readTablePage(connectionId, database, { sema: tab.sema, tablo: tab.tablo, ...filtre, sonraki }).then(
      (page) => {
        settle();
        update((s) => ({ ...s, ...appendPage(s.satirlar, page), yukleniyor: false }));
      },
      (err: unknown) => {
        settle();
        update((s) => ({ ...s, yukleniyor: false, hata: `Satırlar çekilemedi: ${errorText(err)}` }));
      },
    );
  }, [api, view, loading, connectionId, database, tab.sema, tab.tablo]);

  const tipAdlari = useMemo(() => (catalog?.katalog ? typeMap(catalog.katalog) : undefined), [catalog]);
  const katalog = catalog?.katalog;
  const completion = useMemo(() => {
    if (!katalog || !target) return null;
    return filterCompletion(katalog, targetSchemas(target.connection, target.database, katalog.semalar), tab.sema, tab.tablo);
  }, [katalog, target, tab.sema, tab.tablo]);

  const sayfa = view.durum === 'hazir' ? view.sayfa : null;
  const siralama = useMemo(() => (sayfa ? headerSort(sayfa.kolonlar, sayfa.filtre.orderBy) : null), [sayfa]);

  /**
   * Kolon başlığı: gösterilen sonucun filtresiyle (uygulanmamış `WHERE` taslağı uygulanmaz) sıralama
   * döngüsü; `ORDER BY` kutusu yeni sıralamayı gösterir.
   */
  const sortBy = (shown: Loaded, kolon: string) => {
    const orderBy = cycleOrderBy(shown.filtre.orderBy, kolon);
    setDraft({ ...draftRef.current, orderBy });
    apply({ ...shown.filtre, orderBy });
  };

  const errorLine = (kutu: FilterBox | null) =>
    error && error.kutu === kutu ? (
      <p role="alert" className="uyari-metni kucuk filtre-hatasi">
        {error.metin}
      </p>
    ) : null;

  return (
    <section aria-label={`${name} tablosu`} className="tablo-sekmesi" hidden={hidden}>
      <header className="tablo-basligi">
        <h2>{name}</h2>
        {estimate !== null && <span className="soluk kucuk">{rowEstimate(estimate)}</span>}
        {target && <span className="soluk kucuk">{`${target.connection.name} / ${target.database}`}</span>}
        <span className="bosluk" />
        <button
          type="button"
          className="ikon-dugme"
          aria-label="Tabloyu yeniden yükle"
          title="Yeniden yükle"
          disabled={!target || loading}
          onClick={reload}
        >
          ↻
        </button>
      </header>
      <div className="filtre-cubugu">
        {BOXES.map((kutu) => (
          <div key={kutu} className="filtre-kutusu">
            <span className="filtre-etiketi" aria-hidden="true">
              {BOX_LABELS[kutu]}
            </span>
            <FiltreKutusu
              etiket={BOX_LABELS[kutu]}
              value={draft[kutu]}
              onChange={(text) => setDraft({ ...draftRef.current, [kutu]: text })}
              onApply={() => target && apply(draftRef.current)}
              completion={completion}
              invalid={error?.kutu === kutu}
            />
            {errorLine(kutu)}
          </div>
        ))}
        {errorLine(null)}
      </div>
      {!target && <p className="soluk kucuk">Bu Tablo sekmesinin hedefi yok: bağlantısı silinmiş.</p>}
      {target && view.durum === 'bekliyor' && !loading && (
        <div className="tablo-yukle">
          <p className="soluk kucuk">Tablo henüz yüklenmedi; yüklemek hedefe bağlanır.</p>
          <button type="button" onClick={() => load(applied)}>
            Yükle
          </button>
        </div>
      )}
      {loading && !sayfa && <p className="soluk kucuk">Yükleniyor…</p>}
      {view.durum === 'hata' && !loading && (
        <p role="alert" className="uyari-metni kucuk">
          {view.hata}
        </p>
      )}
      {sayfa && (
        <>
          <p className="soluk kucuk tablo-durumu">
            {complete(sayfa) ? `${sayfa.satirlar.length} satır` : `ilk ${sayfa.satirlar.length} satır gösteriliyor`}
            {loading && ' · Yükleniyor…'}
            {sayfa.yukleniyor && ' · Satırlar yükleniyor…'}
            {sayfa.sinir && ` · ${ROW_LIMIT_MESSAGE}`}
            {sayfa.hata && ` · ${sayfa.hata}`}
            {sayfa.tutarlilikNotu && ` · ${OFFSET_NOTE}`}
          </p>
          <SonucGridi
            key={gridKey}
            etiket={`${name} satırları`}
            kolonlar={sayfa.kolonlar}
            tipler={sayfa.tipler}
            tipAdlari={tipAdlari}
            satirlar={sayfa.satirlar}
            toplamSatir={complete(sayfa) ? sayfa.satirlar.length : null}
            onSonaYaklasti={loadMore}
            onKolonTikla={(c) => sortBy(sayfa, sayfa.kolonlar[c]!)}
            siralama={siralama}
          />
        </>
      )}
    </section>
  );
}
