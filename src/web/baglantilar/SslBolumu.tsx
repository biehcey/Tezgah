import {
  SSL_MODES,
  SSL_PATH_LABELS,
  sslPathsUsed,
  type SslMode,
  type SslPathField,
  type SslSettings,
} from '../../core/baglanti';
import type { FixId } from '../../core/baglanti-testi';
import { TestAdimlari, TlsDurumu, type TestState } from './TestSonucu';

/** Formdaki SSL değerleri: yollar düz metin, boş dize "yok". */
export type SslForm = { sslmode: SslMode } & Record<SslPathField, string>;

export function sslForm(ssl: SslSettings): SslForm {
  return {
    sslmode: ssl.sslmode,
    sslrootcert: ssl.sslrootcert ?? '',
    sslcert: ssl.sslcert ?? '',
    sslkey: ssl.sslkey ?? '',
  };
}

/**
 * Gönderilecek SSL ayarları; boş yol `null`. Gizli alanlar da gider: mod değişince yollar kaybolmaz,
 * sunucu modun kullanmadığı dosyayı okumaz.
 */
export function sslSettings(form: SslForm): SslSettings {
  const path = (field: SslPathField) => (form[field].trim() === '' ? null : form[field]);
  return { sslmode: form.sslmode, sslrootcert: path('sslrootcert'), sslcert: path('sslcert'), sslkey: path('sslkey') };
}

const MODE_NOTES: Record<SslMode, string> = {
  disable: 'SSL kullanılmaz; bağlantı şifresizdir.',
  prefer: 'Önce SSL denenir (sertifika doğrulanmaz); sunucu desteklemiyorsa şifresiz bağlanılır.',
  require: 'SSL zorunlu; sertifika doğrulanmaz. CA dosyası verilirse CA zinciri doğrulanır (verify-ca gibi).',
  'verify-ca': 'SSL zorunlu; CA zinciri doğrulanır; host adı doğrulanmaz.',
  'verify-full': 'SSL zorunlu; CA zinciri ve host adı doğrulanır.',
};

const placeholder = (field: SslPathField, sslmode: SslMode) => {
  if (field !== 'sslrootcert') return 'opsiyonel, ör. ~/.postgresql/postgresql.crt';
  if (sslmode === 'verify-full') return "boşsa sistem CA'ları";
  if (sslmode === 'require') return 'boşsa sertifika doğrulanmaz';
  return 'gerekli, ör. ~/.postgresql/root.crt';
};

/** prod bağlantıda `verify-full` önerilir. */
const recommendsVerifyFull = (prod: boolean, sslmode: SslMode) => prod && sslmode !== 'verify-full';

interface Props {
  id: string;
  value: SslForm;
  onChange: (value: SslForm) => void;
  open: boolean;
  onToggle: () => void;
  prod: boolean;
  errors: Partial<Record<keyof SslForm, string>>;
  /** Son testin sorumlu tuttuğu alan (kırmızı). */
  invalid: (field: SslPathField) => boolean;
  testState: TestState | null;
  onFix: (fix: FixId) => void;
  canFix: (fix: FixId) => boolean;
}

/** Katlanır SSL/TLS bölümü: kapalıyken tek satır özet ve durum ikonu. */
export function SslBolumu({ id, value, onChange, open, onToggle, prod, errors, invalid, testState, onFix, canFix }: Props) {
  const recommend = recommendsVerifyFull(prod, value.sslmode);
  const set = (patch: Partial<SslForm>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="bolum katlanir" aria-label="SSL/TLS">
      <legend>
        <button type="button" className="bolum-acici" aria-expanded={open} onClick={onToggle}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> SSL/TLS
          <span className="bolum-ozeti">
            {' '}
            · {value.sslmode}
            {recommend && ' · ⚠ verify-full önerilir'}
          </span>
          <TlsDurumu state={testState} />
        </button>
      </legend>
      {open && (
        <>
          <div className="alan">
            <label htmlFor={`${id}-sslmode`}>sslmode</label>
            <select
              id={`${id}-sslmode`}
              value={value.sslmode}
              onChange={(e) => set({ sslmode: e.target.value as SslMode })}
            >
              {SSL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <p className="soluk">{MODE_NOTES[value.sslmode]}</p>
            {recommend && (
              <p className="uyari-satiri">
                prod için verify-full önerilir ·{' '}
                <button type="button" className="baglanti-dugme" onClick={() => set({ sslmode: 'verify-full' })}>
                  Uygula
                </button>
              </p>
            )}
            {errors.sslmode && <span className="alan-hatasi">{errors.sslmode}</span>}
          </div>
          {/* CA alanı yalnızca require ve üstünde; istemci sertifikası disable dışında. */}
          {sslPathsUsed(value.sslmode).map((field) => (
            <div className="alan" key={field}>
              <label htmlFor={`${id}-${field}`}>{SSL_PATH_LABELS[field]}</label>
              <input
                id={`${id}-${field}`}
                className="yol-alani"
                value={value[field]}
                placeholder={placeholder(field, value.sslmode)}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => set({ [field]: e.target.value })}
                aria-invalid={errors[field] || invalid(field) ? true : undefined}
                aria-describedby={errors[field] ? `${id}-${field}-hata` : undefined}
              />
              {errors[field] && (
                <span id={`${id}-${field}-hata`} className="alan-hatasi">
                  {errors[field]}
                </span>
              )}
            </div>
          ))}
          {value.sslmode !== 'disable' && (
            <p className="soluk">Dosyalar yerinde kalır; yalnızca yolları saklanır. Tam yol ya da ~/ ile başlayan yol.</p>
          )}
          <TestAdimlari state={testState} section="ssl" onFix={onFix} canFix={canFix} />
        </>
      )}
    </fieldset>
  );
}
