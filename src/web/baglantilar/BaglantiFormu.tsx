import { useEffect, useId, useState, type ClipboardEvent, type FormEvent } from 'react';
import type { Folder } from '../../core/ayarlar';
import {
  DEFAULT_DATABASE,
  DEFAULT_ENV_COLORS,
  DEFAULT_PORT,
  ENV_TAGS,
  isProd,
  parseConnectionInput,
  type Connection,
  type ConnectionField,
  type EnvTag,
  type PasswordWriteOutcome,
} from '../../core/baglanti';
import { URL_SSL_KEYS, isConnectionUrl, parseConnectionUrl, type UrlSsl } from '../../core/baglanti-url';
import { ApiError, useApi, type ConnectionRequest } from '../api/client';

interface Props {
  /** Düzenlenen bağlantı; `null` ise yeni bağlantı. */
  connection: Connection | null;
  folders: Folder[];
  onSaved: (connection: Connection, password: PasswordWriteOutcome) => void;
  onCancel: () => void;
  onDelete: (connection: Connection) => void;
}

type Errors = Partial<Record<ConnectionField, string>> & { genel?: string };

/** Son URL doldurmasında yok sayılan parametreler. */
interface UrlNote {
  ignored: string[];
}

/** Keychain'de kayıtlı şifrenin bilinen durumu. */
type StoredPassword = 'yukleniyor' | 'bulundu' | 'yok' | 'reddedildi' | 'bilinmiyor';

// Kütüphane "Deny"ı kilitli depo gibi diğer erişim hatalarından ayırmıyor; mesaj ikisini de kapsar.
const STORED_PASSWORD_NOTES: Partial<Record<StoredPassword, string>> = {
  reddedildi:
    "Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli); kayıtlı şifre okunamadı. Yeni şifre girerseniz keychain yeniden izin isteyebilir.",
  bilinmiyor: 'Keychain durumu alınamadı; kayıtlı şifre olup olmadığı bilinmiyor.',
};

