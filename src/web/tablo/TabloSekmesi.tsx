import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../../core/baglanti';
import {
  NO_CHANGES,
  addRow,
  deleteRows,
  editCell,
  editableTable,
  failedRowKey,
  gridRows,
  pasteTsv,
  pendingCount,
  pendingItems,
  pendingScript,
  readOnlyReason,
  restoreRows,
  type PendingChanges,
} from '../../core/grid/bekleyen';
import type { Cell } from '../../core/grid/secim';
import { typeName } from '../../core/grid/tipler';
import { startDecision, type DecisionTimer } from '../../core/karar-suresi';
import { filterCompletion, typeMap } from '../../core/katalog';
import type { TableTab } from '../../core/konsol-sekmeleri';
import { ROW_LIMIT_MESSAGE, applyEvent, startRunView, targetLock, type RunView } from '../../core/script-calistirma';
import { writeLockState } from '../../core/yazma-kilidi';
import { KararKarti } from '../script/KararKarti';
import { WRITE_LOCK_LABELS } from '../script/durum';
import type { ScriptRunHandle } from '../api/client';
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
  /** Bu sekmenin Yazma kilidi açık mı (sekme ve hedef başına; sahibi konsoldur). */
  writeMode: boolean;
  onToggleWriteMode: () => void;
  /** Hedef kilidinin nedeni değişti: "Uygula" çalışırken ve karar beklenirken hedef değişmez. */
  onTargetLockChange?: (reason: string | null) => void;
  /** Bekleyen değişiklik sayısı değişti (kapatma uyarısı için); sekme kapanınca 0. */
  onPendingChange?: (count: number) => void;
  hidden: boolean;
}

/** Yüklü sayfalar: ilk sayfanın kolonları ve notu, eklenen satırlar, sonraki sayfanın durumu. */
type Loaded = Pick<TablePageResponse, 'kolonlar' | 'tipler' | 'pk' | 'uretilmis' | 'tutarlilikNotu'> &
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

const APPLYING_REASON = 'Bekleyen değişiklikler uygulanıyor; bitene kadar düzenlenemez.';

/**
 * Tablo sekmesi: editörsüz, başlıkta `≈ N satır`, serbest `WHERE` / `ORDER BY` kutuları, altında
 * grid. Her sayfa sunucuda kısa, ayrı, salt okunur, tek ifadelik bir sorgudur; sekme açık
 * transaction tutmaz. Sona yaklaşınca sonraki sayfa istenir. Geri gelen sekme bağlanmaz: veri
 * "Yükle" ile çekilir.
 *
 * PK'lı tabloda hücreler düzenlenir, NULL yapılır, satır eklenir/silinir ve TSV yapıştırılır;
 * hepsi Bekleyen değişiklik olarak birikir, sağ sütunda
 * liste ve üretilen SQL sürekli görünür. "Uygula" o SQL'i bu sekmede mevcut Script çalıştırıcıyla
 * Transaction modunda, her ifade tam 1 satır etkileyecek şekilde çalıştırır (karar kartı).
 */
