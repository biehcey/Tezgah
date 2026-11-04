import { useState, type DragEvent } from 'react';
import type { Folder } from '../../core/ayarlar';
import { connectionAddress, isProd, type Connection } from '../../core/baglanti';
import { menuBelow, type MenuPosition } from '../ortak/Menu';
import type { ConnectionSession } from '../veritabanlari/hedef';

interface Props {
  connections: Connection[];
  folders: Folder[];
  selectedId: string | null;
  /** Bağlantı kimliğine göre sunucu oturumu; satırdaki durum ikonu buradan. */
  sessions: Readonly<Record<string, ConnectionSession>>;
  /** Hedefin bağlantısı; satırında "● hedef". */
  targetConnectionId: string | null;
  onSelect: (id: string) => void;
  onConnectionMenu: (connection: Connection, at: MenuPosition) => void;
  onFolderMenu: (folder: Folder, at: MenuPosition) => void;
  /** Sürükle-bırakla klasör değişimi; `null` Klasörsüz. */
  onMove: (connection: Connection, folderId: string | null) => void;
}

/** Sürüklenen bağlantının kimliğini taşıyan veri türü; başka sürüklemeler bırakılamaz. */
const DRAG_TYPE = 'application/x-tezgah-baglanti';
const UNFILED = 'klasorsuz';

const STATUS: Record<ConnectionSession['durum'], { icon: string; label: string }> = {
  baglaniyor: { icon: '◌', label: 'bağlanıyor' },
  bagli: { icon: '●', label: 'bağlı' },
  hata: { icon: '⚠', label: 'bağlanamadı' },
};

/** Kenar çubuğundaki bağlantı listesi: tek düzey klasörler, en altta Klasörsüz. */
export function BaglantiListesi({
  connections,
  folders,
  selectedId,
  sessions,
  targetConnectionId,
  onSelect,
  onConnectionMenu,
  onFolderMenu,
  onMove,
}: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  if (connections.length === 0 && folders.length === 0) {
    return <p className="bos-liste">Henüz bağlantı yok. Başlıktaki + ile ekleyin.</p>;
  }

  const rows = (list: Connection[]) => (
    <ul className="baglanti-listesi">
      {list.map((c) => {
        const session = sessions[c.id];
        const status = session && STATUS[session.durum];
        return (
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
              {session && status && (
                <span className={`durum durum-${session.durum}`} role="img" aria-label={status.label} title={status.label}>
                  {status.icon}
                </span>
              )}
              {c.id === targetConnectionId && <span className="hedef-isareti">● hedef</span>}
              <span className="baglanti-adresi">{connectionAddress(c)}</span>
            </button>
            <button
              type="button"
              className="satir-menusu"
              aria-label="Bağlantı menüsü"
              title="Bağlantı menüsü"
              aria-haspopup="menu"
              onClick={(e) => onConnectionMenu(c, menuBelow(e))}
            >
              ⋯
            </button>
          </li>
        );
      })}
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
