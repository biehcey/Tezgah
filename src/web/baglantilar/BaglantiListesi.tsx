import { useState, type DragEvent, type MouseEvent } from 'react';
import type { Folder } from '../../core/ayarlar';
import { connectionAddress, isProd, type Connection } from '../../core/baglanti';
import type { MenuPosition } from '../ortak/Menu';

interface Props {
  connections: Connection[];
  folders: Folder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConnectionMenu: (connection: Connection, at: MenuPosition) => void;
  onFolderMenu: (folder: Folder, at: MenuPosition) => void;
  /** Sürükle-bırakla klasör değişimi; `null` Klasörsüz. */
  onMove: (connection: Connection, folderId: string | null) => void;
}

/** Sürüklenen bağlantının kimliğini taşıyan veri türü; başka sürüklemeler bırakılamaz. */
const DRAG_TYPE = 'application/x-tezgah-baglanti';
const UNFILED = 'klasorsuz';

/** Kenar çubuğundaki bağlantı listesi: tek düzey klasörler, en altta Klasörsüz. */
export function BaglantiListesi({ connections, folders, selectedId, onSelect, onConnectionMenu, onFolderMenu, onMove }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  if (connections.length === 0 && folders.length === 0) {
    return <p className="bos-liste">Henüz bağlantı yok. Başlıktaki + ile ekleyin.</p>;
  }

  const rows = (list: Connection[]) => (
    <ul className="baglanti-listesi">
      {list.map((c) => (
        <li key={c.id} className="baglanti-ogesi">
          <button
            type="button"
            className={`baglanti-satiri${isProd(c.envTag) ? ' prod-serit' : ''}`}
            data-ortam={c.envTag ?? undefined}
            aria-current={c.id === selectedId ? 'true' : undefined}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, c.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDropTarget(null)}
            onClick={() => onSelect(c.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onConnectionMenu(c, { x: e.clientX, y: e.clientY });
            }}
          >
            <span
              className="ortam-noktasi"
              data-testid="ortam-noktasi"
              style={{ backgroundColor: c.color ?? 'transparent' }}
              aria-hidden="true"
            />
            <span className="baglanti-adi">{c.name}</span>
            <span className="baglanti-adresi">{connectionAddress(c)}</span>
          </button>
          <button
            type="button"
            className="satir-menusu"
            aria-label="Bağlantı menüsü"
            title="Bağlantı menüsü"
            aria-haspopup="menu"
            onClick={(e) => onConnectionMenu(c, below(e))}
          >
            ⋯
          </button>
        </li>
      ))}
    </ul>
  );

  if (folders.length === 0) return rows(connections);

  const section = (key: string, name: string, folderId: string | null, folder?: Folder) => {
    const list = connections.filter((c) => c.folderId === folderId);
    const open = !collapsed.has(key);
    const accepts = (e: DragEvent) => [...e.dataTransfer.types].includes(DRAG_TYPE);
    return (
      <section
        key={key}
        aria-label={name}
        className={`klasor${dropTarget === key ? ' birakilacak' : ''}`}
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropTarget(key);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onDrop={(e) => {
          setDropTarget(null);
          const moved = connections.find((c) => c.id === e.dataTransfer.getData(DRAG_TYPE));
          if (!moved) return;
          e.preventDefault();
          if (moved.folderId !== folderId) onMove(moved, folderId);
        }}
      >
        <button
          type="button"
          className="klasor-basligi"
          aria-expanded={open}
          onClick={() =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (open) next.add(key);
              else next.delete(key);
              return next;
            })
          }
          onContextMenu={
            folder &&
            ((e) => {
              e.preventDefault();
              onFolderMenu(folder, { x: e.clientX, y: e.clientY });
            })
          }
        >
          <span className="ok" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="klasor-adi">{name}</span>
          <span className="sayi">{list.length}</span>
        </button>
        {open && rows(list)}
      </section>
    );
  };

  return (
    <>
      {folders.map((f) => section(f.id, f.name, f.id, f))}
      {section(UNFILED, 'Klasörsüz', null)}
    </>
  );
}

function below(e: MouseEvent<HTMLElement>): MenuPosition {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}
