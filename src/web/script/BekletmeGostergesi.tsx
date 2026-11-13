import { useState } from 'react';
import { formatWait, orHidden, type BlockedSession } from '../../core/bekletme';

/**
 * "⚠ N oturumu bekletiyorsun": açık transaction'ın kilitle beklettiği oturumlar. Üzerine gelince
 * (ya da odaklanınca) liste açılır; yetkiden gelmeyen alanlar "görünmüyor" yazar. Liste boşsa yok.
 */
export function BekletmeGostergesi({ oturumlar }: { oturumlar: readonly BlockedSession[] | undefined }) {
  const [open, setOpen] = useState(false);
  if (!oturumlar?.length) return null;
  return (
    <span className="bekletme" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="bekletme-sayisi" aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        ⚠ {oturumlar.length} oturumu bekletiyorsun
      </button>
      {open && (
        <table aria-label="Bekletilen oturumlar" className="bekletme-listesi kucuk">
          <thead>
            <tr>
              <th>pid</th>
              <th>Kullanıcı</th>
              <th>Uygulama</th>
              <th>Bekleme</th>
              <th>Sorgu</th>
              <th>Süre</th>
            </tr>
          </thead>
          <tbody>
            {oturumlar.map((o) => (
              <tr key={o.pid}>
                <td>{o.pid}</td>
                <td>{orHidden(o.kullanici)}</td>
                <td>{orHidden(o.uygulama)}</td>
                <td>{orHidden(o.beklemeTuru)}</td>
                <td className="bekletme-sorgu">{orHidden(o.sorgu)}</td>
                <td>{formatWait(o.sureSn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </span>
  );
}
