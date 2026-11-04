import type { Connection } from '../../core/baglanti';
import { Onay } from '../ortak/Onay';

interface Props {
  connection: Connection;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** Bağlantı silme onayı (ticket 25): ad yazdırma yok; Escape vazgeçer. */
export function SilmeOnayi({ connection, onConfirm, onCancel }: Props) {
  return (
    <Onay
      title={`“${connection.name}” silinsin mi?`}
      description="Bağlantının ayarı ve keychain'deki sırları silinir. Çalıştırma kayıtları kalır. Bu işlem geri alınamaz."
      confirmLabel="Sil"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
