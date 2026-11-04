import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  /** Seçilince menü bu öğelerle yer değiştirir (ör. "Klasöre taşı ▸"). */
  submenu?: MenuItem[];
  disabled?: boolean;
  danger?: boolean;
}

export interface MenuPosition {
  x: number;
  y: number;
}

interface Props extends MenuPosition {
  items: MenuItem[];
  label: string;
  onClose: () => void;
}

const WIDTH = 240;

/** Sağ tık / ⋯ menüsü. Escape ve dışarı tıklama kapatır; ok tuşları öğeler arasında gezer. */
export function Menu({ x, y, items: initial, label, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Açılıştaki öğeler; alt menü seçilince yer değiştirir. Yeni menü için bileşen yeniden kurulur (key).
  const [items, setItems] = useState(initial);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [items]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const enabled = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
    enabled[(next + enabled.length) % enabled.length]?.focus();
  }

  function choose(item: MenuItem) {
    if (item.submenu) return setItems(item.submenu);
    onClose();
    item.onSelect?.();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="menu"
      style={{ left: Math.max(0, Math.min(x, window.innerWidth - WIDTH)), top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={item.danger ? 'tehlikeli' : undefined}
          disabled={item.disabled}
          onClick={() => choose(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
