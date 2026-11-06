/**
 * "Bağlantıyı test et": istek/yanıt sözleşmesi ve sürücü hatalarının adımlara, alanlara ve
 * düzeltme önerilerine eşlenmesi. Sunucu ve web aynı tanımı kullanır; ağ ve sürücüden bağımsızdır.
 */
import {
  DEFAULT_DATABASE,
  type Connection,
  SSL_PATH_LABELS,
  connectionFieldReader,
  type SshField,
  type SshSettings,
  type SslMode,
  type SslPathField,
  type SslSettings,
} from './baglanti';
import type { HostKeyProblem } from './ssh-tuneli';

/** Adımlar bu sırayla koşar; uygulanmayan adım (sır okunmuyorsa `sirlar`, tünel yoksa `ssh`) listede yoktur. */
export const TEST_STEPS = ['sirlar', 'ssh', 'ulasma', 'tls', 'kimlik', 'listeleme'] as const;
export type TestStepId = (typeof TEST_STEPS)[number];

export type StepResult = 'basarili' | 'uyari' | 'hata' | 'calistirilmadi';

/** Hata satırındaki tek tık düzeltmeler. */
export type FixId =
  | 'tekrarDene'
  | 'hostuDuzelt'
  | 'portuDuzelt'
  | 'kullaniciyiDuzelt'
  | 'sifreyiDuzelt'
  | 'sifreGir'
  | 'veritabaniniDuzelt'
  | 'postgresKullan'
  | 'requireYap'
  | 'caDosyasiSec'
  | 'verifyCaDene'
  | 'sshHostuDuzelt'
  | 'sshPortuDuzelt'
  | 'sshKullaniciyiDuzelt'
  | 'sshSirriDuzelt'
  | 'anahtarDosyasiniDuzelt'
  | 'agentYolunuDuzelt';

/** Bir adımın sorumlu tuttuğu form alanı (formda kırmızı gösterilir). */
export type TestField =
  | 'host'
  | 'port'
  | 'user'
  | 'password'
  | 'database'
  | SslPathField
  | 'sshHost'
  | 'sshPort'
  | 'sshUser'
  | 'sshKeyPath'
  | 'sshAgentPath'
  | 'sshSecret';

/** Tezgah'ın kendi yapısal kodları; sürücü ya da ağ bir kod vermediğinde ya da durum sürücü hatası değilse. */
export const TEST_CODES = [
  'sifreGerekli',
  'sirYok',
  'reddedildi',
  'sifresizDusus',
  'tlsHatasi',
  'caGerekli',
  'dosyaOkunamadi',
  'ulasilamadi',
  'baglanilamadi',
  'listelenemedi',
  'hostKeyUnknown',
  'hostKeyMismatch',
  'sshSirGerekli',
  'sshSirReddedildi',
  'sshKimlik',
  'agentYok',
  'anahtarOkunamadi',
  'sshHatasi',
  'tunelKoptu',
] as const;
export type TestCode = (typeof TEST_CODES)[number];

declare const externalBrand: unique symbol;
/** Dışarıdan gelen kod: SQLSTATE (`28P01`) ya da Node ağ/TLS kodu (`ECONNREFUSED`). */
export type ExternalCode = string & { readonly [externalBrand]: true };
export type StepCode = TestCode | ExternalCode;

/** Sürücünün kodu varsa onu, yoksa Tezgah'ın yapısal kodunu kullanır. */
function codeOf(err: DriverError, fallback: TestCode): StepCode {
  return err.code === undefined ? fallback : (err.code as ExternalCode);
}

export interface TestStep {
  id: TestStepId;
  sonuc: StepResult;
  kod: StepCode | null;
  mesaj: string;
  alan: TestField | null;
  oneriler: FixId[];
  /** Yalnızca `hostKeyUnknown` ve `hostKeyMismatch`'te: arayüzdeki host anahtarı kutusunun içeriği. */
  hostAnahtari?: HostKeyProblem;
}

