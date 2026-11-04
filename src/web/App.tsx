import { useCallback, useEffect, useRef, useState } from 'react';
import type { Folder } from '../core/ayarlar';
import {
  isProd,
  type Connection,
  type DatabaseSelection,
  type PasswordWriteOutcome,
} from '../core/baglanti';
import { asksForSessionPassword, isPasswordRejected } from '../core/baglanti-testi';
import { buildConnectionUrl } from '../core/baglanti-url';
import { ApiError, connectionRequest, useApi } from './api/client';
import { HizliGecis, type PaletteCommand } from './hizli-gecis/HizliGecis';
import { BaglantiFormu } from './baglantilar/BaglantiFormu';
import { BaglantiListesi } from './baglantilar/BaglantiListesi';
import { KlasorAdi } from './baglantilar/KlasorAdi';
import { SifrePenceresi } from './baglantilar/SifrePenceresi';
import { SilmeOnayi } from './baglantilar/SilmeOnayi';
import { Menu, type MenuItem, type MenuPosition } from './ortak/Menu';
import { Onay } from './ortak/Onay';
import { ScriptEkrani } from './script/ScriptEkrani';
import {
  changesServerSession,
  defaultTargetDatabase,
  setDatabaseVisible,
  type Target,
} from '../core/veritabani-secimi';
import type { ConnectionSession } from './veritabanlari/hedef';
import { VeritabaniPaneli } from './veritabanlari/VeritabaniPaneli';

type Status = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error'; message: string };
/**
 * Çalışma alanında açık form: yeni bağlantı (paletten URL'le dolu açılabilir; `key` her URL'de yeni
 * ki form baştan kurulsun) ya da düzenlenen bağlantının kimliği.
 */
type Editing = { kind: 'yeni'; url?: { text: string; key: number } } | { kind: 'duzenle'; id: string } | null;
/** Alt+Enter ile kenar çubuğunda gösterilecek veritabanı; gösterilince temizlenir. */
type Reveal = Target;

