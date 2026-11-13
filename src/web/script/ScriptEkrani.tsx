import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { isProd, type Connection } from '../../core/baglanti';
import { analyzeScript, forceTransaction, type RunMode, type ScriptAnalysis } from '../../core/calistirma-modu';
import { positionOf, splitStatements, type Statement } from '../../core/ifade-bolme';
import { formatRemaining, startDecision, type DecisionTimer } from '../../core/karar-suresi';
import { Degisiklikler, DenemeProdUyarisi } from './Degisiklikler';
import { KararKarti, resultText, useCountdown } from './KararKarti';
import {
  ROW_LIMIT_MESSAGE,
  applyEvent,
  canFetchMore,
  requestMore,
  startRunView,
  targetLock,
  type RunView,
  type StatementStatus,
  type StatementView,
} from '../../core/script-calistirma';
import { CONNECTION_LOST, useApi, type ScriptRunHandle } from '../api/client';
import type { ServerEvent } from '../../core/script-calistirma';
import type { SessionTab } from '../../core/konsol-sekmeleri';
import type { Target } from '../../core/veritabani-secimi';
import { runBlockReasons, writeLockState } from '../../core/yazma-kilidi';
import { STATUS_LABELS, STATUS_SYMBOLS, WRITE_LOCK_LABELS, type AnalysisMark } from './durum';
import { ScriptEditoru, type EditorMarks, type ScriptEditoruHandle } from './ScriptEditoru';
import { resultSummary, resultTotal } from '../../core/grid/ozet';
import { SonucGridi } from '../grid/SonucGridi';
import { catalogUse, type CatalogEntry, type CatalogReason } from '../katalog/kataloglar';

interface Props {
  /** Hedefin bağlantısı ve veritabanı; hedef seçilmediyse `null`. */
  target: { connection: Connection; database: string } | null;
  /** "hedefi değiştir ▾": hızlı geçiş paletini açar. */
  onChangeTarget: () => void;
  /** Hedef kilidinin nedeni değişti (`null`: hedef değiştirilebilir); ekran kapanınca `null`. */
  onTargetLockChange?: (reason: string | null) => void;
  /** Editördeki script; sekme kalıcılığı için sahibi konsoldur. */
  script: string;
  onScriptChange: (script: string) => void;
  /** Bu sekmenin Yazma kilidi açık mı (sekme ve hedef başına; sahibi konsoldur). */
  writeMode: boolean;
  /** 🔒/🔓 düğmesi: sekmenin yazma modunu tek tıkla açar ya da kapatır. */
  onToggleWriteMode: () => void;
  /** Aynı hedefte açık oturumu olan diğer sekmeler; `havuzDolu` mesajı bunlarla kurulur. */
  sessionTabs?: readonly SessionTab[];
  /** `havuzDolu` mesajındaki sekme adına tıklandı. */
  onGoToTab?: (id: string) => void;
  /** Hedefin Katalog önbelleği (yoksa istenmemiş); tamamlama ve INSERT tip adları bundan. */
  catalog?: CatalogEntry;
  /** Katalog istendi: ilk çalıştırmada (yoksa), ↻'de ve sunucu DDL sonrası tazeleyince. */
  onCatalog?: (reason: CatalogReason) => void;
  /**
   * Ekran gizli (ör. bağlantı formu açık). Kapanmaz: script, log ve açık transaction korunur;
   * kapanmak transaction'ı geri aldırırdı (ADR-0002).
   */
  hidden?: boolean;
}

/** Aynı satırda başlayan birden çok ifadede satır işareti en önemli durumu gösterir. */
const PRIORITY: Record<StatementStatus, number> = { hatali: 4, calisiyor: 3, calistirilmadi: 2, basarili: 1, sirada: 0 };

const NO_MARKS: EditorMarks = { lines: new Map(), error: null };

const AUTOCOMMIT_CONNECTION_LOST: ServerEvent = {
  type: 'bitti',
  sonuc: 'hata',
  mesaj: 'Tezgah sunucusuyla bağlantı koptu; çalışan ifade iptal edildi, uygulanmış ifadeler kalıcıdır.',
};