/** Adım satırının gösterildiği form bölümü. */
export type TestSection = 'baglanti' | 'ssl' | 'ssh';
export const STEP_SECTION: Record<TestStepId, TestSection> = {
  sirlar: 'baglanti',
  ssh: 'ssh',
  ulasma: 'baglanti',
  tls: 'ssl',
  kimlik: 'baglanti',
  listeleme: 'baglanti',
};

export const STEP_LABELS: Record<TestStepId, string> = {
  sirlar: 'Sırlar',
  ssh: 'SSH tüneli',
  ulasma: 'Sunucuya ulaşma',
  tls: 'TLS',
  kimlik: 'Kimlik doğrulama',
  listeleme: 'Veritabanlarını listeleme',
};

/** Formdaki kaydedilmemiş değerler. `password` verilmezse ve kaydı keychain'deyse şifre oradan okunur. */
export interface ConnectionTestRequest extends SslSettings {
  /** Düzenlenen bağlantı; yeni bağlantıda `null`. Yalnızca keychain'deki şifreyi bulmak için. */
  connectionId: string | null;
  host: string;
  port: number;
  user: string;
  database: string;
  password: string | undefined;
  savePassword: boolean;
  ssh: SshSettings | null;
  /** SSH şifresi ya da passphrase; verilmezse ve `ssh.saveSecret` ise keychain'den okunur. */
  sshSecret: string | undefined;
}

export interface ConnectionTestResponse {
  adimlar: TestStep[];
  /** Yalnızca tüm adımlar geçtiyse. */
  sunucu: { surum: string; veritabaniSayisi: number } | null;
}

export type TestInputField =
  | Exclude<keyof ConnectionTestRequest, 'connectionId' | 'savePassword' | 'ssh'>
  | SshField;
export type TestParseResult =
  | { ok: true; value: ConnectionTestRequest }
  | { ok: false; errors: Partial<Record<TestInputField, string>> };

export function parseConnectionTestInput(raw: unknown): TestParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { host: 'Geçersiz test girdisi' } };
  }
  const input = raw as Record<string, unknown>;
  const errors: Partial<Record<TestInputField, string>> = {};
  const read = connectionFieldReader(input, errors);
  const host = read.text('host', 'Host');
  const user = read.text('user', 'Kullanıcı');
  const database = read.text('database', 'Başlangıç veritabanı', DEFAULT_DATABASE);
  const port = read.port();
  const password = read.password();
  const ssl = read.ssl();
  const ssh = read.ssh();
  const sshSecret = read.password('sshSecret');

  const connectionId = typeof input.connectionId === 'string' ? input.connectionId : null;
  const savePassword = typeof input.savePassword === 'boolean' ? input.savePassword : true;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { connectionId, host, port, user, database, password, savePassword, ...ssl, ssh, sshSecret } };
}

/** Sürücüden ya da ağdan gelen hata; yalnızca `code` ve `message` okunur. */
export interface DriverError {
  code?: string;
  message: string;
}

export type StepFailure = Pick<TestStep, 'kod' | 'mesaj' | 'alan' | 'oneriler' | 'hostAnahtari'>;

/** Testin gittiği adres ve başlangıç veritabanı (mesaj ve önerilerde kullanılır). */
interface TestAddress {
  host: string;
  port: number;
  database: string;
}

