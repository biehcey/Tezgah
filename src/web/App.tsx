import { useEffect, useState } from 'react';
import type { Connection, PasswordWriteOutcome } from '../core/baglanti';
import { ApiError, useApi } from './api/client';
import { BaglantiFormu } from './baglantilar/BaglantiFormu';
import { BaglantiListesi } from './baglantilar/BaglantiListesi';
import { SilmeOnayi } from './baglantilar/SilmeOnayi';

type Status = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error'; message: string };
/** Çalışma alanında açık form: yeni bağlantı ya da düzenlenen bağlantının kimliği. */
type Editing = { kind: 'yeni' } | { kind: 'duzenle'; id: string } | null;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) {
    return 'Oturum geçersiz: Tezgah yeniden başlatılmış olabilir. Terminaldeki adresi yeniden açın.';
  }
  if (err instanceof ApiError && err.body?.hata) return err.body.hata;
  return 'Tezgah sunucusuna ulaşılamıyor.';
}

// Reddedilen işlem yazma da silme de olabilir ("Keychain'e kaydet" kapatıldıysa). Kütüphane
// "Deny"ı kilitli depo gibi diğer erişim hatalarından ayırmadığı için mesaj ikisini de kapsar.
const SAVE_DENIED =
  "keychain'deki şifre güncellenemedi: keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli).";

export function App() {
  const api = useApi();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // İlk hata kalır: aynı nedenle düşen ikinci istek mesajı ezmesin.
    const fail = (err: unknown) =>
      active && setStatus((prev) => (prev.kind === 'error' ? prev : { kind: 'error', message: errorMessage(err) }));
    api.status().then(
      (s) => active && setStatus((prev) => (prev.kind === 'error' ? prev : { kind: 'ok', version: s.surum })),
      fail,
    );
    api.listConnections().then((list) => active && setConnections(list), fail);
    return () => {
      active = false;
    };
  }, [api]);

  const edited = editing?.kind === 'duzenle' ? connections?.find((c) => c.id === editing.id) : undefined;

  function open(next: Editing) {
    setNotice(null);
    setEditing(next);
  }

  function saved(connection: Connection, password: PasswordWriteOutcome) {
    setConnections((list) => {
      const current = list ?? [];
      return current.some((c) => c.id === connection.id)
        ? current.map((c) => (c.id === connection.id ? connection : c))
        : [...current, connection];
    });
    setSelectedId(connection.id);
    setEditing(null);
    setNotice(password === 'reddedildi' ? `“${connection.name}” kaydedildi ama ${SAVE_DENIED}` : null);
  }

  async function confirmDelete(connection: Connection) {
    try {
      const result = await api.deleteConnection(connection.id);
      setConnections((list) => (list ?? []).filter((c) => c.id !== connection.id));
      if (selectedId === connection.id) setSelectedId(null);
      setEditing(null);
      setNotice(
        result.password === 'reddedildi'
          ? `“${connection.name}” silindi ama keychain'e erişilemediği için şifresi keychain'de kaldı (service tezgah, hesap ${connection.id}).`
          : null,
      );
    } catch (err) {
      setNotice(`Silinemedi: ${errorMessage(err)}`);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="tezgah">
      <aside className="kenar">
        <header className="kenar-baslik">
          <h1>Tezgah</h1>
          <button
            type="button"
            className="ikon-dugme"
            aria-label="Yeni bağlantı"
            title="Yeni bağlantı"
            onClick={() => open({ kind: 'yeni' })}
          >
            +
          </button>
        </header>
        <nav aria-label="Bağlantılar" className="baglantilar">
          {connections && (
            <BaglantiListesi
              connections={connections}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                open({ kind: 'duzenle', id });
              }}
            />
          )}
        </nav>
        <footer className="kenar-alt">{status.kind === 'ok' && <span>v{status.version}</span>}</footer>
      </aside>
      <main className="calisma-alani">
        {status.kind === 'error' && (
          <p role="alert" className="uyari">
            {status.message}
          </p>
        )}
        {notice && (
          <p role="alert" className="uyari">
            {notice}
          </p>
        )}
        {(editing?.kind === 'yeni' || edited) && (
          <BaglantiFormu
            key={edited?.id ?? 'yeni'}
            connection={edited ?? null}
            onSaved={saved}
            onCancel={() => setEditing(null)}
            onDelete={setDeleting}
          />
        )}
      </main>
      {deleting && (
        <SilmeOnayi connection={deleting} onConfirm={() => confirmDelete(deleting)} onCancel={() => setDeleting(null)} />
      )}
    </div>
  );
}
