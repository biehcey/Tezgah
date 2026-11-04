import { useEffect, useState } from 'react';
import { ApiError, useApi } from './api/client';

type Status = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error'; message: string };

export function App() {
  const api = useApi();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    api.status().then(
      (s) => active && setStatus({ kind: 'ok', version: s.surum }),
      (err: unknown) =>
        active &&
        setStatus({
          kind: 'error',
          message:
            err instanceof ApiError && err.status === 401
              ? 'Oturum geçersiz: Tezgah yeniden başlatılmış olabilir. Terminaldeki adresi yeniden açın.'
              : 'Tezgah sunucusuna ulaşılamıyor.',
        }),
    );
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <div className="tezgah">
      <aside className="kenar">
        <header className="kenar-baslik">
          <h1>Tezgah</h1>
        </header>
        <nav aria-label="Bağlantılar" className="baglantilar" />
        <footer className="kenar-alt">{status.kind === 'ok' && <span>v{status.version}</span>}</footer>
      </aside>
      <main className="calisma-alani">
        {status.kind === 'error' && (
          <p role="alert" className="uyari">
            {status.message}
          </p>
        )}
      </main>
    </div>
  );
}
