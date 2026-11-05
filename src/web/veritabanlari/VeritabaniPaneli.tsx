import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Connection, DatabaseSelection } from '../../core/baglanti';
import {
  databasePanel,
  isTarget as isTargetOf,
  setDatabaseVisible,
  setSchemaVisible,
  visibleSchemas,
  type Target,
} from '../../core/veritabani-secimi';
import { ApiError, useApi } from '../api/client';
import { menuBelow, type MenuPosition } from '../ortak/Menu';
import type { ConnectionSession } from './hedef';

interface Props {
  connection: Connection;
  /** Bağlantının sunucu oturumu; bağlanılmadıysa `undefined`. */
  session: ConnectionSession | undefined;
  target: Target | null;
  /** Hedef değiştirilemiyorsa nedeni; satırlar pasif görünür ama odaklanabilir kalır. */
  targetLock?: string | null;
  /** Hızlı geçişte Alt+Enter: bu veritabanının satırı odaklanır. */
  reveal?: string | null;
  /** Gösterilecek satır odaklandı (ya da yok); gösterme bir kez yapılır. */
  onRevealed?: () => void;
  onConnect: () => void;
  /** Hedef şifre istedi ya da reddetti: şifre penceresi açılır; şifre verilirse `true` (istek yeniden denenir). */
  onPasswordNeeded: (err: unknown) => Promise<boolean>;
  onSelectTarget: (database: string) => void;
  onSelectionChange: (selection: DatabaseSelection[]) => void;
  onEdit: () => void;
  onMenu: (at: MenuPosition) => void;
}

type SchemaState = { kind: 'yukleniyor' } | { kind: 'tamam'; schemas: string[] } | { kind: 'hata'; message: string };

/**
 * Seçili bağlantının Veritabanı paneli: görünürler ⭐ ile üstte, şemaları açılıp kapanan çipler,
 * gizliler "Gizli (N)" altında. Bağlanmamışken kayıtlı seçim gösterilir; hedef yine seçilebilir.
 */
