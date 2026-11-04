import { useCallback, useEffect, useState } from 'react';
import type { Folder } from '../core/ayarlar';
import type { Connection, PasswordWriteOutcome } from '../core/baglanti';
import { buildConnectionUrl } from '../core/baglanti-url';
import { ApiError, connectionRequest, useApi } from './api/client';
import { BaglantiFormu } from './baglantilar/BaglantiFormu';
import { BaglantiListesi } from './baglantilar/BaglantiListesi';
import { KlasorAdi } from './baglantilar/KlasorAdi';
import { SilmeOnayi } from './baglantilar/SilmeOnayi';
import { Menu, type MenuItem, type MenuPosition } from './ortak/Menu';
import { Onay } from './ortak/Onay';

type Status = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error'; message: string };
/** Çalışma alanında açık form: yeni bağlantı ya da düzenlenen bağlantının kimliği. */
type Editing = { kind: 'yeni' } | { kind: 'duzenle'; id: string } | null;
/** Açık klasör penceresi. */
type FolderDialog = { kind: 'yeni' } | { kind: 'yeniden-adlandir'; folder: Folder } | { kind: 'sil'; folder: Folder } | null;
/** Açık menü; `key` her açılışta değişir ki menü (alt menü durumu dahil) baştan kurulsun. */
type OpenMenu = MenuPosition & { key: number; label: string; items: MenuItem[] };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) {
    return 'Oturum geçersiz: Tezgah yeniden başlatılmış olabilir. Terminaldeki adresi yeniden açın.';
  }
  if (err instanceof ApiError && err.body?.hata) return err.body.hata;
  return 'Tezgah sunucusuna ulaşılamıyor.';
}

// Reddedilen işlem yazma da silme de olabilir ("Keychain'e kaydet" kapatıldıysa). Kütüphane
// "Deny"ı kilitli depo gibi diğer erişim hatalarından ayırmadığı için mesaj ikisini de kapsar.
const KEYCHAIN_UNREACHABLE = "keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli)";
const SAVE_DENIED = `keychain'deki şifre güncellenemedi: ${KEYCHAIN_UNREACHABLE}.`;

