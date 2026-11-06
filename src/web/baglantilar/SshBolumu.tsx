import { useState } from 'react';
import {
  DEFAULT_SSH_PORT,
  SSH_AUTHS,
  sshSummary,
  type ConnectionField,
  type SshAuth,
  type SshSettings,
} from '../../core/baglanti';
import type { FixId, TestField, TestStep } from '../../core/baglanti-testi';
import type { HostKeyProblem } from '../../core/ssh-tuneli';
import { HostAnahtariKutusu } from './HostAnahtariKutusu';
import { AdimDurumu, TestAdimlari, type TestState } from './TestSonucu';

/** Formdaki SSH değerleri; port metin, yollar boş dize ise "yok". */
export interface SshForm {
  enabled: boolean;
  host: string;
  port: string;
  user: string;
  auth: SshAuth;
  keyPath: string;
  agentPath: string;
  saveSecret: boolean;
}

export function sshForm(ssh: SshSettings | null): SshForm {
  return {
    enabled: ssh !== null,
    host: ssh?.host ?? '',
    port: String(ssh?.port ?? DEFAULT_SSH_PORT),
    user: ssh?.user ?? '',
    auth: ssh?.auth ?? 'key',
    keyPath: ssh?.keyPath ?? '',
    agentPath: ssh?.agentPath ?? '',
    saveSecret: ssh?.saveSecret ?? true,
  };
}

/** Gönderilecek tünel; kapalıysa `null`. Port sayı değilse sunucu/ayrıştırıcı hatayı alanına yazar. */
export function sshSettings(form: SshForm): SshSettings | null {
  if (!form.enabled) return null;
  const path = (value: string) => (value.trim() === '' ? null : value);
  return {
    host: form.host,
    port: /^\d+$/.test(form.port.trim()) ? Number(form.port.trim()) : Number.NaN,
    user: form.user,
    auth: form.auth,
    keyPath: path(form.keyPath),
    agentPath: path(form.agentPath),
    saveSecret: form.saveSecret,
  };
}

/** SSH sırrı kullanılır mı: şifre ya da anahtarın passphrase'i; agent'ta sır yok. */
export const usesSshSecret = (form: SshForm) => form.enabled && form.auth !== 'agent';

export const SSH_ERROR_FIELDS = ['ssh', 'sshHost', 'sshPort', 'sshUser', 'sshAuth', 'sshKeyPath', 'sshAgentPath', 'sshSecret'] as const;

const AUTH_LABELS: Record<SshAuth, string> = { password: 'şifre', key: 'anahtar dosyası', agent: 'agent' };

/** Keychain'deki SSH sırrının bilinen durumu. */
export type StoredSecret = 'yukleniyor' | 'bulundu' | 'yok' | 'reddedildi' | 'bilinmiyor';

interface Props {
  id: string;
  value: SshForm;
  onChange: (value: SshForm) => void;
  secret: string;
  onSecretChange: (value: string) => void;
  stored: StoredSecret;
  changing: boolean;
  onChangeStored: () => void;
  open: boolean;
  onToggle: () => void;
  errors: Partial<Record<ConnectionField, string>>;
  invalid: (field: TestField) => boolean;
  testState: TestState | null;
  onFix: (fix: FixId) => void;
  canFix: (fix: FixId) => boolean;
  /** Testteki bilinmeyen anahtara güven: kaydedilir ve test baştan koşar. */
  onTrust: (problem: HostKeyProblem) => Promise<void>;
  /** Tezgah'taki kaydı siler; kullanıcıya gösterilecek sonucu döner. */
  onForget: (host: string, port: number) => Promise<string>;
  onDismissHostKey: () => void;
  /** Agent yolu boşken kullanılacak varsayılanın açıklaması. */
  agentDefault: string;
}

