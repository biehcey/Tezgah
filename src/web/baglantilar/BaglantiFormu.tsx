import { useEffect, useId, useState, type FormEvent } from 'react';
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
import { ApiError, useApi, type ConnectionRequest } from '../api/client';

interface Props {
  /** Düzenlenen bağlantı; `null` ise yeni bağlantı. */
  connection: Connection | null;
  onSaved: (connection: Connection, password: PasswordWriteOutcome) => void;
  onCancel: () => void;
  onDelete: (connection: Connection) => void;
}

type Errors = Partial<Record<ConnectionField, string>> & { genel?: string };

/** Keychain'de kayıtlı şifrenin bilinen durumu. */
type StoredPassword = 'yukleniyor' | 'bulundu' | 'yok' | 'reddedildi' | 'bilinmiyor';

// Kütüphane "Deny"ı kilitli depo gibi diğer erişim hatalarından ayırmıyor; mesaj ikisini de kapsar.
const STORED_PASSWORD_NOTES: Partial<Record<StoredPassword, string>> = {
  reddedildi:
    "Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli); kayıtlı şifre okunamadı. Yeni şifre girerseniz keychain yeniden izin isteyebilir.",
  bilinmiyor: 'Keychain durumu alınamadı; kayıtlı şifre olup olmadığı bilinmiyor.',
};

/** Kısa tek sütun bağlantı formu (ticket 24 varyant C): şimdilik yalnızca Bağlantı bölümü. */
export function BaglantiFormu({ connection, onSaved, onCancel, onDelete }: Props) {
  const api = useApi();
  const id = useId();
  const [name, setName] = useState(connection?.name ?? '');
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

  function chooseTag(tag: EnvTag | null) {
    setEnvTag(tag);
    setColor(tag ? DEFAULT_ENV_COLORS[tag] : null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const request: ConnectionRequest = {
      name,
      folderId: connection?.folderId ?? null,
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
        {field('name', 'Ad', name, setName, { autoFocus: true })}
        <div className="alan-satiri">
          {field('host', 'Host', host, setHost, { spellCheck: false })}
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