/** Kısayolun platformdaki yazılışı. */
const PALETTE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
/** Açık klasör penceresi. */
type FolderDialog = { kind: 'yeni' } | { kind: 'yeniden-adlandir'; folder: Folder } | { kind: 'sil'; folder: Folder } | null;
/** Açık menü; `key` her açılışta değişir ki menü (alt menü durumu dahil) baştan kurulsun. */
type OpenMenu = MenuPosition & { key: number; label: string; items: MenuItem[] };
/** Açık şifre penceresi; `resolve` şifre verilince güncel bağlantıyla, iptalde `null` ile çağrılır. */
type PasswordPrompt = {
  /** Her soruşta yeni: kapanıp hemen yeniden açılan pencere (28P01) baştan kurulsun. */
  key: number;
  connection: Connection;
  rejection: string | null;
  resolve: (next: Connection | null) => void;
};

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
  /** Editörün hedefi; bağlanmadan da seçilebilir. */
  const [target, setTarget] = useState<Target | null>(null);
  /** Bağlantı kimliğine göre sunucu oturumu; olmayan bağlantı bağlı değildir. */
  const [sessions, setSessions] = useState<Record<string, ConnectionSession>>({});
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
  const promptCount = useRef(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const urlFormCount = useRef(0);
  /** Başka bir pencere (klasör, onay, şifre) açıkken kısayol paleti onun üstüne açmaz. */
  const dialogOpen = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!dialogOpen.current) setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  const selected = connections?.find((c) => c.id === selectedId);
  const targetConnection = target ? connections?.find((c) => c.id === target.connectionId) : undefined;
  const targetView = target && targetConnection ? { connection: targetConnection, database: target.database } : null;

  function open(next: Editing) {
    setNotice(null);
    setInfo(null);
    setEditing(next);
  }

  function setSession(id: string, session: ConnectionSession | null) {
    setSessions((prev) => {
      const { [id]: _old, ...rest } = prev;
      return session ? { ...rest, [id]: session } : rest;
    });
  }

  /**
   * Sunucu şifre istediyse ya da reddettiyse (`28P01`) ve şifre keychain'de tutulmuyorsa şifre
   * penceresini açar. Şifre verilince güncel bağlantıyı döndürür (istek yeniden denenir); pencere
   * açılmadıysa ya da iptal edildiyse `null`.
   */
  function askPassword(connection: Connection, err: unknown): Promise<Connection | null> {
    const kod = err instanceof ApiError ? err.body?.kod : undefined;
    if (!asksForSessionPassword(connection, kod)) return Promise.resolve(null);
    return new Promise((resolve) =>
      setPasswordPrompt({
        key: ++promptCount.current,
        connection,
        rejection: isPasswordRejected(kod) ? errorMessage(err) : null,
        resolve,
      }),
    );
  }

  async function submitPassword(prompt: PasswordPrompt, password: string, saveToKeychain: boolean): Promise<string | null> {
    try {
      const result = await api.giveSessionPassword(prompt.connection.id, { password, saveToKeychain });
      setConnections((list) => (list ?? []).map((c) => (c.id === result.connection.id ? result.connection : c)));
      setNotice(
        result.password === 'reddedildi'
          ? `Şifre keychain'e kaydedilemedi: ${KEYCHAIN_UNREACHABLE}. Tezgah kapanana kadar bellekte tutuluyor.`
          : null,
      );
      setPasswordPrompt(null);
      prompt.resolve(result.connection);
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  const cancelPassword = useCallback(() => {
    setPasswordPrompt((prompt) => {
      prompt?.resolve(null);
      return null;
    });
  }, []);

  /** Bağlan / yenile: başlangıç veritabanının pool'u üzerinden `pg_database` listesi. */
  async function connect(connection: Connection) {
    setSelectedId(connection.id);
    setSession(connection.id, { durum: 'baglaniyor' });
    let current = connection;
    for (;;) {
      try {
        const { veritabanlari } = await api.listDatabases(current.id);
        setSession(current.id, { durum: 'bagli', veritabanlari });
        return;
      } catch (err) {
        const next = await askPassword(current, err);
        if (next) {
          current = next;
          continue;
        }
        setSession(current.id, { durum: 'hata', hata: errorMessage(err) });
        return;
      }
    }
  }

  async function disconnect(connection: Connection) {
    try {
      await api.disconnect(connection.id);
      setSession(connection.id, null);
    } catch (err) {
      setNotice(`“${connection.name}” bağlantısı kesilemedi: ${errorMessage(err)}`);
    }
  }

  async function changeSelection(connection: Connection, selection: DatabaseSelection[]) {
    try {
      const updated = await api.updateDatabaseSelection(connection.id, selection);
      setConnections((list) => (list ?? []).map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setNotice(`Veritabanı seçimi kaydedilemedi: ${errorMessage(err)}`);
    }
  }

  /** Editörün hedefini değiştirmenin tek yolu (panel, menü, palet). */
  function chooseTarget(next: Target) {
    setTarget(next);
  }

  function selectTarget(connection: Connection, database: string) {
    chooseTarget({ connectionId: connection.id, database });
  }

  /** Paletten (gizli veritabanı, URL eşleşmesi): hedef olur; seçimde yoksa görünür yapılır. */
  function chooseAndShow(next: Target) {
    const connection = connections?.find((c) => c.id === next.connectionId);
    if (!connection) return;
    chooseTarget(next);
    if (!connection.databaseSelection.some((d) => d.database === next.database)) {
      void changeSelection(connection, setDatabaseVisible(connection.databaseSelection, next.database, true));
    }
  }

  /** Alt+Enter: bağlantı seçilir (klasörü açılır), veritabanı panelde odaklanır. */
  function revealInList(shown: Target) {
    setSelectedId(shown.connectionId);
    setReveal(shown);
  }

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const revealed = useCallback(() => setReveal(null), []);
  dialogOpen.current = folderDialog !== null || deleting !== null || passwordPrompt !== null;
  const paletteCommands: PaletteCommand[] = [
    { label: 'Yeni bağlantı', run: () => open({ kind: 'yeni' }) },
    { label: 'Yeni klasör', run: () => setFolderDialog({ kind: 'yeni' }) },
    { label: 'İçe aktar', disabled: true, hint: 'yakında', run: () => {} },
    { label: 'Çalıştırma kayıtları klasörünü aç', disabled: true, hint: 'yakında', run: () => {} },
  ];
  const serverDatabases = Object.fromEntries(
    Object.entries(sessions).flatMap(([id, s]) => (s.durum === 'bagli' ? [[id, s.veritabanlari]] : [])),
  );

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
    const before = connections?.find((c) => c.id === connection.id);
    // Sunucu bağlanma ayarı ya da şifresi değişen bağlantının pool'larını kapattı.
    if (before && (changesServerSession(before, connection) || password === 'kaydedildi' || password === 'silindi')) {
      setSession(connection.id, null);
    }
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
      if (target?.connectionId === connection.id) setTarget(null);
      setSession(connection.id, null);
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
    const targetDatabase = defaultTargetDatabase(connection);
    const session = sessions[connection.id];
    showMenu(`${connection.name} menüsü`, at, [
      {
        label: 'Hedef yap',
        disabled: targetDatabase === null,
        onSelect: () => {
          setSelectedId(connection.id);
          selectTarget(connection, targetDatabase!);
        },
      },
      {
        label: session?.durum === 'bagli' ? 'Yenile' : 'Bağlan',
        disabled: session?.durum === 'baglaniyor',
        onSelect: () => void connect(connection),
      },
      { label: 'Düzenle', onSelect: () => edit(connection.id) },
      { label: 'Kopyala', onSelect: () => void copy(connection) },
      { label: 'Klasöre taşı ▸', submenu: targets, disabled: folders.length === 0 },
      { label: 'URL’yi kopyala (şifresiz)', onSelect: () => void copyUrl(connection) },
      { label: 'Bağlantıyı kes', disabled: session === undefined, onSelect: () => void disconnect(connection) },
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
    <div className={`tezgah${targetConnection && isProd(targetConnection.envTag) ? ' prod-cerceve' : ''}`}>
      <aside className="kenar">
        <header className="kenar-baslik">
          <h1>Tezgah</h1>
          <button
            type="button"
            className="ikon-dugme kisayol-dugmesi"
            aria-label="Hızlı geçiş"
            title={`Hızlı geçiş (${PALETTE_SHORTCUT})`}
            onClick={() => setPaletteOpen(true)}
          >
            {PALETTE_SHORTCUT}
          </button>
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
              sessions={sessions}
              targetConnectionId={targetConnection?.id ?? null}
              onSelect={setSelectedId}
              onConnectionMenu={connectionMenu}
              onFolderMenu={folderMenu}
              onMove={(connection, folderId) => void move(connection, folderId)}
              revealId={reveal?.connectionId ?? null}
            />
          )}
        </nav>
        {selected && (
          <VeritabaniPaneli
            key={selected.id}
            connection={selected}
            session={sessions[selected.id]}
            target={target}
            reveal={reveal?.connectionId === selected.id ? reveal.database : null}
            onRevealed={revealed}
            onConnect={() => void connect(selected)}
            onPasswordNeeded={async (err) => (await askPassword(selected, err)) !== null}
            onSelectTarget={(database) => selectTarget(selected, database)}
            onSelectionChange={(selection) => void changeSelection(selected, selection)}
            onEdit={() => edit(selected.id)}
            onMenu={(at) => connectionMenu(selected, at)}
          />
        )}
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
        {editing?.kind === 'yeni' || edited ? (
          <BaglantiFormu
            key={edited?.id ?? (editing?.kind === 'yeni' && editing.url ? `url-${editing.url.key}` : 'yeni')}
            connection={edited ?? null}
            initialUrl={editing?.kind === 'yeni' ? editing.url?.text : undefined}
            folders={folders}
            onSaved={saved}
            onCancel={() => setEditing(null)}
            onDelete={setDeleting}
          />
        ) : (
          <ScriptEkrani target={targetView} onChangeTarget={() => setPaletteOpen(true)} />
        )}
      </main>
      {paletteOpen && (
        <HizliGecis
          connections={connections ?? []}
          serverDatabases={serverDatabases}
          target={target}
          commands={paletteCommands}
          onSelectTarget={chooseTarget}
          onSelectAndShow={chooseAndShow}
          onReveal={revealInList}
          onNewFromUrl={(text) => open({ kind: 'yeni', url: { text, key: ++urlFormCount.current } })}
          onClose={closePalette}
        />
      )}
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
      {passwordPrompt && (
        <SifrePenceresi
          key={passwordPrompt.key}
          connection={passwordPrompt.connection}
          rejection={passwordPrompt.rejection}
          onSubmit={(password, save) => submitPassword(passwordPrompt, password, save)}
          onCancel={cancelPassword}
        />
      )}
      {deleting && <SilmeOnayi connection={deleting} onConfirm={() => confirmDelete(deleting)} onCancel={cancelDelete} />}
    </div>
  );
}

function folderDeleteDescription(count: number): string {
  return count === 0 ? 'Klasör boş.' : `İçindeki ${count} bağlantı silinmez, Klasörsüz bölümüne taşınır.`;
}