/** Katlanır SSH tüneli bölümü: kapalıyken tek satır özet (`deploy@bastion · anahtar`) ve durum ikonu. */
export function SshBolumu(props: Props) {
  const { id, value, onChange, secret, onSecretChange, stored, changing, open, onToggle, errors, invalid } = props;
  const [forgetNote, setForgetNote] = useState<string | null>(null);
  const set = (patch: Partial<SshForm>) => onChange({ ...value, ...patch });
  const settings = sshSettings(value);
  const summary = settings && settings.host && settings.user ? sshSummary(settings) : value.enabled ? 'eksik' : 'kapalı';
  const port = /^\d+$/.test(value.port.trim()) ? Number(value.port.trim()) : DEFAULT_SSH_PORT;

  const field = (key: 'sshHost' | 'sshPort' | 'sshUser' | 'sshKeyPath' | 'sshAgentPath', label: string, current: string, update: (v: string) => void, extra = {}) => (
    <div className="alan">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        value={current}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => update(e.target.value)}
        aria-invalid={errors[key] || invalid(key) ? true : undefined}
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

  const secretLabel = value.auth === 'password' ? 'SSH şifresi' : 'Passphrase';
  const showStored = stored === 'bulundu' && !changing && value.saveSecret;

  const hostKeyBox = (step: TestStep) => {
    if (step.id !== 'ssh' || !step.hostAnahtari || (step.kod !== 'hostKeyUnknown' && step.kod !== 'hostKeyMismatch')) return null;
    const problem = step.hostAnahtari;
    return (
      <HostAnahtariKutusu
        problem={problem}
        kind={step.kod as 'hostKeyUnknown' | 'hostKeyMismatch'}
        onTrust={() => props.onTrust(problem)}
        onForget={async () => setForgetNote(await props.onForget(problem.host, problem.port))}
        onCancel={props.onDismissHostKey}
      />
    );
  };

  return (
    <fieldset className="bolum katlanir" aria-label="SSH tüneli">
      <legend>
        <button type="button" className="bolum-acici" aria-expanded={open} onClick={onToggle}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> SSH tüneli
          <span className="bolum-ozeti"> · {summary}</span>
          <AdimDurumu state={props.testState} step="ssh" />
        </button>
      </legend>
      {open && (
        <>
          <label className="kutu">
            <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            SSH tüneli kullan
          </label>
          {value.enabled && (
            <>
              <div className="alan-satiri">
                {field('sshHost', 'SSH host', value.host, (host) => set({ host }))}
                {field('sshPort', 'SSH port', value.port, (p) => set({ port: p }), { inputMode: 'numeric', className: 'port' })}
              </div>
              {field('sshUser', 'SSH kullanıcısı', value.user, (user) => set({ user }))}
              <div className="alan">
                <span className="etiket" id={`${id}-sshAuth`}>
                  Kimlik doğrulama
                </span>
                <div role="radiogroup" aria-labelledby={`${id}-sshAuth`} className="cipler">
                  {SSH_AUTHS.map((auth) => (
                    <label key={auth} className={`cip${value.auth === auth ? ' secili' : ''}`}>
                      <input type="radio" name={`${id}-sshAuth`} checked={value.auth === auth} onChange={() => set({ auth })} />
                      {AUTH_LABELS[auth]}
                    </label>
                  ))}
                </div>
              </div>
              {value.auth === 'key' &&
                field('sshKeyPath', 'Anahtar dosyası', value.keyPath, (keyPath) => set({ keyPath }), {
                  className: 'yol-alani',
                  placeholder: '~/.ssh/id_ed25519',
                })}
              {value.auth === 'key' && <p className="soluk">Anahtar diskte yerinde kalır; yalnızca yolu saklanır.</p>}
              {value.auth === 'agent' &&
                field('sshAgentPath', 'Agent soketi / pipe', value.agentPath, (agentPath) => set({ agentPath }), {
                  className: 'yol-alani',
                  placeholder: `boşsa ${props.agentDefault}`,
                })}
              {value.auth === 'agent' && <p className="soluk">Pageant için pipe yolunu girin. Agent'ta sır saklanmaz.</p>}
              {value.auth !== 'agent' && (
                <div className="alan">
                  {showStored ? (
                    <>
                      <span className="etiket">{secretLabel}</span>
                      <p className="keychain-kayitli">
                        🔑 keychain'de kayıtlı ·{' '}
                        <button type="button" className="baglanti-dugme" onClick={props.onChangeStored}>
                          değiştir
                        </button>
                      </p>
                    </>
                  ) : stored === 'yukleniyor' && value.saveSecret ? (
                    <>
                      <span className="etiket">{secretLabel}</span>
                      <p className="soluk">Keychain denetleniyor…</p>
                    </>
                  ) : (
                    (
                      <>
                        <label htmlFor={`${id}-sshSecret`}>
                          {value.saveSecret ? secretLabel : `${secretLabel} (yalnızca test için)`}
                        </label>
                        <input
                          id={`${id}-sshSecret`}
                          type="password"
                          autoComplete="new-password"
                          placeholder={value.auth === 'key' ? 'anahtar şifresizse boş' : undefined}
                          value={secret}
                          onChange={(e) => onSecretChange(e.target.value)}
                          aria-invalid={errors.sshSecret || invalid('sshSecret') ? true : undefined}
                        />
                        {errors.sshSecret && <span className="alan-hatasi">{errors.sshSecret}</span>}
                      </>
                    )
                  )}
                  {stored === 'reddedildi' && value.saveSecret && (
                    <p role="status" className="uyari">
                      Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli); kayıtlı SSH sırrı okunamadı.
                    </p>
                  )}
                  <label className="kutu">
                    <input type="checkbox" checked={value.saveSecret} onChange={(e) => set({ saveSecret: e.target.checked })} />
                    SSH sırrını keychain'e kaydet
                  </label>
                  {!value.saveSecret && (
                    <p className="uyari-satiri">{secretLabel} her açılışta ilk bağlanmada sorulur, yalnızca bellekte tutulur.</p>
                  )}
                </div>
              )}
              {value.host.trim() !== '' && (
                <p className="soluk">
                  <button
                    type="button"
                    className="baglanti-dugme"
                    onClick={async () => setForgetNote(await props.onForget(value.host.trim(), port))}
                  >
                    Kayıtlı host anahtarını unut
                  </button>
                  {forgetNote && <span role="status"> · {forgetNote}</span>}
                </p>
              )}
            </>
          )}
          <TestAdimlari state={props.testState} section="ssh" onFix={props.onFix} canFix={props.canFix} below={hostKeyBox} />
        </>
      )}
    </fieldset>
  );
}
