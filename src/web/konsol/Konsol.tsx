import { useCallback, useRef, useState } from 'react';
import { Onay } from '../ortak/Onay';
import type { Connection } from '../../core/baglanti';
import { sessionTabs, type ConsoleState, type OpenTab, type SessionTab, type TabTarget } from '../../core/konsol-sekmeleri';
import type { HistoryEntry } from '../../core/gecmis-filtresi';
import type { TableFilter } from '../../core/tablo-sayfasi';
import { GecmisPaneli } from '../gecmis/GecmisPaneli';
import { catalogKey, type CatalogEntry, type CatalogReason } from '../katalog/kataloglar';
import type { Target } from '../../core/veritabani-secimi';
import { ScriptEkrani } from '../script/ScriptEkrani';
import { TabloSekmesi } from '../tablo/TabloSekmesi';

interface Props {
  state: ConsoleState;
  connections: readonly Connection[];
  onActivate: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onScriptChange: (id: string, script: string) => void;
  /** Tablo sekmesinde uygulanan `WHERE` / `ORDER BY`. */
  onTableFilterChange: (id: string, filter: TableFilter) => void;
  onToggleWriteMode: (id: string) => void;
  /** Sekmenin hedef kilidinin nedeni değişti (`null`: hedef değiştirilebilir); sekme kapanınca `null`. */
  onTargetLockChange: (id: string, reason: string | null) => void;
  /** Hedef kilidi olan sekmeler (kimlik → neden): çalışan ya da karar bekleyen, yani açık oturumu olanlar. */
  targetLocks: Readonly<Record<string, string>>;
  /** Hedef başına katalog (bkz. `catalogKey`); aynı hedefteki sekmeler aynı kaydı görür. */
  catalogs: Readonly<Record<string, CatalogEntry>>;
  /** Sekme katalog istedi (ilk çalıştırma, ↻, DDL sonrası tazelendi). */
  onCatalog: (target: Target, reason: CatalogReason) => Promise<unknown>;
  /** "hedefi değiştir ▾": hızlı geçiş paletini açar. */
  onChangeTarget: () => void;
  /** Konsol gizli (ör. bağlantı formu açık); sekmeler ve açık transaction'ları korunur. */
  hidden?: boolean;
  /** Sorgu geçmişi paneli açık mı (Ctrl/Cmd+Alt+E). */
  historyOpen: boolean;
  onCloseHistory: () => void;
  /** Geçmişten çift tık: kaydın metni yeni sekmede, kaydın hedefiyle. */
  onOpenFromHistory: (entry: HistoryEntry) => void;
  /** Tablo sekmesinden "Konsola aktar": metin, verilen hedefte yeni konsol sekmesinde. */
  onOpenConsole: (hedef: TabTarget | null, metin: string) => void;
  /** Bu oturumda listeden açılan Tablo sekmeleri: ilk sayfa hemen çekilir (geri gelenler "Yükle" bekler). */
  autoLoadTabs?: ReadonlySet<string>;
}

/** Sekmenin hedefi: bağlantısı hâlâ varsa bağlantı + veritabanı. */
function resolveTarget(hedef: TabTarget | null, connections: readonly Connection[]) {
  const connection = hedef ? connections.find((c) => c.id === hedef.connectionId) : undefined;
  return connection && hedef ? { connection, database: hedef.database } : null;
}

function targetTitle(target: ReturnType<typeof resolveTarget>): string {
  return target ? `${target.connection.name} / ${target.database}` : 'Hedefsiz';
}

/** Şeritteki ad: konsol sekmesinde hedef, Tablo sekmesinde tablo adı. */
function tabTitle(tab: OpenTab, target: ReturnType<typeof resolveTarget>): { ad: string; ipucu: string } {
  const hedef = targetTitle(target);
  return tab.tur === 'tablo' ? { ad: tab.tablo, ipucu: `${hedef} · ${tab.sema}.${tab.tablo}` } : { ad: hedef, ipucu: hedef };
}