/** Kısa tek sütun bağlantı formu (ticket 24 varyant C): şimdilik yalnızca Bağlantı bölümü. */
export function BaglantiFormu({ connection, folders, onSaved, onCancel, onDelete }: Props) {
  const api = useApi();
  const id = useId();
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlNote, setUrlNote] = useState<UrlNote | null>(null);
  /** URL'den gelen SSL parametreleri: SSL/TLS bölümü (ticket 05) gelene kadar formda tutulur, kaydedilmez. */
  const [ssl, setSsl] = useState<UrlSsl>({});
  const [name, setName] = useState(connection?.name ?? '');
  const [folderId, setFolderId] = useState<string | null>(connection?.folderId ?? null);
  // Form açıkken bağlantı listeden başka klasöre taşınırsa Kaydet onu eski klasörüne geri götürmesin.
  const savedFolderId = connection?.folderId ?? null;
  useEffect(() => setFolderId(savedFolderId), [savedFolderId]);
  const [host, setHost] = useState(connection?.host ?? '');
  const [port, setPort] = useState(String(connection?.port ?? DEFAULT_PORT));
  const [user, setUser] = useState(connection?.user ?? '');
  const [database, setDatabase] = useState(connection?.database ?? DEFAULT_DATABASE);
  const [envTag, setEnvTag] = useState<EnvTag | null>(connection?.envTag ?? null);
  const [color, setColor] = useState<string | null>(connection?.color ?? null);
  const [savePassword, setSavePassword] = useState(connection?.savePassword ?? true);
  const [password, setPassword] = useState('');
  const [stored, setStored] = useState<StoredPassword>(connection?.savePassword ? 'yukleniyor' : 'yok');
  /** "değiştir" tıklandı: kayıtlı şifre satırı yerine alan gösterilir. */
  const [changing, setChanging] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const connectionId = connection?.id;
  const checkKeychain = connection?.savePassword ?? false;
  useEffect(() => {
    if (!connectionId || !checkKeychain) return;
    let active = true;
    api.passwordStatus(connectionId).then(
      (s) => active && setStored(s.password),
      () => active && setStored('bilinmiyor'),
    );
    return () => {
      active = false;
    };
  }, [api, connectionId, checkKeychain]);

  /**
   * URL'i alanlara dağıtır; URL'in kendisi hiçbir yerde tutulmaz. URL'de olmayan alanlara dokunulmaz,
   * port ise URL'de yoksa varsayılandır. Reddedilirse nedeni URL alanının altında gösterilir.
   */
  function fillFromUrl(text: string): boolean {
    const parsed = parseConnectionUrl(text);
    if (!parsed.ok) {
      setUrlError(parsed.reason);
      setUrlNote(null);
      return false;
    }
    const { fields, ignored } = parsed;
    if (fields.host !== undefined) setHost(fields.host);
    setPort(String(fields.port ?? DEFAULT_PORT));
    if (fields.user !== undefined) setUser(fields.user);
    if (fields.database !== undefined) setDatabase(fields.database);
    if (fields.password !== undefined) {
      setPassword(fields.password);
      setChanging(true);
    }
    const ssl: UrlSsl = {};
    for (const key of URL_SSL_KEYS) if (fields[key] !== undefined) Object.assign(ssl, { [key]: fields[key] });
    setSsl(ssl);
    setUrl('');
    setUrlError(null);
    setUrlNote({ ignored });
    return true;
  }

  function pasteUrl(event: ClipboardEvent<HTMLInputElement>, { onlyUrls }: { onlyUrls: boolean }) {
    const text = event.clipboardData.getData('text/plain');
    if (onlyUrls && !isConnectionUrl(text)) return;
    // Başarılıysa metin hiçbir alana yazılmaz; reddedilirse neyin reddedildiği hatasıyla birlikte URL alanında görünür.
    if (fillFromUrl(text)) return event.preventDefault();
    if (onlyUrls) {
      event.preventDefault();
      setUrl(text);
    }
  }

  function chooseTag(tag: EnvTag | null) {
    setEnvTag(tag);
    setColor(tag ? DEFAULT_ENV_COLORS[tag] : null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const request: ConnectionRequest = {
      name,
      folderId,
      host,
      port: /^\d+$/.test(port.trim()) ? Number(port.trim()) : Number.NaN,
      user,
      database,
      envTag,
      color,
      savePassword,
    };
    // Boş alan kayıtlı şifreye dokunmaz; şifreyi keychain'den kaldırmanın yolu "Keychain'e kaydet"i kapatmak.
    if (savePassword && password !== '') request.password = password;

    const parsed = parseConnectionInput(request);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setSaving(true);
    try {
      const result = connection
        ? await api.updateConnection(connection.id, request)
        : await api.createConnection(request);
      onSaved(result.connection, result.password);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.body?.alanlar) setErrors(err.body.alanlar);
      else setErrors({ genel: err instanceof ApiError && err.body?.hata ? err.body.hata : 'Kaydedilemedi.' });
    }
  }

  const passwordRow: 'kapali' | 'yukleniyor' | 'kayitli' | 'alan' = !savePassword
    ? 'kapali'
    : stored === 'yukleniyor'
      ? 'yukleniyor'
      : stored === 'bulundu' && !changing
        ? 'kayitli'
        : 'alan';
  const passwordNote = savePassword ? STORED_PASSWORD_NOTES[stored] : undefined;

  const title = connection ? `Bağlantıyı düzenle: ${connection.name}` : 'Yeni bağlantı';
  const field = (key: ConnectionField, label: string, value: string, set: (v: string) => void, extra = {}) => (
    <div className="alan">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-${key}-hata` : undefined}
        {...extra}
      />
      {errors[key] && (
        <span id={`${id}-${key}-hata`} className="alan-hatasi">
          {errors[key]}
        </span>
      )}
    </div>
  );

  return (
    <form
      aria-label={title}
      className={`baglanti-formu${isProd(envTag) ? ' prod-cerceve' : ''}`}
      data-ortam={envTag ?? undefined}
      onSubmit={submit}
      noValidate
    >
      <header className="form-baslik">
        <span className="ortam-noktasi" style={{ backgroundColor: color ?? 'transparent' }} aria-hidden="true" />
        <h2>{connection ? connection.name : 'Yeni bağlantı'}</h2>
        {envTag && <span className={`ortam-rozeti${isProd(envTag) ? ' prod' : ''}`}>{envTag}</span>}
      </header>

      <fieldset className="bolum">
        <legend>Bağlantı</legend>
        <div className="alan">
          <label htmlFor={`${id}-url`}>URL</label>
          <input
            id={`${id}-url`}
            className="url-alani"
            value={url}
            placeholder="postgres://kullanıcı@host:5432/veritabanı yapıştırın"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => pasteUrl(e, { onlyUrls: false })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (url.trim()) fillFromUrl(url);
            }}
            onBlur={() => url.trim() && fillFromUrl(url)}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? `${id}-url-hata` : undefined}
          />
          {urlError && (
            <span id={`${id}-url-hata`} className="alan-hatasi">
              {urlError}
            </span>
          )}
          {urlNote && (
            <p role="status" className="url-ozeti">
              <span>URL’den dolduruldu.</span>
              {urlNote.ignored.length > 0 && <span> Yok sayıldı: {urlNote.ignored.join(', ')}.</span>}
              {Object.keys(ssl).length > 0 && (
                <span>
                  {' '}
                  SSL: {URL_SSL_KEYS.filter((k) => ssl[k] !== undefined)
                    .map((k) => `${k}=${ssl[k]}`)
                    .join(', ')}{' '}
                  (SSL/TLS ayarları henüz formda yok; kaydedilmez).
                </span>
              )}
            </p>
          )}
        </div>
        {field('name', 'Ad', name, setName, { autoFocus: true })}
        <div className="alan">
          <label htmlFor={`${id}-folder`}>Klasör</label>
          <select id={`${id}-folder`} value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
            <option value="">Klasörsüz</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="alan-satiri">
          {field('host', 'Host', host, setHost, { spellCheck: false, onPaste: (e: ClipboardEvent<HTMLInputElement>) => pasteUrl(e, { onlyUrls: true }) })}
          {field('port', 'Port', port, setPort, { inputMode: 'numeric', className: 'port' })}
        </div>
        {field('user', 'Kullanıcı', user, setUser, { spellCheck: false, autoComplete: 'off' })}

        <div className="alan">
          {passwordRow === 'kayitli' && (
            <>
              <span className="etiket">Şifre</span>
              <p className="keychain-kayitli">
                🔑 keychain'de kayıtlı ·{' '}
                <button type="button" className="baglanti-dugme" onClick={() => setChanging(true)}>
                  değiştir
                </button>
              </p>
            </>
          )}
          {passwordRow === 'yukleniyor' && (
            <>
              <span className="etiket">Şifre</span>
              <p className="soluk">Keychain denetleniyor…</p>
            </>
          )}
          {passwordRow === 'alan' && (
            <>
              <label htmlFor={`${id}-password`}>Şifre</label>
              <input
                id={`${id}-password`}
                type="password"
                autoComplete="new-password"
                autoFocus={changing}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={errors.password ? true : undefined}
              />
              {errors.password && <span className="alan-hatasi">{errors.password}</span>}
            </>
          )}
          {passwordNote && (
            <p role="status" className="uyari">
              {passwordNote}
            </p>
          )}
          <label className="kutu">
            <input type="checkbox" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
            Keychain'e kaydet
          </label>
          {!savePassword && (
            <p className="uyari-satiri">Şifre her açılışta ilk bağlanmada sorulur, yalnızca bellekte tutulur.</p>
          )}
        </div>

        {field('database', 'Başlangıç veritabanı', database, setDatabase, { spellCheck: false })}

        <div className="alan">
          <span className="etiket" id={`${id}-ortam`}>
            Ortam etiketi
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-ortam`} className="cipler">
            {[null, ...ENV_TAGS].map((tag) => (
              <label key={tag ?? 'yok'} className={`cip${envTag === tag ? ' secili' : ''}${isProd(tag) ? ' prod' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-ortam`}
                  checked={envTag === tag}
                  onChange={() => chooseTag(tag)}
                />
                {tag ?? 'yok'}
              </label>
            ))}
            <input
              type="color"
              aria-label="Renk"
              value={color ?? '#000000'}
              disabled={!envTag}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          {errors.envTag && <span className="alan-hatasi">{errors.envTag}</span>}
          {errors.color && <span className="alan-hatasi">{errors.color}</span>}
        </div>
      </fieldset>

      {(errors.genel || errors.folderId) && (
        <p role="alert" className="uyari">
          {errors.genel ?? errors.folderId}
        </p>
      )}

      <footer className="form-alt">
        {connection && (
          <button type="button" className="tehlikeli" onClick={() => onDelete(connection)}>
            Sil
          </button>
        )}
        <span className="bosluk" />
        <button type="button" onClick={onCancel}>
          İptal
        </button>
        <button type="submit" className="birincil" disabled={saving}>
          Kaydet
        </button>
      </footer>
    </form>
  );
}