export function VeritabaniPaneli({
  connection,
  session,
  target,
  targetLock = null,
  reveal = null,
  onRevealed,
  onConnect,
  onPasswordNeeded,
  onSelectTarget,
  onSelectionChange,
  onEdit,
  onMenu,
}: Props) {
  const api = useApi();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [schemas, setSchemas] = useState<Record<string, SchemaState>>({});

  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reveal === null) return;
    const row = [...(sectionRef.current?.querySelectorAll<HTMLElement>('[data-veritabani]') ?? [])].find(
      (el) => el.dataset.veritabani === reveal,
    );
    row?.querySelector<HTMLElement>('.veritabani-adi, .yildiz')?.focus();
    onRevealed?.();
  }, [reveal, onRevealed]);

  const connected = session?.durum === 'bagli';
  const model = databasePanel(connection.databaseSelection, connected ? session.veritabanlari : null);
  const isTarget = (database: string) => isTargetOf(target, connection.id, database);

  function toggleSchemas(database: string) {
    const opening = !open.has(database);
    setOpen((prev) => {
      const next = new Set(prev);
      if (opening) next.add(database);
      else next.delete(database);
      return next;
    });
    if (opening && schemas[database]?.kind !== 'tamam') void loadSchemas(database);
  }

  async function loadSchemas(database: string) {
    setSchemas((prev) => ({ ...prev, [database]: { kind: 'yukleniyor' } }));
    try {
      const { semalar } = await api.listSchemas(connection.id, database);
      setSchemas((prev) => ({ ...prev, [database]: { kind: 'tamam', schemas: semalar } }));
    } catch (err) {
      if (await onPasswordNeeded(err)) return loadSchemas(database);
      const message = err instanceof ApiError && err.body?.hata ? err.body.hata : 'Şemalar listelenemedi.';
      setSchemas((prev) => ({ ...prev, [database]: { kind: 'hata', message } }));
    }
  }

  const star = (database: string, visible: boolean) => (
    <button
      type="button"
      className={`yildiz${visible ? '' : ' kapali'}`}
      aria-label={`${database} ${visible ? 'görünürlükten çıkar' : 'görünür yap'}`}
      title={visible ? 'Görünürlükten çıkar' : 'Görünür yap'}
      onClick={() => onSelectionChange(setDatabaseVisible(connection.databaseSelection, database, !visible))}
    >
      ⭐
    </button>
  );

  /** Görünür veritabanı satırı: ⭐, tıklayınca hedef olan ad, hedefse işaret; ardından ek içerik. */
  const visibleRow = (database: string, starControl: ReactNode, extra?: ReactNode) => (
    <li key={database} data-veritabani={database} className={`veritabani-satiri${isTarget(database) ? ' hedef' : ''}`}>
      {starControl}
      <button
        type="button"
        className="veritabani-adi"
        aria-current={isTarget(database) ? 'true' : undefined}
        aria-disabled={targetLock ? true : undefined}
        title={targetLock ? `Hedef değiştirilemez: ${targetLock}` : undefined}
        onClick={() => !targetLock && onSelectTarget(database)}
      >
        {database}
      </button>
      {isTarget(database) && <span className="hedef-isareti">● hedef</span>}
      {extra}
    </li>
  );

  const chips = (entry: DatabaseSelection) => {
    const state = schemas[entry.database];
    if (!state || state.kind === 'yukleniyor') return <p className="soluk kucuk sema-durumu">Şemalar yükleniyor…</p>;
    if (state.kind === 'hata') return <p className="uyari-metni kucuk sema-durumu">{state.message}</p>;
    const visible = visibleSchemas(entry, state.schemas);
    return (
      <div role="group" aria-label={`${entry.database} şemaları`} className="sema-cipleri">
        {state.schemas.map((schema) => {
          const on = visible.includes(schema);
          return (
            <button
              key={schema}
              type="button"
              className="sema-cipi"
              aria-pressed={on}
              onClick={() =>
                onSelectionChange(setSchemaVisible(connection.databaseSelection, entry.database, schema, !on, state.schemas))
              }
            >
              {schema}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <section ref={sectionRef} aria-label="Veritabanları" className="veritabani-paneli">
      <header className="panel-basligi">
        <span className="ortam-noktasi" style={{ backgroundColor: connection.color ?? 'transparent' }} aria-hidden="true" />
        <span className="panel-adi">{connection.name}</span>
        <span className="soluk kucuk">veritabanları</span>
        <span className="bosluk" />
        <button
          type="button"
          className="ikon-dugme"
          aria-label="Yenile"
          title="Yenile"
          disabled={session?.durum === 'baglaniyor'}
          onClick={onConnect}
        >
          ⟳
        </button>
        <button
          type="button"
          className="ikon-dugme"
          aria-label="Bağlantı menüsü"
          title="Bağlantı menüsü"
          aria-haspopup="menu"
          onClick={(e) => onMenu(menuBelow(e))}
        >
          ⋯
        </button>
      </header>

      {session?.durum === 'hata' && (
        <div role="alert" className="panel-hatasi">
          <p>⚠ {session.hata}</p>
          <div className="dugmeler">
            <button type="button" onClick={onConnect}>
              Tekrar dene
            </button>
            <button type="button" onClick={onEdit}>
              Düzenle
            </button>
          </div>
        </div>
      )}

      {!connected && (
        <>
          <p className="soluk kucuk panel-notu">Bağlı değil. Kayıtlı seçim:</p>
          <ul className="veritabani-listesi" aria-label="Görünür veritabanları">
            {model.visible.map((database) => visibleRow(database, <span aria-hidden="true">⭐</span>))}
          </ul>
          {model.visible.length === 0 && <p className="soluk kucuk panel-notu">Görünür veritabanı yok.</p>}
          {session?.durum !== 'hata' && (
            <div className="panel-notu">
              <button type="button" disabled={session?.durum === 'baglaniyor'} onClick={onConnect}>
                {session?.durum === 'baglaniyor' ? 'Bağlanıyor…' : 'Bağlan ve tüm veritabanlarını listele'}
              </button>
            </div>
          )}
        </>
      )}

      {connected && (
        <>
          <ul className="veritabani-listesi" aria-label="Görünür veritabanları">
            {connection.databaseSelection.map((entry) => {
              const expanded = open.has(entry.database);
              return visibleRow(
                entry.database,
                star(entry.database, true),
                <>
                  <button
                    type="button"
                    className="sema-ac"
                    aria-label={`${entry.database} şemaları`}
                    title="Şemalar"
                    aria-expanded={expanded}
                    onClick={() => toggleSchemas(entry.database)}
                  >
                    {expanded ? '▾' : '▸'} şemalar
                  </button>
                  {expanded && chips(entry)}
                </>,
              );
            })}
          </ul>
          {model.visible.length === 0 && <p className="soluk kucuk panel-notu">Görünür veritabanı yok; aşağıdan ⭐ ile seçin.</p>}
          {model.hidden !== null && model.hidden.length > 0 && (
            <>
              <h3 className="gizli-basligi">Gizli ({model.hidden.length})</h3>
              <ul className="veritabani-listesi gizli" aria-label="Gizli veritabanları">
                {model.hidden.map((database) => (
                  <li key={database} data-veritabani={database} className="veritabani-satiri">
                    {star(database, false)}
                    <span className="soluk">{database}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