/** Sunucuya ulaşma (TCP) hatası. */
export function classifyReachError(err: DriverError, { host, port }: TestAddress): StepFailure {
  const address = `${host}:${port}`;
  const kod = codeOf(err, 'ulasilamadi');
  switch (err.code) {
    case 'ECONNREFUSED':
      return {
        kod,
        mesaj: `${address} bağlantıyı reddetti; bu portta dinleyen bir sunucu yok.`,
        alan: 'port',
        oneriler: ['portuDuzelt', 'tekrarDene'],
      };
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { kod, mesaj: `“${host}” adı çözümlenemedi.`, alan: 'host', oneriler: ['hostuDuzelt', 'tekrarDene'] };
    case 'ETIMEDOUT':
      return {
        kod,
        mesaj: `${address} zamanında yanıt vermedi (zaman aşımı).`,
        alan: 'host',
        oneriler: ['hostuDuzelt', 'portuDuzelt', 'tekrarDene'],
      };
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { kod, mesaj: `${host} ağdan ulaşılamıyor.`, alan: 'host', oneriler: ['hostuDuzelt', 'tekrarDene'] };
    default:
      return { kod, mesaj: `${address} adresine ulaşılamadı: ${err.message}`, alan: null, oneriler: ['tekrarDene'] };
  }
}

/** Sunucu şifre istedi ama elde şifre yok; sürücüye verilen şifre fonksiyonu bu kodla hata fırlatır. */
export const PASSWORD_REQUIRED = 'sifreGerekli' satisfies TestCode;

/** Sunucu şifreyi reddetti (SQLSTATE `invalid_password`). */
export function isPasswordRejected(kod: string | null | undefined): boolean {
  return kod === '28P01';
}

/**
 * Bu hatada şifre penceresi açılır mı: yalnızca şifresi keychain'e kaydedilmeyen bağlantıda, sunucu
 * şifre istediyse ya da reddettiyse.
 */
export function asksForSessionPassword(connection: Pick<Connection, 'savePassword'>, kod: string | null | undefined): boolean {
  return !connection.savePassword && (kod === PASSWORD_REQUIRED || isPasswordRejected(kod));
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

function isTlsError(err: DriverError): boolean {
  return /^ERR_(SSL|TLS|OSSL)_/.test(err.code ?? '') || err.code === 'EPROTO' || CHAIN_ERRORS.has(err.code ?? '');
}

/** Node/OpenSSL'in sunucu sertifikası zinciri doğrulanamadığında verdiği kodlar. */
const CHAIN_ERRORS = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_SIGNATURE_FAILURE',
]);

/** TLS adımındaki hata: sertifika zinciri, host adı ya da istemci sertifikası/anahtarı. */
function classifyTlsError(err: DriverError, sslmode: SslMode | undefined): StepFailure {
  const kod = codeOf(err, 'tlsHatasi');
  if (CHAIN_ERRORS.has(err.code ?? '')) {
    return {
      kod,
      mesaj: `Sunucu sertifikası doğrulanamadı: ${err.message}`,
      alan: 'sslrootcert',
      oneriler: ['caDosyasiSec', 'tekrarDene'],
    };
  }
  if (err.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return {
      kod,
      mesaj: `Sertifika bu host adı için değil: ${err.message}`,
      alan: 'host',
      oneriler: sslmode === 'verify-full' ? ['verifyCaDene', 'hostuDuzelt'] : ['hostuDuzelt'],
    };
  }
  if (err.code === 'ERR_OSSL_X509_KEY_VALUES_MISMATCH') {
    return {
      kod,
      mesaj: `İstemci anahtarı sertifikayla eşleşmiyor: ${err.message}`,
      alan: 'sslkey',
      oneriler: ['tekrarDene'],
    };
  }
  if (/^ERR_OSSL_/.test(err.code ?? '')) {
    // Bozuk PEM CA'dan da, istemci sertifikası ya da anahtarından da gelebilir; hangisi bilinmez.
    return {
      kod,
      mesaj: `CA dosyası, istemci sertifikası ya da anahtarı kullanılamadı (geçerli PEM mi?): ${err.message}`,
      alan: null,
      oneriler: ['tekrarDene'],
    };
  }
  return { kod, mesaj: `TLS kurulamadı: ${err.message}`, alan: null, oneriler: ['tekrarDene'] };
}

