import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Connection } from '../../core/baglanti';
import {
  fuzzyScore,
  matchUrl,
  searchHiddenDatabases,
  searchTargets,
  type TargetItem,
} from '../../core/hizli-gecis';
import type { Target } from '../../core/veritabani-secimi';

/** Paletten çalıştırılan komut; henüz olmayanlar `disabled` ile pasif görünür. */
export interface PaletteCommand {
  label: string;
  disabled?: boolean;
  /** Pasif komutun yanındaki kısa not (ör. "yakında"). */
  hint?: string;
  run: () => void;
}

interface Props {
  connections: readonly Connection[];
  /** Bağlı bağlantıların `pg_database` listeleri (kimlik → veritabanları). */
  serverDatabases: Readonly<Record<string, readonly string[]>>;
  target: Target | null;
  commands: readonly PaletteCommand[];
  /** Enter: mevcut editörün hedefi olur. */
  onSelectTarget: (target: Target) => void;
  /** Enter, gizli veritabanında: görünür yapılır ve hedef olur. */
  onSelectHidden: (target: Target) => void;
  /** Alt+Enter: seçim kenar çubuğunda gösterilir. */
  onReveal: (target: Target) => void;
  /** "URL'den yeni bağlantı…": form URL'le dolu açılır. */
  onNewFromUrl: (url: string) => void;
  onClose: () => void;
}

interface Entry {
  key: string;
  label: string;
  disabled?: boolean;
  hint?: string;
  item?: TargetItem;
  run: () => void;
  reveal?: () => void;
}

interface Group {
  title: string;
  entries: Entry[];
}

/**
 * Cmd/Ctrl+K hızlı geçiş (ticket 25): tek arama kutusu, gruplu sonuçlar. ↵ hedefi değiştirir,
 * Alt+↵ listede gösterir; `postgres://` URL'i yapıştırınca aynı sunucuya giden bağlantılar.
 */
export function HizliGecis({
  connections,
  serverDatabases,
  target,
  commands,
  onSelectTarget,
  onSelectHidden,
  onReveal,
  onNewFromUrl,
  onClose,
}: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => {
      // Kapanınca odak paleti açan yere döner; yerine başka bir şey odaklandıysa ona dokunulmaz.
      if (previous instanceof HTMLElement && (document.activeElement === document.body || document.activeElement === null)) {
        previous.focus();
      }
    };
  }, []);

  const targetEntry = (item: TargetItem, select: (target: Target) => void): Entry => {
    const chosen = { connectionId: item.connectionId, database: item.database };
    return {
      key: `${item.connectionId}/${item.database}`,
      label: item.label,
      item,
      run: () => select(chosen),
      reveal: () => onReveal(chosen),
    };
  };

  const url = matchUrl(connections, query, target);
  const urlError = url && !url.ok ? url.reason : null;
  const groups: Group[] = [];
  if (url?.ok) {
    groups.push(
      { title: 'Bu sunucuya giden mevcut bağlantı', entries: url.matches.map((m) => targetEntry(m, onSelectTarget)) },
      { title: 'Komutlar', entries: [{ key: 'url', label: 'URL’den yeni bağlantı…', run: () => onNewFromUrl(query.trim()) }] },
    );
  } else if (!url) {
    groups.push(
      { title: 'Hedefler', entries: searchTargets(connections, query, target).map((t) => targetEntry(t, onSelectTarget)) },
      {
        title: 'Gizli veritabanları',
        entries: searchHiddenDatabases(connections, serverDatabases, query).map((t) => targetEntry(t, onSelectHidden)),
      },
      {
        title: 'Komutlar',
        entries: commands
          .filter((c) => fuzzyScore(query, c.label) !== null)
          .map((c) => ({ key: `komut/${c.label}`, label: c.label, disabled: c.disabled, hint: c.hint, run: c.run })),
      },
    );
  }
  const shown = groups.filter((g) => g.entries.length > 0);
  const enabled = shown.flatMap((g) => g.entries).filter((e) => !e.disabled);
  const current = enabled[Math.min(active, enabled.length - 1)];
  const optionId = (entry: Entry) => `${id}-${entry.key}`;

  function choose(entry: Entry | undefined, reveal: boolean) {
    if (!entry || entry.disabled) return;
    const action = reveal ? entry.reveal : entry.run;
    if (!action) return;
    onClose();
    action();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (enabled.length === 0) return;
      const index = current ? enabled.indexOf(current) : 0;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((index + step + enabled.length) % enabled.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(current, e.altKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="perde" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Hızlı geçiş" className="diyalog palet">
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Hedef, komut ya da postgres:// URL ara"
          aria-expanded="true"
          aria-controls={`${id}-liste`}
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-invalid={urlError ? true : undefined}
          className="palet-arama"
          placeholder="bağlantı / veritabanı, komut ya da postgres:// URL"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {urlError && (
          <p role="alert" className="palet-hatasi">
            Geçersiz URL: {urlError}
          </p>
        )}
        <div role="listbox" id={`${id}-liste`} aria-label="Sonuçlar" className="palet-listesi">
          {shown.map((g) => (
            <div key={g.title} role="group" aria-label={g.title} className="palet-grubu">
              <div className="palet-grup-basligi" aria-hidden="true">
                {g.title}
              </div>
              {g.entries.map((entry) => (
                <div
                  key={entry.key}
                  id={optionId(entry)}
                  role="option"
                  aria-selected={entry === current}
                  aria-disabled={entry.disabled ? true : undefined}
                  className={`palet-secenegi${entry.item?.prod ? ' prod' : ''}`}
                  onMouseMove={() => !entry.disabled && entry !== current && setActive(enabled.indexOf(entry))}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => choose(entry, e.altKey)}
                >
                  <span className="palet-etiketi">{entry.label}</span>
                  {entry.item?.prod && <span className="ortam-rozeti palet-rozeti">prod</span>}
                  {entry.item?.current && <span className="hedef-isareti">● hedef</span>}
                  {entry.hint && <span className="soluk kucuk">{entry.hint}</span>}
                </div>
              ))}
            </div>
          ))}
          {shown.length === 0 && !urlError && <p className="soluk kucuk palet-bos">Sonuç yok.</p>}
        </div>
        <footer className="palet-alt soluk kucuk">↵ hedef yap · Alt+↵ listede göster · Esc kapat</footer>
      </div>
    </div>
  );
}
