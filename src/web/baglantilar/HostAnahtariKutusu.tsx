import { useState } from 'react';
import type { HostKeyProblem } from '../../core/ssh-tuneli';

interface Props {
  problem: HostKeyProblem;
  /** `hostKeyUnknown`: güvenilebilir; `hostKeyMismatch`: devam yok, yalnızca unutmak. */
  kind: 'hostKeyUnknown' | 'hostKeyMismatch';
  /** "Güven ve tekrar dene": anahtar Tezgah'ın `known_hosts`'una yazılır, sonra işlem yeniden denenir. */
  onTrust: () => Promise<void>;
  /** "Kayıtlı host anahtarını unut" (yalnızca kayıt Tezgah'taysa). */
  onForget: () => Promise<void>;
  onCancel: () => void;
}

const address = ({ host, port }: HostKeyProblem) => (port === 22 ? host : `${host}:${port}`);

/**
 * Host anahtarı kutusu: bilinmeyen anahtarda SHA256 parmak izi ve "Güven ve tekrar dene" / "Vazgeç";
 * uyuşmazlıkta kayıtlı ve sunulan parmak izleri alt alta, devam seçeneği yok. Formda testin SSH
 * adımının altında, listeden bağlanırken pencere olarak kullanılır.
 */
export function HostAnahtariKutusu({ problem, kind, onTrust, onForget, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem yapılamadı');
    } finally {
      setBusy(false);
    }
  };

  if (kind === 'hostKeyUnknown') {
    return (
      <section role="group" aria-label="Bilinmeyen host anahtarı" className="host-anahtari">
        <p>
          <strong>{address(problem)}</strong> host anahtarı tanınmıyor. Parmak izini sunucu yöneticinizden ya da
          sunucudaki <code>ssh-keygen -lf</code> çıktısından doğrulayın.
        </p>
        <dl>
          <dt>{problem.tur}</dt>
          <dd>
            <code aria-label="Sunulan parmak izi">{problem.parmakIzi}</code>
          </dd>
        </dl>
        {problem.digerTurler.length > 0 && (
          <p className="uyari-satiri">Bu host için başka türde kayıtlı anahtar var: {problem.digerTurler.join(', ')}.</p>
        )}
        {error && (
          <p role="alert" className="alan-hatasi">
            {error}
          </p>
        )}
        <p className="host-anahtari-dugmeleri">
          <button type="button" className="birincil" disabled={busy} onClick={() => void act(onTrust)}>
            Güven ve tekrar dene
          </button>
          <button type="button" onClick={onCancel}>
            Vazgeç
          </button>
        </p>
      </section>
    );
  }

  return (
    <section role="group" aria-label="Host anahtarı uyuşmazlığı" className="host-anahtari tehlike">
      <p>
        <strong>{address(problem)}</strong>{' '}
        {problem.iptal ? 'host anahtarı iptal edilmiş (@revoked) olarak işaretli.' : 'host anahtarı kayıtlı anahtarla uyuşmuyor!'}{' '}
        Araya giren biri olabilir; bağlanılmadı.
      </p>
      <dl>
        {problem.kayitli.map((fp) => (
          <div key={fp}>
            <dt>Kayıtlı</dt>
            <dd>
              <code aria-label="Kayıtlı parmak izi">{fp}</code>
            </dd>
          </div>
        ))}
        <div>
          <dt>Sunulan</dt>
          <dd>
            <code aria-label="Sunulan parmak izi">{problem.parmakIzi}</code>
          </dd>
        </div>
      </dl>
      {problem.kaynak === 'kullanici' && (
        <p className="soluk">
          Kayıt <code>~/.ssh/known_hosts</code> dosyanızda; Tezgah o dosyayı değiştirmez. Anahtar gerçekten değiştiyse{' '}
          <code>ssh-keygen -R "{problem.port === 22 ? problem.host : `[${problem.host}]:${problem.port}`}"</code> ile silin.
        </p>
      )}
      {error && (
        <p role="alert" className="alan-hatasi">
          {error}
        </p>
      )}
      <p className="host-anahtari-dugmeleri">
        {problem.kaynak === 'tezgah' && (
          <button type="button" className="tehlikeli" disabled={busy} onClick={() => void act(onForget)}>
            Kayıtlı host anahtarını unut
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Kapat
        </button>
      </p>
    </section>
  );
}