/**
 * Bağlanma (TLS + kimlik doğrulama) hatası: hangi adımda olduğu ve kullanıcıya ne önerileceği.
 * Sunucu yanıt vermeden (SQLSTATE ya da şifre isteği olmadan) gelen hata, SSL denendiyse el
 * sıkışmanın bitmediği anlamına gelir ve TLS adımına düşer.
 */
export function classifyConnectError(
  err: DriverError,
  { database, ssl, sslmode }: TestAddress & { ssl: boolean; sslmode?: SslMode },
): StepFailure & { adim: 'tls' | 'kimlik' } {
  if (err.code === PASSWORD_REQUIRED) {
    return {
      adim: 'kimlik',
      kod: PASSWORD_REQUIRED,
      mesaj: 'Sunucu şifre istedi ama şifre girilmedi.',
      alan: 'password',
      oneriler: ['sifreGir'],
    };
  }
  if (err.code !== undefined && SQLSTATE.test(err.code)) {
    const kod = err.code as ExternalCode;
    switch (err.code) {
      case '28P01':
        return {
          adim: 'kimlik',
          kod,
          mesaj: `Şifre kabul edilmedi: ${err.message}`,
          alan: 'password',
          oneriler: ['sifreyiDuzelt', 'tekrarDene'],
        };
      case '28000':
        return {
          adim: 'kimlik',
          kod,
          mesaj: `Giriş reddedildi: ${err.message}`,
          alan: 'user',
          oneriler: ['kullaniciyiDuzelt', 'tekrarDene'],
        };
      case '3D000':
        return {
          adim: 'kimlik',
          kod,
          mesaj: `Başlangıç veritabanı yok: ${err.message}`,
          alan: 'database',
          oneriler: database === DEFAULT_DATABASE ? ['veritabaniniDuzelt'] : ['postgresKullan', 'veritabaniniDuzelt'],
        };
      default:
        return { adim: 'kimlik', kod, mesaj: err.message, alan: null, oneriler: ['tekrarDene'] };
    }
  }
  if (ssl || isTlsError(err)) return { adim: 'tls', ...classifyTlsError(err, sslmode) };
  return { adim: 'kimlik', kod: codeOf(err, 'baglanilamadi'), mesaj: err.message, alan: null, oneriler: ['tekrarDene'] };
}

/** SSL dosyası (CA, istemci sertifikası ya da anahtarı) okunamadı; TLS adımının hatasıdır. */
export function classifySslFileError(field: SslPathField, path: string, err: DriverError): StepFailure {
  const reason = err.code === 'ENOENT' ? 'dosya yok' : err.code === 'EACCES' || err.code === 'EPERM' ? 'okuma izni yok' : err.message;
  return {
    kod: codeOf(err, 'dosyaOkunamadi'),
    mesaj: `${SSL_PATH_LABELS[field]} okunamadı (${path}): ${reason}.`,
    alan: field,
    oneriler: field === 'sslrootcert' ? ['caDosyasiSec'] : ['tekrarDene'],
  };
}

/** `prefer`: doğrulamasız SSL denemesinden sonra yalnızca bu hatada bir kez düz bağlantı denenir. */
export function shouldRetryWithoutSsl(err: DriverError): boolean {
  return /server does not support SSL/i.test(err.message);
}

/** `pg_database` sorgusunun hatası. */
export function classifyListError(err: DriverError): StepFailure {
  return {
    kod: codeOf(err, 'listelenemedi'),
    mesaj: `Veritabanları listelenemedi: ${err.message}`,
    alan: null,
    oneriler: ['tekrarDene'],
  };
}

export interface TestSummary {
  sonuc: 'basarili' | 'uyari' | 'hata';
  /** Hatalı ya da (hata yoksa) ilk uyarılı adım. */
  adim: TestStepId | null;
}