export function TabloSekmesi({
  tab,
  target,
  autoLoad,
  catalog,
  onRefreshCatalog,
  onFilterChange,
  writeMode,
  onToggleWriteMode,
  onTargetLockChange,
  onPendingChange,
  hidden,
}: Props) {
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
          const { kolonlar, tipler, pk, uretilmis, tutarlilikNotu } = page;
          setLoading(false);
          setError(null);
          setGridKey(gen);
          setView({
            durum: 'hazir',
            sayfa: { kolonlar, tipler, pk, uretilmis, tutarlilikNotu, filtre, ...appendPage([], page), yukleniyor: false, hata: null },
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

  // ---------- Bekleyen değişiklikler ve Uygula ----------

  /** PK'lı tabloda düzenlenebilir tablo; PK kolonlarından biri sonuçta yoksa da kapalı. */
  const editable = useMemo(() => {
    if (!sayfa) return null;
    const tipler = sayfa.tipler.map((oid) => typeName(oid, tipAdlari));
    return editableTable({ sema: tab.sema, tablo: tab.tablo, kolonlar: sayfa.kolonlar, tipler, pk: sayfa.pk, uretilmis: sayfa.uretilmis });
    // Sayfa eklendikçe `sayfa` değişir; tablo yalnızca kolonlar/PK/tiplerle değişir.
  }, [sayfa?.kolonlar, sayfa?.tipler, sayfa?.pk, sayfa?.uretilmis, tipAdlari, tab.sema, tab.tablo]);
  const table = editable && !('kapali' in editable) ? editable : null;
  /** Diske yazılmaz; sekme kapanınca kaybolur (kapatırken uyarılır). */
  const [changes, setChangesState] = useState<PendingChanges>(NO_CHANGES);
  /** Son reddedilen yapıştırmanın nedeni; sonraki değişiklikte kalkar. */
  const [pasteError, setPasteError] = useState<string | null>(null);
  const setChanges = (next: PendingChanges | ((current: PendingChanges) => PendingChanges)) => {
    setPasteError(null);
    setChangesState(next);
  };
  /** Her artışta grid eklenen (son) satıra gider. */
  const [goLast, setGoLast] = useState(0);
  const script = useMemo(() => (table ? pendingScript(table, changes) : { metin: '', ifadeler: [] }), [table, changes]);
  const [run, setRun] = useState<RunView | null>(null);
  const [deadline, setDeadline] = useState<DecisionTimer | null>(null);
  const handle = useRef<ScriptRunHandle | null>(null);
  const busy = run?.evre === 'calisiyor' || run?.evre === 'karar';
  const lock = target ? writeLockState(target.connection.envTag, writeMode) : null;
  const count = pendingCount(changes);

  // Sekme kapanırsa açık transaction sunucuda geri alınır (ADR-0002).
  useEffect(() => () => handle.current?.close(), []);

  const lockReason = targetLock(run);
  useEffect(() => onTargetLockChange?.(lockReason), [lockReason, onTargetLockChange]);
  useEffect(() => () => onTargetLockChange?.(null), [onTargetLockChange]);
  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;
  useEffect(() => onPendingChangeRef.current?.(count), [count]);
  useEffect(
    () => () => {
      onPendingChangeRef.current?.(0);
    },
    [],
  );
  // Tarayıcı sekmesi kapanırken de uyarılır.
  useEffect(() => {
    if (count === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [count]);

  /** Commit sonrası sayfa uygulanan filtreyle yeniden çekilir; olay geri çağrısı güncel `load`'u buradan okur. */
  const reloadAfterCommit = useRef(() => {});
  reloadAfterCommit.current = () => load(applied);

  /**
   * "Uygula": önizlemedeki script bu sekmede Transaction modunda, her ifade tam 1 satır etkileyecek
   * şekilde çalışır; ek onay yok. Commit → bekleyenler temizlenir, sayfa yeniden çekilir;
   * rollback ya da hata → bekleyenler kalır.
   */
  function applyChanges() {
    if (!target || busy || script.metin === '' || lock === 'salt-okunur') return;
    const metin = script.metin;
    setRun(startRunView(metin));
    setDeadline(null);
    const request = { target: { connectionId: target.connection.id, database: target.database }, script: metin, yazmaModu: writeMode, deneme: false, beklenenSatir: 1 as const };
    handle.current = api.runScript(request, (event) => {
      setRun((current) => (current ? applyEvent(current, event) : current));
      if (event.type === 'kararBekleniyor' || event.type === 'uzatildi') setDeadline(startDecision(event.kalanMs, Date.now()));
      if (event.type === 'bitti' && event.sonuc === 'commit') {
        setChanges(NO_CHANGES);
        reloadAfterCommit.current();
      }
    });
  }

  function requestDecision(type: 'commit' | 'rollback' | 'uzat') {
    handle.current?.send({ type });
    setRun((current) => (current ? { ...current, bekleyenIstek: type, uyari: undefined } : current));
  }

  /** Son uygulamada hata alan ifadenin satırı; bekleyenler o andan beri değişmediyse. */
  const failed = useMemo(() => {
    if (!run || run.script !== script.metin) return null;
    const s = run.ifadeler.find((x) => x.hata);
    const satir = s ? failedRowKey(script, s.i) : null;
    return s?.hata && satir ? { satir, mesaj: s.hata.mesaj } : null;
  }, [run, script]);

  /** Grid'in satırları: yüklüler bekleyen değerleriyle, ardından eklenenler. PK'sız tabloda yüklüler. */
  const rows = useMemo(() => (sayfa && table ? gridRows(table, changes, sayfa.satirlar) : null), [sayfa, table, changes]);
  const shownRows = useMemo(() => (rows ? rows.map((r) => r.degerler) : (sayfa?.satirlar ?? [])), [rows, sayfa]);

  const failedRows = useMemo(() => {
    if (!failed || !rows) return undefined;
    return new Set(rows.flatMap((r, i) => (r.anahtar === failed.satir ? [i] : [])));
  }, [failed, rows]);

  const editCellAt = (r: number, c: number, deger: string | null) => {
    const ref = rows?.[r]?.ref;
    if (table && ref) setChanges((current) => editCell(table, current, ref, c, deger));
  };
  const refsAt = (indexes: number[]) => indexes.flatMap((i) => (rows?.[i] ? [rows[i].ref] : []));
  const addRowAction = () => {
    if (!table) return;
    setChanges((current) => addRow(current));
    setGoLast((n) => n + 1);
  };
  const deleteAt = (indexes: number[]) => table && setChanges((current) => deleteRows(table, current, refsAt(indexes)));
  const restoreAt = (indexes: number[]) => table && setChanges((current) => restoreRows(table, current, refsAt(indexes)));
  const pasteAt = (start: Cell, metin: string) => {
    if (!table || !rows) return;
    const result = pasteTsv(table, changes, rows, start, metin);
    if ('hata' in result) setPasteError(result.hata);
    else setChanges(result);
  };
  const editing = table !== null && !busy;

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
      <div className={`tablo-govde${table ? ' duzenlenebilir' : ''}`}>
        <div className="tablo-sol">
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
              {editable && 'kapali' in editable && <p className="soluk kucuk">{editable.kapali}</p>}
              {busy && table && <p className="soluk kucuk">{APPLYING_REASON}</p>}
              {table && (
                <div className="grid-araclari">
                  <button type="button" onClick={addRowAction} disabled={!editing} title="Sona yeni satır ekler; dokunulmayan kolonlar DEFAULT kalır">
                    Satır ekle
                  </button>
                  <span className="soluk kucuk">Sağ tık: NULL yap, satır sil · Ctrl/Cmd+Shift+N: NULL · Ctrl/Cmd+V: TSV yapıştır</span>
                </div>
              )}
              {pasteError && (
                <p role="alert" className="uyari-metni kucuk">
                  {pasteError}
                </p>
              )}
              <SonucGridi
                key={gridKey}
                etiket={`${name} satırları`}
                kolonlar={sayfa.kolonlar}
                tipler={sayfa.tipler}
                tipAdlari={tipAdlari}
                satirlar={shownRows}
                toplamSatir={complete(sayfa) ? shownRows.length : null}
                onSonaYaklasti={loadMore}
                onKolonTikla={(c) => sortBy(sayfa, sayfa.kolonlar[c]!)}
                siralama={siralama}
                onDuzenle={editing ? editCellAt : undefined}
                saltOkunurNedeni={editable && 'kapali' in editable ? editable.kapali : APPLYING_REASON}
                kolonSaltOkunur={table ? (c) => readOnlyReason(table, c) : undefined}
                satirIsareti={rows ? (r) => rows[r] : undefined}
                hataliSatirlar={failedRows}
                onSatirEkle={editing ? addRowAction : undefined}
                onSatirSil={editing ? deleteAt : undefined}
                onSilmeyiGeriAl={editing ? restoreAt : undefined}
                onYapistir={editing ? pasteAt : undefined}
                sonSatiraGit={goLast}
              />
            </>
          )}
        </div>
        {table && (
          <aside aria-label="Bekleyen değişiklikler sütunu" className="calistirma-sutunu bekleyen-sutunu">
            <section aria-label="SQL önizlemesi" className="sql-onizlemesi">
              {count === 0 ? (
                <p className="soluk kucuk">Bekleyen değişiklik yok. Hücreyi düzenlemek için yazmaya başlayın, F2 ya da çift tık.</p>
              ) : (
                <>
                  <ul aria-label="Bekleyen değişiklikler" className="bekleyen-listesi kucuk">
                    {pendingItems(table, changes).map((item) => (
                      <li key={item.anahtar} className={failed?.satir === item.anahtar ? 'hatali' : undefined}>
                        {item.metin}
                        {failed?.satir === item.anahtar && <span className="ifade-hatasi"> — {failed.mesaj}</span>}
                      </li>
                    ))}
                  </ul>
                  <pre className="uretilen-sql kucuk">{script.metin}</pre>
                </>
              )}
            </section>
            <div className="script-cubugu">
              {lock && (
                // Tek tık; onay yok. Açık transaction'ın kilidi değişmez.
                <button
                  type="button"
                  className={`kilit-dugmesi ${lock}`}
                  aria-pressed={lock === 'yazma-acik'}
                  title={WRITE_LOCK_LABELS[lock].eylem}
                  onClick={onToggleWriteMode}
                  disabled={busy}
                >
                  {WRITE_LOCK_LABELS[lock].rozet}
                </button>
              )}
              <button
                type="button"
                className="birincil"
                title={lock === 'salt-okunur' ? 'Salt okunur prod: yazma kilidini açın' : 'Bekleyen değişiklikleri Transaction modunda çalıştır'}
                onClick={applyChanges}
                disabled={busy || count === 0 || lock === 'salt-okunur'}
              >
                Uygula
              </button>
            </div>
            <KararKarti run={run} deadline={run?.evre === 'karar' ? deadline : null} onRequest={requestDecision} />
          </aside>
        )}
      </div>
    </section>
  );
}