/**
 * Sekmeli konsol (ADR-0003): hedef başlığının üstünde sekme şeridi; her konsol sekmesi bir Script
 * editörüdür ve kendi çalıştırma oturumunu tutar. Tüm sekmeler açık kalır, yalnızca aktif olan
 * görünür: arkadaki sekmenin karar bekleyen transaction'ı korunur. Kapanan sekmenin ekranı
 * kaldırılır, çalıştırması kapanır ve transaction geri alınır (ADR-0002).
 */
export function Konsol({
  state,
  connections,
  onActivate,
  onNew,
  onClose,
  onScriptChange,
  onTableFilterChange,
  onToggleWriteMode,
  onTargetLockChange,
  targetLocks,
  catalogs,
  onCatalog,
  onChangeTarget,
  hidden = false,
  historyOpen,
  onCloseHistory,
  onOpenFromHistory,
  onOpenConsole,
  autoLoadTabs = new Set(),
}: Props) {
  const openSessions = new Set(Object.keys(targetLocks));
  const activeTarget = resolveTarget(state.tabs.find((t) => t.id === state.active)?.hedef ?? null, connections);
  /** Tablo sekmesi başına bekleyen değişiklik sayısı; diske yazılmaz. */
  const [pending, setPending] = useState<Readonly<Record<string, number>>>({});
  /** Bekleyen değişikliği olduğu için kapatılmadan önce sorulan sekme. */
  const [closing, setClosing] = useState<string | null>(null);
  // Sekme başına sabit geri çağrılar: sekmenin efektleri her çizimde yeniden çalışmasın.
  const lockChangers = useCallbacksById((id: string, reason: string | null) => onTargetLockChange(id, reason));
  const pendingChangers = useCallbacksById((id: string, count: number) =>
    setPending((p) => {
      if ((p[id] ?? 0) === count) return p;
      const { [id]: _old, ...rest } = p;
      return count === 0 ? rest : { ...rest, [id]: count };
    }),
  );
  const requestClose = (id: string) => ((pending[id] ?? 0) > 0 ? setClosing(id) : onClose(id));
  const closingTab = closing ? state.tabs.find((t) => t.id === closing) : undefined;
  return (
    <div className="konsol" hidden={hidden}>
      <div className="konsol-seridi">
        <div role="tablist" aria-label="Konsol sekmeleri" className="konsol-sekmeleri">
          {state.tabs.map((tab) => {
            const target = resolveTarget(tab.hedef, connections);
            const { ad: title, ipucu } = tabTitle(tab, target);
            const active = tab.id === state.active;
            return (
              <div key={tab.id} className={`konsol-sekmesi${active ? ' aktif' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="konsol-sekmesi-adi"
                  title={ipucu}
                  onClick={() => onActivate(tab.id)}
                >
                  <span
                    className="sekme-rengi"
                    data-testid="sekme-rengi"
                    style={{ backgroundColor: target?.connection.color ?? 'transparent' }}
                    aria-hidden="true"
                  />
                  {title}
                </button>
                <button
                  type="button"
                  className="ikon-dugme sekme-kapat"
                  aria-label={`${title} sekmesini kapat`}
                  title="Sekmeyi kapat"
                  onClick={() => requestClose(tab.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="ikon-dugme yeni-sekme" aria-label="Yeni sekme" title="Yeni sekme" onClick={onNew}>
          +
        </button>
      </div>
      <div className="konsol-govde">
        <div className="konsol-ekrani">
          {state.tabs.length === 0 && <p className="soluk kucuk bos-konsol">Açık sekme yok. “+” ile yeni bir konsol sekmesi açın.</p>}
          {state.tabs.map((tab) => {
            const target = resolveTarget(tab.hedef, connections);
            const key = target && catalogKey({ connectionId: target.connection.id, database: target.database });
            if (tab.tur === 'tablo') {
              return (
                <TabloSekmesi
                  key={tab.id}
                  tab={tab}
                  target={target}
                  autoLoad={autoLoadTabs.has(tab.id)}
                  catalog={key ? catalogs[key] : undefined}
                  onRefreshCatalog={() =>
                    target ? onCatalog({ connectionId: target.connection.id, database: target.database }, 'yenile') : Promise.resolve()
                  }
                  onFilterChange={(filter) => onTableFilterChange(tab.id, filter)}
                  writeMode={tab.yazmaModu}
                  onToggleWriteMode={() => onToggleWriteMode(tab.id)}
                  onTargetLockChange={lockChangers(tab.id)}
                  onPendingChange={pendingChangers(tab.id)}
                  onExportToConsole={(metin) => onOpenConsole(tab.hedef, metin)}
                  hidden={tab.id !== state.active}
                />
              );
            }
            return (
              <KonsolSekmesi
                key={tab.id}
                tab={tab}
                target={target}
                catalog={key ? catalogs[key] : undefined}
                onCatalog={onCatalog}
                hidden={tab.id !== state.active}
                sessionTabs={sessionTabs(state, tab.id, openSessions)}
                onActivate={onActivate}
                onScriptChange={onScriptChange}
                onToggleWriteMode={onToggleWriteMode}
                onTargetLockChange={onTargetLockChange}
                onChangeTarget={onChangeTarget}
              />
            );
          })}
        </div>
        {historyOpen && (
          <GecmisPaneli
            connections={connections}
            activeTarget={activeTarget && { connectionId: activeTarget.connection.id, database: activeTarget.database }}
            onOpen={onOpenFromHistory}
            onClose={onCloseHistory}
          />
        )}
      </div>
      {closingTab?.tur === 'tablo' && (
        <Onay
          title={`“${closingTab.tablo}” sekmesi kapatılsın mı?`}
          description={`${pending[closingTab.id] ?? 0} bekleyen değişiklik uygulanmadı; sekme kapanınca kaybolur.`}
          confirmLabel="Kapat"
          onConfirm={async () => {
            setClosing(null);
            onClose(closingTab.id);
          }}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  );
}

/** Kimlik başına bir kez kurulan, hep güncel `fn`'i çağıran geri çağrılar. */
function useCallbacksById<A extends unknown[]>(fn: (id: string, ...args: A) => void): (id: string) => (...args: A) => void {
  const latest = useRef(fn);
  latest.current = fn;
  const cache = useRef(new Map<string, (...args: A) => void>());
  return useCallback((id: string) => {
    let cb = cache.current.get(id);
    if (!cb) {
      cb = (...args: A) => latest.current(id, ...args);
      cache.current.set(id, cb);
    }
    return cb;
  }, []);
}

function KonsolSekmesi({
  tab,
  target,
  hidden,
  sessionTabs,
  catalog,
  onCatalog,
  onActivate,
  onScriptChange,
  onToggleWriteMode,
  onTargetLockChange,
  onChangeTarget,
}: {
  tab: OpenTab;
  target: ReturnType<typeof resolveTarget>;
  hidden: boolean;
  sessionTabs: SessionTab[];
  catalog: CatalogEntry | undefined;
  onCatalog: Props['onCatalog'];
} & Pick<Props, 'onActivate' | 'onScriptChange' | 'onToggleWriteMode' | 'onTargetLockChange' | 'onChangeTarget'>) {
  const { id } = tab;
  const lockChanged = useCallback((reason: string | null) => onTargetLockChange(id, reason), [id, onTargetLockChange]);
  const scriptChanged = useCallback((script: string) => onScriptChange(id, script), [id, onScriptChange]);
  const connectionId = target?.connection.id;
  const database = target?.database;
  const catalogWanted = useCallback(
    (reason: CatalogReason) => {
      if (connectionId !== undefined && database !== undefined) onCatalog({ connectionId, database }, reason);
    },
    [connectionId, database, onCatalog],
  );
  if (tab.tur !== 'konsol') return null;
  return (
    <ScriptEkrani
      target={target}
      onChangeTarget={onChangeTarget}
      onTargetLockChange={lockChanged}
      script={tab.metin}
      onScriptChange={scriptChanged}
      writeMode={tab.yazmaModu}
      onToggleWriteMode={() => onToggleWriteMode(id)}
      sessionTabs={sessionTabs}
      catalog={catalog}
      onCatalog={catalogWanted}
      onGoToTab={onActivate}
      hidden={hidden}
    />
  );
}