/** Yazarken analiz bu kadar duraklamadan sonra yenilenir. */
const ANALYSIS_DELAY_MS = 200;

const MODE_LABELS: Record<RunMode, string> = { transaction: 'Transaction', autocommit: 'Autocommit', okuma: 'Okuma', karisik: 'Karışık' };

type Tab = 'degisiklikler' | 'log';
const TAB_LABELS: Record<Tab, string> = { degisiklikler: 'Değişiklikler', log: 'Log' };

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Analizin editör süsleri: reddedilen ifadeler her zaman, transaction dışılar yalnızca Karışık'ta. */
function analysisMarks(script: string, statements: Statement[], analysis: ScriptAnalysis): EditorMarks {
  const marked: { i: number; tur: AnalysisMark }[] = analysis.reddedilenler.map(({ i }) => ({ i, tur: 'reddedilen' }));
  if (analysis.mod === 'karisik') marked.push(...analysis.transactionDisi.map((i) => ({ i, tur: 'transactionDisi' as const })));
  if (marked.length === 0) return NO_MARKS;
  const lines = new Map<number, AnalysisMark>();
  const ranges = marked.map(({ i, tur }) => {
    const s = statements[i]!;
    lines.set(positionOf(script, s.start).satir, tur);
    return { bas: s.start, bit: s.end, tur };
  });
  return { lines, error: null, analysis: ranges };
}

/**
 * Script ekranı (ticket 23 varyant B): üstte büyük hedef başlığı, solda editör ve çalıştırma çubuğu,
 * sağda karar kartı ve ifade kartları. prod hedefte başlık kırmızımsıdır; uygulamanın kırmızı
 * çerçevesi kökte verilir.
 */