export function App() {
  const api = useApi();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Geçici bilgi satırı (ör. "URL kopyalandı"). */
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // İlk hata kalır: aynı nedenle düşen ikinci istek mesajı ezmesin.
    const fail = (err: unknown) =>
      active && setStatus((prev) => (prev.kind === 'error' ? prev : { kind: 'error', message: errorMessage(err) }));
    api.status().then(
      (s) => active && setStatus((prev) => (prev.kind === 'error' ? prev : { kind: 'ok', version: s.surum })),
      fail,
    );
    // Bağlantılar klasörleriyle birlikte gösterilir; liste bir an yanlış bölümlenmesin.
    Promise.all([api.listConnections(), api.listFolders()]).then(([list, folderList]) => {
      if (!active) return;
      setFolders(folderList);
      setConnections(list);
    }, fail);
    return () => {
      active = false;
    };
  }, [api]);

  const edited = editing?.kind === 'duzenle' ? connections?.find((c) => c.id === editing.id) : undefined;

  function open(next: Editing) {
    setNotice(null);
    setInfo(null);
    setEditing(next);
  }

  function edit(id: string) {
    setSelectedId(id);
    open({ kind: 'duzenle', id });
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeFolderDialog = useCallback(() => setFolderDialog(null), []);
  const cancelDelete = useCallback(() => setDeleting(null), []);

  function showMenu(label: string, at: MenuPosition, items: MenuItem[]) {
    setMenu((prev) => ({ ...at, label, items, key: (prev?.key ?? 0) + 1 }));
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

  async function move(connection: Connection, folderId: string | null) {
    try {
      const result = await api.updateConnection(connection.id, { ...connectionRequest(connection), folderId });
      setConnections((list) => (list ?? []).map((c) => (c.id === connection.id ? result.connection : c)));
    } catch (err) {
      setNotice(`“${connection.name}” taşınamadı: ${errorMessage(err)}`);
    }
  }

  /** Kopya kaynağın hemen arkasında oluşur ve formu açılır. */
  async function copy(source: Connection) {
    try {
      const { connection, password } = await api.copyConnection(source.id);
      setConnections((list) => {
        const current = [...(list ?? [])];
        current.splice(current.findIndex((c) => c.id === source.id) + 1, 0, connection);
        return current;
      });
      edit(connection.id);
      if (password === 'reddedildi') {
        setNotice(
          `“${connection.name}” oluşturuldu ama şifre kopyalanamadı: ${KEYCHAIN_UNREACHABLE}. Şifreyi formda yeniden girin.`,
        );
      }
    } catch (err) {
      setNotice(`Kopyalanamadı: ${errorMessage(err)}`);
    }
  }

  async function copyUrl(connection: Connection) {
    const url = buildConnectionUrl(connection);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(null);
      setInfo(`URL kopyalandı: ${url}`);
    } catch {
      setInfo(null);
      setNotice(`URL panoya kopyalanamadı: ${url}`);
    }
  }

  function connectionMenu(connection: Connection, at: MenuPosition) {
    const targets: MenuItem[] = [
      ...folders.map((f) => ({
        label: f.name,
        disabled: connection.folderId === f.id,
        onSelect: () => void move(connection, f.id),
      })),
      { label: 'Klasörsüz', disabled: connection.folderId === null, onSelect: () => void move(connection, null) },
    ];
    showMenu(`${connection.name} menüsü`, at, [
      { label: 'Düzenle', onSelect: () => edit(connection.id) },
      { label: 'Kopyala', onSelect: () => void copy(connection) },
      { label: 'Klasöre taşı ▸', submenu: targets, disabled: folders.length === 0 },
      { label: 'URL’yi kopyala (şifresiz)', onSelect: () => void copyUrl(connection) },
      { label: 'Sil', danger: true, onSelect: () => setDeleting(connection) },
    ]);
  }

  function folderMenu(folder: Folder, at: MenuPosition) {
    showMenu(`${folder.name} klasör menüsü`, at, [
      { label: 'Yeniden adlandır', onSelect: () => setFolderDialog({ kind: 'yeniden-adlandir', folder }) },
      { label: 'Sil', danger: true, onSelect: () => setFolderDialog({ kind: 'sil', folder }) },
    ]);
  }

  async function submitFolderName(name: string): Promise<string | null> {
    if (!folderDialog || folderDialog.kind === 'sil') return null;
    try {
      if (folderDialog.kind === 'yeni') {
        const created = await api.createFolder(name);
        setFolders((list) => [...list, created]);
      } else {
        const renamed = await api.renameFolder(folderDialog.folder.id, name);
        setFolders((list) => list.map((f) => (f.id === renamed.id ? renamed : f)));
      }
      setFolderDialog(null);
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  async function confirmFolderDelete(folder: Folder) {
    try {
      await api.deleteFolder(folder.id);
      setFolders((list) => list.filter((f) => f.id !== folder.id));
      setConnections((list) => (list ?? []).map((c) => (c.folderId === folder.id ? { ...c, folderId: null } : c)));
    } catch (err) {
      setNotice(`Klasör silinemedi: ${errorMessage(err)}`);
    } finally {
      setFolderDialog(null);
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
            aria-label="Yeni klasör"
            title="Yeni klasör"
            onClick={() => setFolderDialog({ kind: 'yeni' })}
          >
            <span aria-hidden="true">⊞</span>
          </button>
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
              folders={folders}
              selectedId={selectedId}
              onSelect={edit}
              onConnectionMenu={connectionMenu}
              onFolderMenu={folderMenu}
              onMove={(connection, folderId) => void move(connection, folderId)}
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
        {info && (
          <p role="status" className="bilgi">
            {info}
          </p>
        )}
        {(editing?.kind === 'yeni' || edited) && (
          <BaglantiFormu
            key={edited?.id ?? 'yeni'}
            connection={edited ?? null}
            folders={folders}
            onSaved={saved}
            onCancel={() => setEditing(null)}
            onDelete={setDeleting}
          />
        )}
      </main>
      {menu && <Menu key={menu.key} x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={closeMenu} />}
      {folderDialog && folderDialog.kind !== 'sil' && (
        <KlasorAdi
          title={folderDialog.kind === 'yeni' ? 'Yeni klasör' : 'Klasörü yeniden adlandır'}
          initial={folderDialog.kind === 'yeni' ? '' : folderDialog.folder.name}
          submitLabel={folderDialog.kind === 'yeni' ? 'Oluştur' : 'Kaydet'}
          onSubmit={submitFolderName}
          onCancel={closeFolderDialog}
        />
      )}
      {folderDialog?.kind === 'sil' && (
        <Onay
          title={`“${folderDialog.folder.name}” klasörü silinsin mi?`}
          description={folderDeleteDescription(
            (connections ?? []).filter((c) => c.folderId === folderDialog.folder.id).length,
          )}
          confirmLabel="Sil"
          onConfirm={() => confirmFolderDelete(folderDialog.folder)}
          onCancel={closeFolderDialog}
        />
      )}
      {deleting && <SilmeOnayi connection={deleting} onConfirm={() => confirmDelete(deleting)} onCancel={cancelDelete} />}
    </div>
  );
}

function folderDeleteDescription(count: number): string {
  return count === 0 ? 'Klasör boş.' : `İçindeki ${count} bağlantı silinmez, Klasörsüz bölümüne taşınır.`;
}
