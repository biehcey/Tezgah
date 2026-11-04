import { useEffect, useId, useRef, useState } from 'react';
import type { Connection } from '../../core/baglanti';

interface Props {
  connection: Connection;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** Bağlantı silme onayı (ticket 25): ad yazdırma yok; Escape vazgeçer. */
export function SilmeOnayi({ connection, onConfirm, onCancel }: Props) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="perde">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-baslik`}
        aria-describedby={`${id}-aciklama`}
        className="diyalog"
      >
        <h2 id={`${id}-baslik`}>“{connection.name}” silinsin mi?</h2>
        <p id={`${id}-aciklama`}>
          Bağlantının ayarı ve keychain'deki sırları silinir. Çalıştırma kayıtları kalır. Bu işlem geri alınamaz.
        </p>
        <footer className="form-alt">
          <span className="bosluk" />
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Vazgeç
          </button>
          <button
            type="button"
            className="tehlikeli"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm();
            }}
          >
            Sil
          </button>
        </footer>
      </div>
    </div>
  );
}
