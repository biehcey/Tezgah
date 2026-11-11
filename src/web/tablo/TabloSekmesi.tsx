import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../../core/baglanti';
import { typeMap } from '../../core/katalog';
import type { TableTab } from '../../core/konsol-sekmeleri';
import { ROW_LIMIT_MESSAGE } from '../../core/script-calistirma';
import { OFFSET_NOTE, appendPage, rowEstimate, type LoadedRows, type TablePageResponse } from '../../core/tablo-sayfasi';
import { ApiError, useApi } from '../api/client';
import { SonucGridi } from '../grid/SonucGridi';
import type { CatalogEntry } from '../katalog/kataloglar';

interface Props {
  tab: TableTab;
  /** Sekmenin hedefi; bağlantısı silinmişse `null`. */
  target: { connection: Connection; database: string } | null;
  /** Bu oturumda listeden açıldı: ilk sayfa hemen çekilir. Geri gelen sekme "Yükle"yi bekler. */
  autoLoad: boolean;
  /** Hedefin katalogu (varsa); "INSERT olarak kopyala" tip adlarını bundan çözer. */
  catalog?: CatalogEntry;
  hidden: boolean;
}

/** Yüklü sayfalar: ilk sayfanın kolonları ve notu, eklenen satırlar, sonraki sayfanın durumu. */
type Loaded = Pick<TablePageResponse, 'kolonlar' | 'tipler' | 'tutarlilikNotu'> &
  LoadedRows & {
    /** Sonraki sayfa yolda. */
    yukleniyor: boolean;
    /** Sonraki sayfa okunamadı; yeniden ↻ ile. */
    hata: string | null;
  };

type View =
  | { durum: 'bekliyor' }
  | { durum: 'yukleniyor' }
  | { durum: 'hata'; hata: string }
  | { durum: 'hazir'; sayfa: Loaded };

/** Tablonun tüm satırları yüklendi: satır sayısı bilinir. */
const complete = (s: Loaded) => s.sonraki === null && !s.sinir;

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.body?.sqlstate) return `${err.message} (SQLSTATE ${err.body.sqlstate})`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tablo sekmesi: editörsüz, başlıkta `≈ N satır`, altında grid. Her sayfa sunucuda kısa, ayrı,
 * salt okunur bir sorgudur; sekme açık transaction tutmaz. Sona yaklaşınca sonraki sayfa istenir.
 * Geri gelen sekme bağlanmaz: veri "Yükle" ile çekilir.
 */
export function TabloSekmesi({ tab, target, autoLoad, catalog, hidden }: Props) {
  const api = useApi();
  const [view, setView] = useState<View>({ durum: 'bekliyor' });
  const [estimate, setEstimate] = useState<number | null>(null);
  /** Her yükleme (ilk açılış, Yükle, ↻) yeni bir nesil: eski yanıtlar yazılmaz, grid yeniden kurulur. */
  const [generation, setGeneration] = useState(0);
  const current = useRef(0);
  const name = `${tab.sema}.${tab.tablo}`;
  const connectionId = target?.connection.id;
  const database = target?.database;

  const load = useCallback(() => {
    if (connectionId === undefined || database === undefined) return;
    const gen = ++current.current;
    setGeneration(gen);
    setView({ durum: 'yukleniyor' });
    api.readTablePage(connectionId, database, { sema: tab.sema, tablo: tab.tablo, sonraki: null }).then(
      (page) => {
        if (current.current !== gen) return;
        if (page.satirTahmini !== undefined) setEstimate(page.satirTahmini);
        const { kolonlar, tipler, tutarlilikNotu } = page;
        setView({
          durum: 'hazir',
          sayfa: { kolonlar, tipler, tutarlilikNotu, ...appendPage([], page), yukleniyor: false, hata: null },
        });
      },
      (err: unknown) => current.current === gen && setView({ durum: 'hata', hata: errorText(err) }),
    );
  }, [api, connectionId, database, tab.sema, tab.tablo]);

  // Listeden açılan sekme ilk çizimde yükler; geri gelen sekme hiçbir istek göndermez.
  const started = useRef(false);
  useEffect(() => {
    if (!autoLoad || started.current || connectionId === undefined) return;
    started.current = true;
    load();
  }, [autoLoad, connectionId, load]);

  /** Yoldaki sonraki sayfa isteğinin nesli; aynı sayfa iki kez istenmez. */
  const moreInFlight = useRef<number | null>(null);

  const loadMore = useCallback(() => {
    if (view.durum !== 'hazir' || connectionId === undefined || database === undefined) return;
    const { sonraki, yukleniyor, hata } = view.sayfa;
    const gen = current.current;
    if (sonraki === null || yukleniyor || hata !== null || moreInFlight.current === gen) return;
    moreInFlight.current = gen;
    const update = (change: (s: Loaded) => Loaded) =>
      setView((v) => (current.current !== gen || v.durum !== 'hazir' ? v : { durum: 'hazir', sayfa: change(v.sayfa) }));
    update((s) => ({ ...s, yukleniyor: true }));
    const settle = () => {
      if (moreInFlight.current === gen) moreInFlight.current = null;
    };
    api.readTablePage(connectionId, database, { sema: tab.sema, tablo: tab.tablo, sonraki }).then(
      (page) => {
        settle();
        update((s) => ({ ...s, ...appendPage(s.satirlar, page), yukleniyor: false }));
      },
      (err: unknown) => {
        settle();
        update((s) => ({ ...s, yukleniyor: false, hata: `Satırlar çekilemedi: ${errorText(err)}` }));
      },
    );
  }, [api, view, connectionId, database, tab.sema, tab.tablo]);

  const tipAdlari = useMemo(() => (catalog?.katalog ? typeMap(catalog.katalog) : undefined), [catalog]);

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
          disabled={!target || view.durum === 'yukleniyor'}
          onClick={load}
        >
          ↻
        </button>
      </header>
      {!target && <p className="soluk kucuk">Bu Tablo sekmesinin hedefi yok: bağlantısı silinmiş.</p>}
      {target && view.durum === 'bekliyor' && (
        <div className="tablo-yukle">
          <p className="soluk kucuk">Tablo henüz yüklenmedi; yüklemek hedefe bağlanır.</p>
          <button type="button" onClick={load}>
            Yükle
          </button>
        </div>
      )}
      {view.durum === 'yukleniyor' && <p className="soluk kucuk">Yükleniyor…</p>}
      {view.durum === 'hata' && (
        <p role="alert" className="uyari-metni kucuk">
          {view.hata}
        </p>
      )}
      {view.durum === 'hazir' && (
        <>
          <p className="soluk kucuk tablo-durumu">
            {complete(view.sayfa)
              ? `${view.sayfa.satirlar.length} satır`
              : `ilk ${view.sayfa.satirlar.length} satır gösteriliyor`}
            {view.sayfa.yukleniyor && ' · Satırlar yükleniyor…'}
            {view.sayfa.sinir && ` · ${ROW_LIMIT_MESSAGE}`}
            {view.sayfa.hata && ` · ${view.sayfa.hata}`}
            {view.sayfa.tutarlilikNotu && ` · ${OFFSET_NOTE}`}
          </p>
          <SonucGridi
            key={generation}
            etiket={`${name} satırları`}
            kolonlar={view.sayfa.kolonlar}
            tipler={view.sayfa.tipler}
            tipAdlari={tipAdlari}
            satirlar={view.sayfa.satirlar}
            toplamSatir={complete(view.sayfa) ? view.sayfa.satirlar.length : null}
            onSonaYaklasti={loadMore}
          />
        </>
      )}
    </section>
  );
}
