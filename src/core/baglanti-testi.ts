/**
 * "Bağlantıyı test et": istek/yanıt sözleşmesi ve sürücü hatalarının adımlara, alanlara ve
 * düzeltme önerilerine eşlenmesi. Sunucu ve web aynı tanımı kullanır; ağ ve sürücüden bağımsızdır.
 */
import { DEFAULT_DATABASE, SSL_MODES, connectionFieldReader, type SslMode } from './baglanti';

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
  | 'requireYap';

/** Bir adımın sorumlu tuttuğu form alanı (formda kırmızı gösterilir). */
export type TestField = 'host' | 'port' | 'user' | 'password' | 'database';

export interface TestStep {
  id: TestStepId;
  sonuc: StepResult;
  /** SQLSTATE (`28P01`), Node ağ kodu (`ECONNREFUSED`) ya da yapısal kod (`sifreGerekli`). */
  kod: string | null;
  mesaj: string;
  alan: TestField | null;
  oneriler: FixId[];
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
export interface ConnectionTestRequest {
  /** Düzenlenen bağlantı; yeni bağlantıda `null`. Yalnızca keychain'deki şifreyi bulmak için. */
  connectionId: string | null;
  host: string;
  port: number;
  user: string;
  database: string;
  password: string | undefined;
  savePassword: boolean;
  sslmode: SslMode;
}

export interface ConnectionTestResponse {
  adimlar: TestStep[];
  /** Yalnızca tüm adımlar geçtiyse. */
  sunucu: { surum: string; veritabaniSayisi: number } | null;
}

/** Bu ticket'ta TLS adımının desteklediği modlar; diğerleri SSL/TLS ayarlarıyla gelir. */
export const TEST_SSL_MODES = ['disable', 'prefer'] as const satisfies readonly SslMode[];

export type TestInputField = Exclude<keyof ConnectionTestRequest, 'connectionId' | 'savePassword'>;
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

  let sslmode: SslMode = 'prefer';
  if (input.sslmode !== undefined) {
    if (SSL_MODES.includes(input.sslmode as SslMode)) sslmode = input.sslmode as SslMode;
    else errors.sslmode = `sslmode şunlardan biri olmalı: ${SSL_MODES.join(', ')}`;
  }

  const connectionId = typeof input.connectionId === 'string' ? input.connectionId : null;
  const savePassword = typeof input.savePassword === 'boolean' ? input.savePassword : true;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { connectionId, host, port, user, database, password, savePassword, sslmode } };
}

/** Sürücüden ya da ağdan gelen hata; yalnızca `code` ve `message` okunur. */
export interface DriverError {
  code?: string;
  message: string;
}

export type StepFailure = Pick<TestStep, 'kod' | 'mesaj' | 'alan' | 'oneriler'>;

/** Testin gittiği adres ve başlangıç veritabanı (mesaj ve önerilerde kullanılır). */
interface TestAddress {
  host: string;
  port: number;
  database: string;
}

/** Sunucuya ulaşma (TCP) hatası. */
export function classifyReachError(err: DriverError, { host, port }: TestAddress): StepFailure {
  const address = `${host}:${port}`;
  const kod = err.code ?? 'ulasilamadi';
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
export const PASSWORD_REQUIRED = 'sifreGerekli';

const SQLSTATE = /^[0-9A-Z]{5}$/;

function isTlsError(err: DriverError): boolean {
  return /^ERR_(SSL|TLS)_/.test(err.code ?? '') || err.code === 'EPROTO';
}

/**
 * Bağlanma (TLS + kimlik doğrulama) hatası: hangi adımda olduğu ve kullanıcıya ne önerileceği.
 * Sunucu yanıt vermeden (SQLSTATE ya da şifre isteği olmadan) gelen hata, SSL denendiyse el
 * sıkışmanın bitmediği anlamına gelir ve TLS adımına düşer.
 */
export function classifyConnectError(
  err: DriverError,
  { database, ssl }: TestAddress & { ssl: boolean },
): StepFailure & { adim: 'tls' | 'kimlik' } {
  const kod = err.code ?? null;
  if (kod === PASSWORD_REQUIRED) {
    return {
      adim: 'kimlik',
      kod,
      mesaj: 'Sunucu şifre istedi ama şifre girilmedi.',
      alan: 'password',
      oneriler: ['sifreGir'],
    };
  }
  if (kod && SQLSTATE.test(kod)) {
    switch (kod) {
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
  if (ssl || isTlsError(err)) {
    return { adim: 'tls', kod: kod ?? 'tlsHatasi', mesaj: `TLS kurulamadı: ${err.message}`, alan: null, oneriler: ['tekrarDene'] };
  }
  return { adim: 'kimlik', kod: kod ?? 'baglanilamadi', mesaj: err.message, alan: null, oneriler: ['tekrarDene'] };
}

/** `prefer`: doğrulamasız SSL denemesinden sonra yalnızca bu hatada bir kez düz bağlantı denenir. */
export function shouldRetryWithoutSsl(err: DriverError): boolean {
  return /server does not support SSL/i.test(err.message);
}

/** `pg_database` sorgusunun hatası. */
export function classifyListError(err: DriverError): StepFailure {
  return {
    kod: err.code ?? 'listelenemedi',
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

/** Uygulanacak adımlar, sırasıyla. Tünel (ticket 17) gelene kadar `ssh` yoktur. */
export function testPlan({ readsKeychain }: { readsKeychain: boolean }): TestStepId[] {
  return [...(readsKeychain ? (['sirlar'] as const) : []), 'ulasma', 'tls', 'kimlik', 'listeleme'];
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
  /** Bağlantının TLS sonucu: `withoutSsl`, SSL'siz bağlanıldığını söyler (disable ya da prefer düşüşü). */
  tls(sslmode: SslMode, withoutSsl: boolean) {
    if (sslmode === 'disable') this.ok('tls', 'SSL kapalı (sslmode=disable); bağlantı şifresiz.');
    else if (withoutSsl) {
      this.warn('tls', {
        kod: 'sifresizDusus',
        mesaj: 'Sunucu SSL desteklemiyor; şifresiz bağlanıldı. sslmode=require yapılması önerilir.',
        alan: null,
        oneriler: ['requireYap'],
      });
    } else this.ok('tls', 'SSL ile bağlanıldı (sertifika doğrulanmadı, sslmode=prefer).');
  }
  result(sunucu: ConnectionTestResponse['sunucu'] = null): ConnectionTestResponse {
    const notRun = this.plan.slice(this.done.length).map(
      (id): TestStep => ({ id, sonuc: 'calistirilmadi', kod: null, mesaj: '', alan: null, oneriler: [] }),
    );
    return { adimlar: [...this.done, ...notRun], sunucu };
  }
}

/** Bu sürümde TLS adımının çalıştıramadığı mod. */
export function unsupportedSslMode(sslmode: SslMode): StepFailure | null {
  if ((TEST_SSL_MODES as readonly SslMode[]).includes(sslmode)) return null;
  return {
    kod: 'sslmodeDesteklenmiyor',
    mesaj: `sslmode=${sslmode} henüz desteklenmiyor; şimdilik yalnızca disable ve prefer.`,
    alan: null,
    oneriler: [],
  };
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
