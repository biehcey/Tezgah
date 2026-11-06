import { useEffect, useId } from 'react';
import type { Folder } from '../../core/ayarlar';
import type { ImportApplyResponse } from '../../core/ice-aktarma/sozlesme';
import { TEST_ICONS, type ImportTestState } from '../../core/ice-aktarma/toplu-baglanti-testi';

interface Props {
  result: ImportApplyResponse;
  folders: Folder[];
  /** Toplu test yapılmıyorsa boş. */
  tests: Readonly<Record<string, ImportTestState>>;
  onOpenForm: (connectionId: string) => void;
  onClose: () => void;
}

/** İçe aktarmanın özeti: eklenenler, keychain'e yazılamayan şifreler, toplu test sonuçları. */
export function IceAktarmaSonucu({ result, folders, tests, onOpenForm, onClose }: Props) {
  const id = useId();
  const denied = result.added.filter((a) => a.password === 'reddedildi').map((a) => a.connection.name);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="perde">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-baslik`} className="diyalog ice-aktarma-sonucu">
        <h2 id={`${id}-baslik`}>İçe aktarma sonucu</h2>
        <p>
          {result.added.length} eklendi, {result.skipped} atlandı
        </p>
        {denied.length > 0 && (
          <p role="alert" className="uyari">
            şifre kaydedilemedi: {denied.join(', ')}; ilk bağlanmada sorulur
          </p>
        )}
        <ul className="duz-liste sonuc-listesi">
          {result.added.map(({ connection }) => {
            const test = tests[connection.id];
            const folder = folders.find((f) => f.id === connection.folderId)?.name ?? 'Klasörsüz';
            return (
              <li key={connection.id}>
                <span className="baglanti-adi">{connection.name}</span>
                <span className="soluk">{folder}</span>
                <span className="test-sonucu">
                  {test === 'bekliyor' && <span className="soluk">sırada</span>}
                  {test === 'calisiyor' && <span className="soluk">◌ test ediliyor</span>}
                  {typeof test === 'object' && (
                    <>
                      <span className={`durum test-${test.sonuc}`} aria-hidden="true">
                        {TEST_ICONS[test.sonuc]}
                      </span>{' '}
                      <span>{test.mesaj}</span>
                    </>
                  )}
                </span>
                <button type="button" onClick={() => onOpenForm(connection.id)}>
                  Formda aç
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="form-alt">
          <span className="bosluk" />
          <button type="button" className="birincil" onClick={onClose}>
            Kapat
          </button>
        </footer>
      </div>
    </div>
  );
}
