import { useCallback } from 'react';
import type { Connection } from '../../core/baglanti';
import { sessionTabs, type ConsoleState, type OpenTab, type SessionTab, type TabTarget } from '../../core/konsol-sekmeleri';
import type { HistoryEntry } from '../../core/gecmis-filtresi';
import { GecmisPaneli } from '../gecmis/GecmisPaneli';
import { ScriptEkrani } from '../script/ScriptEkrani';

interface Props {
  state: ConsoleState;
  connections: readonly Connection[];
  onActivate: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onScriptChange: (id: string, script: string) => void;
  onToggleWriteMode: (id: string) => void;
  /** Sekmenin hedef kilidinin nedeni değişti (`null`: hedef değiştirilebilir); sekme kapanınca `null`. */
  onTargetLockChange: (id: string, reason: string | null) => void;
  /** Hedef kilidi olan sekmeler (kimlik → neden): çalışan ya da karar bekleyen, yani açık oturumu olanlar. */
  targetLocks: Readonly<Record<string, string>>;
  /** "hedefi değiştir ▾": hızlı geçiş paletini açar. */
  onChangeTarget: () => void;
  /** Konsol gizli (ör. bağlantı formu açık); sekmeler ve açık transaction'ları korunur. */
  hidden?: boolean;
  /** Sorgu geçmişi paneli açık mı (Ctrl/Cmd+Alt+E). */
  historyOpen: boolean;
  onCloseHistory: () => void;
  /** Geçmişten çift tık: kaydın metni yeni sekmede, kaydın hedefiyle. */
  onOpenFromHistory: (entry: HistoryEntry) => void;
}

/** Sekmenin hedefi: bağlantısı hâlâ varsa bağlantı + veritabanı. */
function resolveTarget(hedef: TabTarget | null, connections: readonly Connection[]) {
  const connection = hedef ? connections.find((c) => c.id === hedef.connectionId) : undefined;
  return connection && hedef ? { connection, database: hedef.database } : null;
}

function tabTitle(target: ReturnType<typeof resolveTarget>): string {
  return target ? `${target.connection.name} / ${target.database}` : 'Hedefsiz';
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
  onToggleWriteMode,
  onTargetLockChange,
  targetLocks,
  onChangeTarget,
  hidden = false,
  historyOpen,
  onCloseHistory,
  onOpenFromHistory,
}: Props) {
  const openSessions = new Set(Object.keys(targetLocks));
  const activeTarget = resolveTarget(state.tabs.find((t) => t.id === state.active)?.hedef ?? null, connections);
  return (
    <div className="konsol" hidden={hidden}>
      <div className="konsol-seridi">
        <div role="tablist" aria-label="Konsol sekmeleri" className="konsol-sekmeleri">
          {state.tabs.map((tab) => {
            const target = resolveTarget(tab.hedef, connections);
            const title = tabTitle(target);
            const active = tab.id === state.active;
            return (
              <div key={tab.id} className={`konsol-sekmesi${active ? ' aktif' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="konsol-sekmesi-adi"
                  title={title}
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
                  onClick={() => onClose(tab.id)}
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
          {state.tabs.map((tab) => (
            <KonsolSekmesi
              key={tab.id}
              tab={tab}
              target={resolveTarget(tab.hedef, connections)}
              hidden={tab.id !== state.active}
              sessionTabs={sessionTabs(state, tab.id, openSessions)}
              onActivate={onActivate}
              onScriptChange={onScriptChange}
              onToggleWriteMode={onToggleWriteMode}
              onTargetLockChange={onTargetLockChange}
              onChangeTarget={onChangeTarget}
            />
          ))}
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
    </div>
  );
}

function KonsolSekmesi({
  tab,
  target,
  hidden,
  sessionTabs,
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
} & Pick<Props, 'onActivate' | 'onScriptChange' | 'onToggleWriteMode' | 'onTargetLockChange' | 'onChangeTarget'>) {
  const { id } = tab;
  const lockChanged = useCallback((reason: string | null) => onTargetLockChange(id, reason), [id, onTargetLockChange]);
  const scriptChanged = useCallback((script: string) => onScriptChange(id, script), [id, onScriptChange]);
  if (tab.tur !== 'konsol') {
    // Tablo sekmesi ticket 09'da gelir; kayıtlı olanı kaybetmemek için yalnızca yerinde tutulur.
    return (
      <p className="soluk kucuk" hidden={hidden}>
        {tab.sema}.{tab.tablo} Tablo sekmesi bu sürümde açılamıyor.
      </p>
    );
  }
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
      onGoToTab={onActivate}
      hidden={hidden}
    />
  );
}