export function ScriptEkrani({
  target,
  onChangeTarget,
  onTargetLockChange,
  script,
  onScriptChange,
  writeMode,
  onToggleWriteMode,
  sessionTabs = [],
  onGoToTab,
  catalog,
  onCatalog,
  hidden = false,
}: Props) {
  const api = useApi();
  const prod = target !== null && isProd(target.connection.envTag);
  const [run, setRun] = useState<RunView | null>(null);
  /** Son çalıştırma prod hedefte başladı; hedef sonradan değişse de şerit o çalıştırmaya göre kalır. */
  const [runOnProd, setRunOnProd] = useState(false);
  const handle = useRef<ScriptRunHandle | null>(null);
  /** Yanıtı beklenen "daha fazla" istekleri, ifade indeksiyle. */
  const moreAsked = useRef(new Set<number>());
  /** Sunucunun son bildirdiği kalan süreden kurulan yerel geri sayım; yetkili sayaç sunucudadır. */
  const [deadline, setDeadline] = useState<DecisionTimer | null>(null);
  /** `havuzDolu` geldiğinde aynı hedefte açık oturumu olan sekmeler; mesaj o anki duruma göre kalır. */
  const [poolFullTabs, setPoolFullTabs] = useState<readonly SessionTab[]>([]);
  // Olay geri çağrısı çalıştırma başında kurulur; o anki değil, `bitti` anındaki liste gerekir.
  const sessionTabsRef = useRef(sessionTabs);
  sessionTabsRef.current = sessionTabs;
  // `bitti` hedef değişmeden önce başlayan çalıştırmanın geri çağrısında gelir.
  const onCatalogRef = useRef(onCatalog);
  onCatalogRef.current = onCatalog;
  const connection = target?.connection;
  const database = target?.database;
  const { completion, tipAdlari } = useMemo(
    () => (connection && database !== undefined ? catalogUse(catalog, connection, database) : { completion: null, tipAdlari: undefined }),
    [catalog, connection, database],
  );
  const editor = useRef<ScriptEditoruHandle>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const targetRef: Target | null = target && { connectionId: target.connection.id, database: target.database };
  const lock = target ? writeLockState(target.connection.envTag, writeMode) : null;

  function openHistoryFolder() {
    setFolderError(null);
    api.openRunHistoryFolder().catch((err: unknown) => setFolderError(`Kayıt klasörü açılamadı: ${(err as Error).message}`));
  }

  // Ekran kapanırsa açık transaction sunucuda geri alınır (ADR-0002).
  useEffect(() => () => handle.current?.close(), []);

  const targetLockReason = targetLock(run);
  useEffect(() => {
    onTargetLockChange?.(targetLockReason);
  }, [targetLockReason, onTargetLockChange]);
  useEffect(() => () => onTargetLockChange?.(null), [onTargetLockChange]);

  const running = run?.evre === 'calisiyor';
  /** Okuma transaction'ı açıkken de script düzenlenir ve yeniden çalıştırılır; eskisi geri alınır. */
  const busy = run?.evre === 'calisiyor' || run?.evre === 'karar';
  const hasStatements = useMemo(() => splitStatements(script).length > 0, [script]);
  /** Analiz edilen metin; yazarken `script`'in gerisinde kalır. */
  const analyzed = useDebounced(script, ANALYSIS_DELAY_MS);
  const statements = useMemo(() => splitStatements(analyzed), [analyzed]);
  const analysis = useMemo(() => analyzeScript(statements), [statements]);
  /** Reddedilen ifadeler, Karışık script ve salt okunur prod'da Autocommit. */
  const reasons = useMemo(() => runBlockReasons(analyzed, statements, lock, { analysis }), [analyzed, statements, lock, analysis]);
  /**
   * Deneme modunun engelleri: ek olarak transaction dışı her ifade. Editörün altında listelenmez
   * (Autocommit script'i Çalıştır ile çalışır); Dene düğmesinin açıklamasında durur.
   */
  const tryReasons = useMemo(
    () => runBlockReasons(analyzed, statements, lock, { analysis, deneme: true }),
    [analyzed, statements, lock, analysis],
  );
  const blocked = reasons.length > 0;
  const tryBlocked = tryReasons.length > 0;
  /** Sonuç sütununun seçili sekmesi; Değişiklikler yalnızca denemede var. */
  const [tab, setTab] = useState<Tab>('log');
  const tabs: Tab[] = run?.deneme ? ['degisiklikler', 'log'] : ['log'];
  const shownTab = run?.deneme ? tab : 'log';
  /** Çalıştırma sayacı: yeni çalıştırmanın grid'leri eskilerin durumunu (seçim, genişlik) devralmaz. */
  const [runNo, setRunNo] = useState(0);
  /** Seçili sonuç sekmesinin ifade indeksi; yoksa ilk sonuç. */
  const [resultTab, setResultTab] = useState<number | null>(null);

  /**
   * `zorlaTransaction`: Okuma deseni yanıldı (25006); hata alan script (`metin`, editör sonradan
   * değişmiş olabilir) karar kartıyla Transaction modunda çalışır. Sunucu yine kendi analizini yapar.
   */
  function start(deneme: boolean, { zorlaTransaction = false, metin = script }: { zorlaTransaction?: boolean; metin?: string } = {}) {
    if (!targetRef || busy) return;
    // Analiz yazmanın gerisinde kalabilir; çalıştırmadan önce güncel metinle yeniden bakılır.
    const currentStatements = splitStatements(metin);
    const current = forceTransaction(analyzeScript(currentStatements), zorlaTransaction);
    if (runBlockReasons(metin, currentStatements, lock, { analysis: current, deneme }).length > 0) return;
    // Açık Okuma transaction'ı da bu soketle birlikte geri alınır.
    handle.current?.close();
    setRun(startRunView(metin, { deneme }));
    setRunOnProd(prod);
    setTab(deneme ? 'degisiklikler' : 'log');
    setRunNo((n) => n + 1);
    setResultTab(null);
    setDeadline(null);
    setPoolFullTabs([]);
    moreAsked.current.clear();
    // Sekmenin ilk çalıştırması (bu hedefin katalogu yoksa) katalogu ister.
    onCatalog?.('calistir');
    const runRequest = { target: targetRef, script: metin, yazmaModu: writeMode, deneme, ...(zorlaTransaction && { zorlaTransaction }) };
    handle.current = api.runScript(runRequest, (received) => {
      // Autocommit'te geri alınacak transaction yok; sunucu çalışan ifadeyi iptal eder.
      const event = received === CONNECTION_LOST && current.mod === 'autocommit' ? AUTOCOMMIT_CONNECTION_LOST : received;
      setRun((current) => (current ? applyEvent(current, event) : current));
      if (event.type === 'satirlar' || (event.type === 'uyari' && event.tur === 'dahaFazla')) moreAsked.current.delete(event.i);
      if (event.type === 'kararBekleniyor' || event.type === 'uzatildi' || event.type === 'okumaAcik') setDeadline(startDecision(event.kalanMs, Date.now()));
      if (event.type === 'bitti' && event.kod === 'havuzDolu') setPoolFullTabs(sessionTabsRef.current);
      if (event.type === 'bitti' && event.katalogYenilendi) onCatalogRef.current?.('tazelendi');
    });
  }

  /**
   * Grid sona yaklaştı: transaction açıksa ve sonucun devamı varsa bir sayfa daha istenir. Yanıt
   * gelene kadar aynı sonuç için ikinci istek gitmez (görünüm güncellenmeden gelen kaydırmalar dahil).
   */
  function fetchMore(i: number) {
    if (!run || !canFetchMore(run, i) || moreAsked.current.has(i)) return;
    moreAsked.current.add(i);
    handle.current?.send({ type: 'dahaFazla', i });
    setRun((current) => (current ? requestMore(current, i) : current));
  }

  function request(type: 'commit' | 'rollback' | 'uzat' | 'iptal') {
    handle.current?.send({ type });
    setRun((current) => (current ? { ...current, bekleyenIstek: type, uyari: undefined } : current));
  }

  // Satır işaretleri yalnızca editördeki metin çalıştırılanla aynıyken anlamlı.
  const marks = useMemo((): EditorMarks => {
    if (!run || run.script !== script) return analyzed === script ? analysisMarks(script, statements, analysis) : NO_MARKS;
    const lines = new Map<number, StatementStatus>();
    for (const s of run.ifadeler) {
      const existing = lines.get(s.satir);
      if (existing === undefined || PRIORITY[s.durum] > PRIORITY[existing]) lines.set(s.satir, s.durum);
    }
    const failed = run.ifadeler.find((s) => s.hata);
    return { lines, error: failed?.hata ? { bas: failed.hata.bas, bit: failed.hata.bit } : null };
  }, [run, script, analyzed, statements, analysis]);

  const goToLine = useCallback((line: number) => editor.current?.goToLine(line), []);
  /** Okuma'da karar kartı yok; yerinde ince bir durum satırı durur (ADR-0004). */
  const reading = run?.evre === 'okuma' || run?.sonuc === 'okuma';

  return (
    <div className="script-ekrani" hidden={hidden}>
      <section aria-label="Hedef" className={`hedef-basligi${prod ? ' prod' : ''}`}>
        {target ? (
          <>
            <span
              className="hedef-noktasi"
              data-testid="hedef-noktasi"
              style={{ backgroundColor: target.connection.color ?? 'transparent' }}
              aria-hidden="true"
            />
            <h2 className="hedef-adi">
              {target.connection.name} <span className="soluk">/</span> {target.database}
            </h2>
            {target.connection.envTag && (
              <span className="ortam-rozeti" style={{ backgroundColor: target.connection.color ?? undefined }}>
                {target.connection.envTag}
              </span>
            )}
            {lock && (
              <span title="Yazma kilidi" className={`kilit-rozeti ${lock}`}>
                {WRITE_LOCK_LABELS[lock].rozet}
              </span>
            )}
          </>
        ) : (
          <>
            <h2 className="hedef-adi soluk">Hedef seçilmedi</h2>
            <span className="soluk kucuk">Soldaki Veritabanı panelinden bir veritabanı seçin.</span>
          </>
        )}
        {target && <KatalogDugmesi catalog={catalog} onRefresh={() => onCatalog?.('yenile')} />}
        <button type="button" className="hedef-degistir" onClick={onChangeTarget}>
          hedefi değiştir ▾
        </button>
        <button type="button" className="kayit-klasoru" onClick={openHistoryFolder}>
          Çalıştırma kayıtları klasörünü aç
        </button>
        {folderError && (
          <span role="alert" className="uyari kucuk">
            {folderError}
          </span>
        )}
      </section>
      {analysis.mod === 'autocommit' && (
        <div role="note" aria-label="Autocommit uyarısı" className="uyari-seridi autocommit">
          ⚠ {analysis.transactionDisi.length} ifade anında kalıcı uygulanır, geri alınamaz
        </div>
      )}
      {runOnProd && run?.deneme && <DenemeProdUyarisi />}
      <div className="script-govde">
        <div className="script-sol">
          <section aria-label="Script editörü" className="editor-alani">
            <ScriptEditoru ref={editor} value={script} onChange={onScriptChange} readOnly={busy} marks={marks} completion={completion} />
          </section>
          {!busy && blocked && <BlockReasons reasons={reasons} />}
          <div className="script-cubugu">
            <span title="Çalıştırma modu" className={`mod-rozeti ${analysis.mod}`}>
              {MODE_LABELS[analysis.mod]}
            </span>
            {lock && (
              // Tek tık; onay, şerit ya da tema değişimi yok. Açık transaction'ın kilidi değişmez.
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
            {running ? (
              <button type="button" className="tehlikeli" onClick={() => request('iptal')} disabled={run.bekleyenIstek === 'iptal'}>
                ■ İptal
              </button>
            ) : (
              <>
                <button
                  type='button'
                  title={tryBlocked ? tryReasons.map(formatReason).join('\n') : 'Çalıştır ve her zaman geri al'}
                  onClick={() => start(true)}
                  disabled={!target || busy || !hasStatements || tryBlocked}
                >
                  ⟲ Dene
                </button>
                <button type="button" className="birincil" onClick={() => start(false)} disabled={!target || busy || !hasStatements || blocked}>
                  ▶ Çalıştır
                </button>
              </>
            )}
          </div>
          <Sonuclar run={run} runNo={runNo} selected={resultTab} onSelect={setResultTab} onMore={fetchMore} tipAdlari={tipAdlari} />
        </div>
        <aside aria-label="Çalıştırma" className="calistirma-sutunu">
          {run && reading ? (
            <OkumaDurumu run={run} deadline={run.evre === 'okuma' ? deadline : null} />
          ) : (
            <KararKarti
              run={run}
              deadline={run?.evre === 'karar' ? deadline : null}
              onRequest={request}
              poolFullTabs={poolFullTabs}
              onGoToTab={onGoToTab}
            />
          )}
          <div role="tablist" className="sekmeler">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === shownTab}
                className={`sekme${t === shownTab ? ' secili' : ''}`}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
          {shownTab === 'degisiklikler' && run ? (
            <div role="tabpanel" aria-label={TAB_LABELS.degisiklikler} className="ifade-listesi">
              <Degisiklikler run={run} />
            </div>
          ) : (
            <div role="tabpanel" aria-label={TAB_LABELS.log} className="ifade-listesi">
              {run ? (
                <ol className="ifade-kartlari">
                  {run.ifadeler.map((s) => (
                    <IfadeKarti
                      key={s.i}
                      statement={s}
                      onGoTo={goToLine}
                      onForceTransaction={busy ? undefined : () => start(false, { zorlaTransaction: true, metin: run.script })}
                    />
                  ))}
                </ol>
              ) : (
                <p className="soluk kucuk">Script çalıştırılınca ifadeler burada listelenir.</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** "↻": hedefin katalogunu yeniden okutur; durum düğmenin açıklamasında. */
function KatalogDugmesi({ catalog, onRefresh }: { catalog: CatalogEntry | undefined; onRefresh: () => void }) {
  const loading = catalog?.durum === 'yukleniyor';
  const title = !catalog
    ? 'Katalog okunmadı; tamamlama için yenileyin'
    : loading
      ? 'Katalog okunuyor…'
      : catalog.durum === 'hata'
        ? `Katalog okunamadı: ${catalog.hata}`
        : `Katalog: ${catalog.katalog.iliskiler.length} ilişki · yenile`;
  return (
    <button
      type="button"
      className={`ikon-dugme katalog-yenile${catalog?.durum === 'hata' ? ' hata' : ''}`}
      aria-label="Katalogu yenile"
      title={title}
      disabled={loading}
      onClick={onRefresh}
    >
      <span aria-hidden="true">↻</span>
    </button>
  );
}

/** Script neden çalıştırılamıyor: reddedilen ifadeler ve Karışık script. */
function BlockReasons({ reasons }: { reasons: ReturnType<typeof runBlockReasons> }) {
  return (
    <ul className="analiz-sorunlari kucuk">
      {reasons.map(({ satir, mesaj }) => (
        <li key={`${satir}:${mesaj}`}>{formatReason({ satir, mesaj })}</li>
      ))}
    </ul>
  );
}

function formatReason({ satir, mesaj }: { satir: number | null; mesaj: string }): string {
  return satir === null ? mesaj : `Satır ${satir}: ${mesaj}`;
}

/**
 * Okuma modunun durum satırı: karar sorulmaz; transaction yalnızca daha fazla satır için açıktır ve
 * Karar süresi dolunca, yeniden çalıştırınca ya da sekme kapanınca geri alınır.
 */
function OkumaDurumu({ run, deadline }: { run: RunView; deadline: DecisionTimer | null }) {
  const remaining = useCountdown(deadline);
  return (
    <section role="status" aria-label="Okuma durumu" className="okuma-durumu kucuk">
      {run.evre === 'okuma' ? (
        <span>
          Okuma · transaction açık
          {remaining && (
            <>
              {' '}
              · kalan{' '}
              <span role="timer" aria-label="Kalan süre">
                {formatRemaining(remaining.kalanMs)}
              </span>
            </>
          )}
        </span>
      ) : (
        <span>{resultText(run)}</span>
      )}
      {run.uyari && <span className="uyari">{run.uyari}</span>}
      {run.kayitUyarisi && <span className="uyari">⚠ {run.kayitUyarisi}</span>}
    </section>
  );
}


function IfadeKarti({
  statement: s,
  onGoTo,
  onForceTransaction,
}: {
  statement: StatementView;
  onGoTo: (line: number) => void;
  /** 25006 sonrası "Transaction modunda çalıştır"; çalıştırma sürerken yok. */
  onForceTransaction?: () => void;
}) {
  return (
    <li className={`ifade-karti ${s.durum}`}>
      <button type="button" className="ifade-karti-basligi" onClick={() => onGoTo(s.satir)}>
        <span className={`ifade-isareti ${s.durum}`} aria-hidden="true">
          {STATUS_SYMBOLS[s.durum]}
        </span>
        <span className="komut-etiketi">{s.komut}</span>
        <span className="soluk">satır {s.satir}</span>
        {s.ms !== undefined && <span className="soluk sure">{s.ms} ms</span>}
      </button>
      <StatementDetail statement={s} onForceTransaction={onForceTransaction} />
    </li>
  );
}

function StatementDetail({ statement: s, onForceTransaction }: { statement: StatementView; onForceTransaction?: () => void }) {
  switch (s.durum) {
    case 'sirada':
    case 'calisiyor':
    case 'calistirilmadi':
      return <p className="soluk kucuk">{STATUS_LABELS[s.durum]}</p>;
    case 'hatali':
      return (
        <>
          <p className="ifade-hatasi kucuk">
            {s.hata?.sqlstate && <code>{s.hata.sqlstate}</code>} {s.hata?.mesaj}
          </p>
          {s.hata?.ipucu && <p className="ifade-ipucu kucuk">{s.hata.ipucu}</p>}
          {s.hata?.transactionOnerisi && (
            <p className="ifade-ipucu kucuk">
              Okuma sanılan ifade yazmaya çalıştı.{' '}
              <button type="button" onClick={onForceTransaction} disabled={!onForceTransaction}>
                Transaction modunda çalıştır
              </button>
            </p>
          )}
        </>
      );
    case 'basarili':
      // Satırlar editörün altındaki sonuç sekmesinde; kartta yalnızca sayı.
      // Devamı olan sonucun toplamı bilinmez: yüklenenler "+" ile.
      if (s.onizleme) return <p className="kucuk">{s.rowCount ?? `${s.onizleme.satirlar.length}${s.onizleme.dahaVar ? '+' : ''}`} satır</p>;
      return s.rowCount === null || s.rowCount === undefined ? null : <p className="kucuk">{s.rowCount} satır etkilendi</p>;
  }
}

/**
 * Editörün altındaki sonuç sekmeleri: satır döndüren her ifadeye bir sekme. Yeni çalıştırmanın
 * görünümünde önizleme yoktur; eski sekmeler kendiliğinden silinir. Gizli sekmelerin grid'leri
 * (seçim, kolon genişliği) yerinde kalır. Sekme şeridi tek sekme durağıdır: oklar ve Home/End
 * sekme seçer.
 */
function Sonuclar({
  run,
  runNo,
  selected,
  onSelect,
  onMore,
  tipAdlari,
}: {
  run: RunView | null;
  runNo: number;
  selected: number | null;
  onSelect: (i: number) => void;
  /** `i`. sonucun grid'i yüklü satırların sonuna yaklaştı. */
  onMore: (i: number) => void;
  /** Katalogdan OID → tip adı ("INSERT olarak kopyala"). */
  tipAdlari?: ReadonlyMap<number, string>;
}) {
  const id = useId();
  const results = run?.ifadeler.filter((s) => s.onizleme && s.onizleme.kolonlar.length > 0) ?? [];
  const shown = results.find((s) => s.i === selected) ?? results[0];
  const tabId = (s: StatementView) => `${id}-sekme-${runNo}-${s.i}`;
  const panelId = (s: StatementView) => `${id}-panel-${runNo}-${s.i}`;

  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = results.indexOf(shown!);
    const last = results.length - 1;
    const to = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = results[to]!;
    onSelect(next.i);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <section aria-label="Sonuçlar" className={`sonuclar${shown ? '' : ' bos'}`}>
      {shown ? (
        <>
          <div role="tablist" aria-label="Sonuç sekmeleri" className="sekmeler sonuc-sekmeleri" onKeyDown={onTabKeyDown}>
            {results.map((s) => (
              <button
                key={s.i}
                id={tabId(s)}
                type="button"
                role="tab"
                aria-selected={s === shown}
                aria-controls={panelId(s)}
                tabIndex={s === shown ? 0 : -1}
                className={`sekme${s === shown ? ' secili' : ''}`}
                onClick={() => onSelect(s.i)}
              >
                {resultLabel(s)}
              </button>
            ))}
          </div>
          {results.map((s) => (
            <div key={`${runNo}:${s.i}`} id={panelId(s)} role="tabpanel" aria-labelledby={tabId(s)} className="sonuc-paneli" hidden={s !== shown}>
              <p className="kucuk soluk sonuc-ozeti">
                {resultSummary(s.onizleme!, s.rowCount)}
                {s.yukleniyor && <span> · Satırlar yükleniyor…</span>}
                {s.sinir && <span className="sonuc-notu"> · {ROW_LIMIT_MESSAGE}</span>}
                {s.devamKapandi && <span className="sonuc-notu"> · {s.devamKapandi}</span>}
              </p>
              <SonucGridi
                etiket={`${resultLabel(s)} sonucu`}
                kolonlar={s.onizleme!.kolonlar}
                tipler={s.onizleme!.tipler}
                tipAdlari={tipAdlari}
                satirlar={s.onizleme!.satirlar}
                toplamSatir={resultTotal(s.onizleme!, s.rowCount)}
                onSonaYaklasti={() => onMore(s.i)}
              />
            </div>
          ))}
        </>
      ) : (
        <p className="soluk kucuk">SELECT sonuçları burada açılır.</p>
      )}
    </section>
  );
}

function resultLabel(s: StatementView): string {
  return `${s.komut} · satır ${s.satir}`;
}
