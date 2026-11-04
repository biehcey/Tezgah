import { useEffect, useId, useState, type ClipboardEvent, type FormEvent } from 'react';
import type { Folder } from '../../core/ayarlar';
import {
  DEFAULT_DATABASE,
  DEFAULT_SSL,
  SSL_PATH_FIELDS,
  isSslPathField,
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
import { parseConnectionTestInput, type FixId, type TestField } from '../../core/baglanti-testi';
import { isConnectionUrl, parseConnectionUrl } from '../../core/baglanti-url';
import { ApiError, useApi, type ConnectionRequest, type ConnectionTestBody } from '../api/client';
import { SslBolumu, sslForm, sslSettings, type SslForm } from './SslBolumu';
import { TestAdimlari, TestOzeti, type TestState } from './TestSonucu';

interface Props {
  /** Düzenlenen bağlantı; `null` ise yeni bağlantı. */
  connection: Connection | null;
  folders: Folder[];
  onSaved: (connection: Connection, password: PasswordWriteOutcome) => void;
  onCancel: () => void;
  onDelete: (connection: Connection) => void;
}

type Errors = Partial<Record<ConnectionField, string>> & { genel?: string };

/** Düzeltme düğmesinin götürdüğü alan. */
const FIX_FIELDS: Partial<Record<FixId, TestField>> = {
  hostuDuzelt: 'host',
  portuDuzelt: 'port',
  kullaniciyiDuzelt: 'user',
  sifreyiDuzelt: 'password',
  sifreGir: 'password',
  veritabaniniDuzelt: 'database',
  caDosyasiSec: 'sslrootcert',
};

const SSL_ERROR_FIELDS = ['sslmode', ...SSL_PATH_FIELDS] as const;

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

/** Kısa tek sütun bağlantı formu (ticket 24 varyant C): Bağlantı ve katlanır SSL/TLS bölümleri. */
export function BaglantiFormu({ connection, folders, onSaved, onCancel, onDelete }: Props) {
  const api = useApi();
  const id = useId();
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlNote, setUrlNote] = useState<UrlNote | null>(null);
  const [ssl, setSsl] = useState<SslForm>(() => sslForm(connection ?? DEFAULT_SSL));
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
  const [testState, setTestState] = useState<TestState | null>(null);
  /** Son testin sorumlu tuttuğu alan; düzenlenince kırmızılığı kalkar. */
  const [testField, setTestField] = useState<TestField | null>(null);
  const [sslOpen, setSslOpen] = useState(false);
  /** Düzeltme düğmesinin odaklayacağı alan (alan önce görünür olmalı, ör. şifre). */
  const [focusField, setFocusField] = useState<TestField | null>(null);
  useEffect(() => {
    if (!focusField) return;
    const input = document.getElementById(`${id}-${focusField}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
    setFocusField(null);
  }, [focusField, id]);

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
    // sslmode da port gibi: URL'de yoksa libpq varsayılanı; dosya yolları yalnızca URL'de varsa.
    setSsl((current) => ({
      sslmode: fields.sslmode ?? DEFAULT_SSL.sslmode,
      sslrootcert: fields.sslrootcert ?? current.sslrootcert,
      sslcert: fields.sslcert ?? current.sslcert,
      sslkey: fields.sslkey ?? current.sslkey,
    }));
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

  /** Alan hataları SSL bölümündeyse bölüm açılır. */
  function showErrors(next: Errors) {
    setErrors(next);
    if (SSL_ERROR_FIELDS.some((f) => next[f])) setSslOpen(true);
  }

  /** Formdaki kaydedilmemiş değerlerle test; hiçbir şey kaydedilmez. */
  async function runTest(overrides: Partial<ConnectionTestBody> = {}) {
    const body: ConnectionTestBody = {
      connectionId: connection?.id ?? null,
      host,
      port: /^\d+$/.test(port.trim()) ? Number(port.trim()) : Number.NaN,
      user,
      database,
      savePassword,
      ...sslSettings(ssl),
      ...overrides,
    };
    // Kaydet'teki gibi: boş alan kayıtlı şifreyi kullanır (sunucu keychain'den okur).
    if (password !== '' && body.password === undefined) body.password = password;
    const parsed = parseConnectionTestInput(body);
    if (!parsed.ok) return showErrors(parsed.errors);
    setErrors({});
    setTestField(null);
    setTestState({ durum: 'calisiyor' });
    try {
      const yanit = await api.testConnection(body);
      setTestState({ durum: 'bitti', yanit });
      const failed = yanit.adimlar.find((s) => s.sonuc === 'hata');
      setTestField(failed?.alan ?? null);
      if (failed?.id === 'tls' || isSslPathField(failed?.alan)) {
        setSslOpen(true);
      }
    } catch (err) {
      setTestState({ durum: 'basarisiz', hata: err instanceof ApiError && err.body?.hata ? err.body.hata : 'sunucuya ulaşılamadı' });
    }
  }

  function canFix(fix: FixId): boolean {
    if (fix === 'tekrarDene' || fix === 'postgresKullan' || fix === 'verifyCaDene' || fix === 'requireYap') return true;
    const target = FIX_FIELDS[fix];
    // Şifre alanı "Keychain'e kaydet" kapalıyken yok (oturumluk şifre ayrı bir akış).
    if (target === 'password') return savePassword;
    return target !== undefined;
  }

  function applyFix(fix: FixId) {
    if (fix === 'tekrarDene') return void runTest();
    if (fix === 'postgresKullan') {
      setDatabase(DEFAULT_DATABASE);
      return void runTest({ database: DEFAULT_DATABASE });
    }
    if (fix === 'verifyCaDene') {
      setSsl((current) => ({ ...current, sslmode: 'verify-ca' }));
      return void runTest({ ...sslSettings({ ...ssl, sslmode: 'verify-ca' }) });
    }
    if (fix === 'requireYap') return setSsl((current) => ({ ...current, sslmode: 'require' }));
    const target = FIX_FIELDS[fix];
    if (!target) return;
    if (target === 'password') setChanging(true);
    if (isSslPathField(target)) setSslOpen(true);
    setFocusField(target);
  }

  const invalid = (key: ConnectionField) => (errors[key] || testField === key ? true : undefined);

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
      ...sslSettings(ssl),
    };
    // Boş alan kayıtlı şifreye dokunmaz; şifreyi keychain'den kaldırmanın yolu "Keychain'e kaydet"i kapatmak.
    if (savePassword && password !== '') request.password = password;

    const parsed = parseConnectionInput(request);
    if (!parsed.ok) return showErrors(parsed.errors);
    setErrors({});
    setSaving(true);
    try {
      const result = connection
        ? await api.updateConnection(connection.id, request)
        : await api.createConnection(request);
      onSaved(result.connection, result.password);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.body?.alanlar) showErrors(err.body.alanlar);
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
        onChange={(e) => {
          set(e.target.value);
          if (testField === key) setTestField(null);
        }}
        aria-invalid={invalid(key)}
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

      {testState && <TestOzeti state={testState} />}

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
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (testField === 'password') setTestField(null);
                }}
                aria-invalid={invalid('password')}
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
        <TestAdimlari state={testState} section="baglanti" onFix={applyFix} canFix={canFix} />
      </fieldset>

      <SslBolumu
        id={id}
        value={ssl}
        onChange={(next) => {
          setSsl(next);
          if (isSslPathField(testField)) setTestField(null);
        }}
        open={sslOpen}
        onToggle={() => setSslOpen((open) => !open)}
        prod={isProd(envTag)}
        errors={errors}
        invalid={(field) => testField === field}
        testState={testState}
        onFix={applyFix}
        canFix={canFix}
      />

      {(errors.genel || errors.folderId) && (
        <p role="alert" className="uyari">
          {errors.genel ?? errors.folderId}
        </p>
      )}

      <footer className="form-alt">
        <button type="button" onClick={() => void runTest()} disabled={testState?.durum === 'calisiyor'}>
          Bağlantıyı test et
        </button>
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