export function testSummary(adimlar: readonly TestStep[]): TestSummary {
  const failed = adimlar.find((s) => s.sonuc === 'hata');
  if (failed) return { sonuc: 'hata', adim: failed.id };
  const warned = adimlar.find((s) => s.sonuc === 'uyari');
  if (warned) return { sonuc: 'uyari', adim: warned.id };
  return { sonuc: 'basarili', adim: null };
}

/** Uygulanacak adımlar, sırasıyla: `sirlar` yalnızca keychain okunacaksa, `ssh` yalnızca tünel varsa. */
export function testPlan({ readsKeychain, ssh = false }: { readsKeychain: boolean; ssh?: boolean }): TestStepId[] {
  return [
    ...(readsKeychain ? (['sirlar'] as const) : []),
    ...(ssh ? (['ssh'] as const) : []),
    'ulasma',
    'tls',
    'kimlik',
    'listeleme',
  ];
}

/** Adım sonuçlarını sırayla biriktirir; ilk hatadan sonra plandaki kalan adımlar "çalıştırılmadı" olur. */
export class TestRun {
  private readonly done: TestStep[] = [];
  constructor(private readonly plan: readonly TestStepId[]) {}

  ok(id: TestStepId, mesaj: string) {
    this.done.push({ id, sonuc: 'basarili', kod: null, mesaj, alan: null, oneriler: [] });
  }
  warn(id: TestStepId, failure: StepFailure) {
    this.done.push({ id, sonuc: 'uyari', ...failure });
  }
  fail(id: TestStepId, failure: StepFailure) {
    this.done.push({ id, sonuc: 'hata', ...failure });
  }
  /**
   * Bağlantının TLS sonucu: `withoutSsl`, SSL'siz bağlanıldığını söyler (disable ya da prefer düşüşü);
   * `ca`, bir CA dosyası verildiğini (require'da doğrulamayı açar).
   */
  tls({ sslmode, withoutSsl, ca }: { sslmode: SslMode; withoutSsl: boolean; ca: boolean }) {
    if (sslmode === 'disable') this.ok('tls', 'SSL kapalı (sslmode=disable); bağlantı şifresiz.');
    else if (withoutSsl) {
      this.warn('tls', {
        kod: 'sifresizDusus',
        mesaj: 'Sunucu SSL desteklemiyor; şifresiz bağlanıldı. sslmode=require yapılması önerilir.',
        alan: null,
        oneriler: ['requireYap'],
      });
    } else if (sslmode === 'verify-full') {
      this.ok('tls', `SSL ile bağlanıldı; CA zinciri ve host adı doğrulandı${ca ? '' : ' (sistem CA’ları)'}.`);
    } else if (sslmode === 'verify-ca' || (sslmode === 'require' && ca)) {
      this.ok('tls', `SSL ile bağlanıldı; CA zinciri doğrulandı; host adı doğrulanmadı (sslmode=${sslmode}).`);
    } else this.ok('tls', `SSL ile bağlanıldı (sertifika doğrulanmadı, sslmode=${sslmode}).`);
  }
  result(sunucu: ConnectionTestResponse['sunucu'] = null): ConnectionTestResponse {
    const notRun = this.plan.slice(this.done.length).map(
      (id): TestStep => ({ id, sonuc: 'calistirilmadi', kod: null, mesaj: '', alan: null, oneriler: [] }),
    );
    return { adimlar: [...this.done, ...notRun], sunucu };
  }
}

/** Herhangi bir yakalanan değeri `DriverError`'a indirger. */
export function toDriverError(err: unknown): DriverError {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  // Birden çok adres denendiğinde (ör. localhost → ::1 ve 127.0.0.1) Node kodsuz AggregateError verebilir.
  if (typeof e?.code !== 'string' && err instanceof AggregateError && err.errors.length > 0) {
    return toDriverError(err.errors[0]);
  }
  return { code: typeof e?.code === 'string' ? e.code : undefined, message: String(e?.message ?? err) };
}
