import { connectionAddress, isProd, type Connection } from '../../core/baglanti';

interface Props {
  connections: Connection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Kenar çubuğundaki bağlantı listesi (klasörler sonraki dilimde). */
export function BaglantiListesi({ connections, selectedId, onSelect }: Props) {
  if (connections.length === 0) {
    return <p className="bos-liste">Henüz bağlantı yok. Başlıktaki + ile ekleyin.</p>;
  }
  return (
    <ul className="baglanti-listesi">
      {connections.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={`baglanti-satiri${isProd(c.envTag) ? ' prod-serit' : ''}`}
            data-ortam={c.envTag ?? undefined}
            aria-current={c.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(c.id)}
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
        </li>
      ))}
    </ul>
  );
}
