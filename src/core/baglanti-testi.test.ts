import { describe, expect, it } from 'vitest';
import {
  asksForSessionPassword,
  classifyConnectError,
  classifyListError,
  classifyReachError,
  parseConnectionTestInput,
  shouldRetryWithoutSsl,
  TestRun,
  testPlan,
  testSummary,
  toDriverError,
  type ExternalCode,
  type TestStep,
} from './baglanti-testi';

const target = { host: 'db.example', port: 5433, database: 'app', ssl: true };

describe('parseConnectionTestInput', () => {
  it('ad gerektirmez; eksik alanları varsayılanlarla doldurur', () => {
    expect(parseConnectionTestInput({ host: ' localhost ', user: 'postgres' })).toEqual({
      ok: true,
      value: {
        connectionId: null,
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        database: 'postgres',
        password: undefined,
        savePassword: true,
        sslmode: 'prefer',
        sslrootcert: null,
        sslcert: null,
        sslkey: null,
        ssh: null,
        sshSecret: undefined,
      },
    });
  });

  it.each([
    [{ user: 'postgres' }, 'host'],
    [{ host: 'h', user: ' ' }, 'user'],
    [{ host: 'h', user: 'u', port: 0 }, 'port'],
    [{ host: 'h', user: 'u', database: '' }, 'database'],
    [{ host: 'h', user: 'u', password: 5 }, 'password'],
    [{ host: 'h', user: 'u', sslmode: 'allow' }, 'sslmode'],
    [{ host: 'h', user: 'u', sslmode: 'verify-ca', sslrootcert: './ca.pem' }, 'sslrootcert'],
    [{ host: 'h', user: 'u', sslcert: '/c.crt' }, 'sslkey'],
  ])('geçersiz girdiyi alan hatasıyla reddeder (%o → %s)', (raw, field) => {
    const result = parseConnectionTestInput(raw);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toEqual([field]);
  });
});

describe('classifyReachError', () => {
  it('reddedilen portu Port alanına bağlar', () => {
    expect(classifyReachError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, target)).toEqual({
      kod: 'ECONNREFUSED',
      mesaj: 'db.example:5433 bağlantıyı reddetti; bu portta dinleyen bir sunucu yok.',
      alan: 'port',
      oneriler: ['portuDuzelt', 'tekrarDene'],
    });
  });

  it('çözümlenemeyen host adını Host alanına bağlar', () => {
    expect(classifyReachError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }, target)).toMatchObject({
      kod: 'ENOTFOUND',
      alan: 'host',
      oneriler: ['hostuDuzelt', 'tekrarDene'],
    });
  });

  it('zaman aşımında host ve portun ikisini de önerir', () => {
    expect(classifyReachError({ code: 'ETIMEDOUT', message: 'timeout' }, target)).toMatchObject({
      kod: 'ETIMEDOUT',
      alan: 'host',
      oneriler: ['hostuDuzelt', 'portuDuzelt', 'tekrarDene'],
    });
  });

  it('tanınmayan ağ hatasında mesajı olduğu gibi taşır', () => {
    expect(classifyReachError({ code: 'EACCES', message: 'connect EACCES' }, target)).toEqual({
      kod: 'EACCES',
      mesaj: 'db.example:5433 adresine ulaşılamadı: connect EACCES',
      alan: null,
      oneriler: ['tekrarDene'],
    });
  });
});

describe('classifyConnectError', () => {
  it('yanlış şifre (28P01) kimlik adımında, Şifre alanında', () => {
    const err = { code: '28P01', message: 'password authentication failed for user "app"' };
    expect(classifyConnectError(err, target)).toEqual({
      adim: 'kimlik',
      kod: '28P01',
      mesaj: 'Şifre kabul edilmedi: password authentication failed for user "app"',
      alan: 'password',
      oneriler: ['sifreyiDuzelt', 'tekrarDene'],
    });
  });

  it('olmayan veritabanında (3D000) "postgres kullan" önerir', () => {
    const err = { code: '3D000', message: 'database "app" does not exist' };
    expect(classifyConnectError(err, target)).toMatchObject({
      adim: 'kimlik',
      kod: '3D000',
      alan: 'database',
      oneriler: ['postgresKullan', 'veritabaniniDuzelt'],
    });
  });

  it('başlangıç veritabanı zaten postgres ise "postgres kullan" önermez', () => {
    const err = { code: '3D000', message: 'database "postgres" does not exist' };
    expect(classifyConnectError(err, { ...target, database: 'postgres' }).oneriler).toEqual(['veritabaniniDuzelt']);
  });

  it('reddedilen rol ya da pg_hba kaydı (28000) Kullanıcı alanında', () => {
    const err = { code: '28000', message: 'role "x" does not exist' };
    expect(classifyConnectError(err, target)).toMatchObject({ adim: 'kimlik', alan: 'user' });
  });

  it('şifre istenip verilmediğinde yapısal "şifre gerekli" sonucu verir', () => {
    expect(classifyConnectError({ code: 'sifreGerekli', message: '' }, target)).toEqual({
      adim: 'kimlik',
      kod: 'sifreGerekli',
      mesaj: 'Sunucu şifre istedi ama şifre girilmedi.',
      alan: 'password',
      oneriler: ['sifreGir'],
    });
  });

  it('diğer SQLSTATE kodlarını kimlik adımında mesajıyla taşır', () => {
    const err = { code: '53300', message: 'sorry, too many clients already' };
    expect(classifyConnectError(err, target)).toEqual({
      adim: 'kimlik',
      kod: '53300',
      mesaj: 'sorry, too many clients already',
      alan: null,
      oneriler: ['tekrarDene'],
    });
  });

  it('TLS el sıkışma hatalarını TLS adımına koyar', () => {
    const err = { code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'wrong version number' };
    expect(classifyConnectError(err, { ...target, ssl: false })).toMatchObject({
      adim: 'tls',
      kod: 'ERR_SSL_WRONG_VERSION_NUMBER',
    });
  });

  it('SSL denenirken sunucu yanıt vermeden kopan bağlantı TLS adımındadır', () => {
    const err = { code: 'ECONNRESET', message: 'read ECONNRESET' };
    expect(classifyConnectError(err, target)).toMatchObject({ adim: 'tls', kod: 'ECONNRESET' });
  });

  it.each(['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'])(
    'doğrulanamayan sertifika zinciri (%s) CA alanına ve "CA dosyası seç"e götürür',
    (code) => {
      const err = { code, message: 'self-signed certificate in certificate chain' };
      expect(classifyConnectError(err, { ...target, sslmode: 'verify-full' })).toMatchObject({
        adim: 'tls',
        kod: code,
        alan: 'sslrootcert',
        oneriler: ['caDosyasiSec', 'tekrarDene'],
      });
    },
  );

  it('verify-full’da host adı uyuşmazlığı "verify-ca dene" önerir', () => {
    const err = { code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: "Hostname/IP does not match certificate's altnames" };
    expect(classifyConnectError(err, { ...target, sslmode: 'verify-full' })).toMatchObject({
      adim: 'tls',
      kod: 'ERR_TLS_CERT_ALTNAME_INVALID',
      alan: 'host',
      oneriler: ['verifyCaDene', 'hostuDuzelt'],
    });
  });

  it('istemci sertifikası ile anahtar uyuşmazsa TLS adımında anahtar alanını işaret eder', () => {
    const err = { code: 'ERR_OSSL_X509_KEY_VALUES_MISMATCH', message: 'key values mismatch' };
    expect(classifyConnectError(err, { ...target, sslmode: 'require' })).toMatchObject({ adim: 'tls', alan: 'sslkey' });
  });

  it('hangi dosyadan geldiği bilinmeyen PEM hatası (bozuk CA da olabilir) bir alanı suçlamaz', () => {
    const err = { code: 'ERR_OSSL_PEM_NO_START_LINE', message: 'no start line' };
    expect(classifyConnectError(err, { ...target, sslmode: 'verify-full' })).toMatchObject({ adim: 'tls', alan: null });
  });

  it('düz bağlantıda sunucu yanıt vermeden kopan bağlantı kimlik adımındadır', () => {
    const err = { message: 'Connection terminated unexpectedly' };
    expect(classifyConnectError(err, { ...target, ssl: false })).toMatchObject({
      adim: 'kimlik',
      kod: 'baglanilamadi',
    });
  });
});

describe('shouldRetryWithoutSsl', () => {
  it('yalnızca "server does not support SSL" hatasında düz bağlantıyı yeniden dener', () => {
    expect(shouldRetryWithoutSsl({ message: 'The server does not support SSL connections' })).toBe(true);
    expect(shouldRetryWithoutSsl({ code: '28P01', message: 'password authentication failed' })).toBe(false);
    expect(shouldRetryWithoutSsl({ code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe(false);
  });
});

describe('classifyListError', () => {
  it('SQLSTATE ve mesajı taşır', () => {
    expect(classifyListError({ code: '42501', message: 'permission denied for table pg_database' })).toEqual({
      kod: '42501',
      mesaj: 'Veritabanları listelenemedi: permission denied for table pg_database',
      alan: null,
      oneriler: ['tekrarDene'],
    });
  });
});

describe('testSummary', () => {
  const step = (id: TestStep['id'], sonuc: TestStep['sonuc']): TestStep => ({
    id,
    sonuc,
    kod: null,
    mesaj: '',
    alan: null,
    oneriler: [],
  });

  it('tüm adımlar başarılıysa başarılı', () => {
    expect(testSummary([step('ulasma', 'basarili'), step('listeleme', 'basarili')])).toEqual({
      sonuc: 'basarili',
      adim: null,
    });
  });

  it('uyarı varsa uyarıyla başarılı ve uyarının adımı', () => {
    expect(testSummary([step('ulasma', 'basarili'), step('tls', 'uyari'), step('kimlik', 'basarili')])).toEqual({
      sonuc: 'uyari',
      adim: 'tls',
    });
  });

  it('hata varsa hangi adımda başarısız olduğu', () => {
    expect(
      testSummary([step('sirlar', 'uyari'), step('ulasma', 'hata'), step('tls', 'calistirilmadi')]),
    ).toEqual({ sonuc: 'hata', adim: 'ulasma' });
  });
});

describe('testPlan', () => {
  it('sırlar adımı yalnızca keychain okunacaksa; ssh adımı tünel olmadan hiç yok', () => {
    expect(testPlan({ readsKeychain: true })).toEqual(['sirlar', 'ulasma', 'tls', 'kimlik', 'listeleme']);
    expect(testPlan({ readsKeychain: false })).toEqual(['ulasma', 'tls', 'kimlik', 'listeleme']);
  });
});

describe('TestRun', () => {
  it('ilk hatadan sonra kalan adımlar çalıştırılmadı olur', () => {
    const run = new TestRun(['ulasma', 'tls', 'kimlik']);
    run.fail('ulasma', { kod: 'ECONNREFUSED' as ExternalCode, mesaj: 'reddetti', alan: 'port', oneriler: ['tekrarDene'] });
    expect(run.result()).toEqual({
      adimlar: [
        { id: 'ulasma', sonuc: 'hata', kod: 'ECONNREFUSED', mesaj: 'reddetti', alan: 'port', oneriler: ['tekrarDene'] },
        { id: 'tls', sonuc: 'calistirilmadi', kod: null, mesaj: '', alan: null, oneriler: [] },
        { id: 'kimlik', sonuc: 'calistirilmadi', kod: null, mesaj: '', alan: null, oneriler: [] },
      ],
      sunucu: null,
    });
  });

  it.each([
    ['disable', true, false, 'basarili', null, [], /SSL kapalı/],
    ['prefer', false, false, 'basarili', null, [], /sertifika doğrulanmadı/],
    ['prefer', true, false, 'uyari', 'sifresizDusus', ['requireYap'], /şifresiz/],
    ['require', false, false, 'basarili', null, [], /sertifika doğrulanmadı, sslmode=require/],
    ['require', false, true, 'basarili', null, [], /CA zinciri doğrulandı; host adı doğrulanmadı/],
    ['verify-ca', false, true, 'basarili', null, [], /CA zinciri doğrulandı; host adı doğrulanmadı/],
    ['verify-full', false, false, 'basarili', null, [], /CA zinciri ve host adı doğrulandı/],
  ] as const)('TLS: sslmode=%s, SSL’siz=%s, CA=%s → %s', (sslmode, withoutSsl, ca, sonuc, kod, oneriler, mesaj) => {
    const run = new TestRun(['tls']);
    run.tls({ sslmode, withoutSsl, ca });
    expect(run.result().adimlar[0]).toMatchObject({ sonuc, kod, oneriler, mesaj: expect.stringMatching(mesaj) });
  });
});

describe('toDriverError', () => {
  it('kodsuz AggregateError’da ilk hatanın kodunu alır', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' });
    expect(toDriverError(new AggregateError([inner]))).toEqual({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED ::1:5432',
    });
  });

  it('hata olmayan değeri mesaja çevirir', () => {
    expect(toDriverError('bozuk')).toEqual({ code: undefined, message: 'bozuk' });
  });
});

describe('asksForSessionPassword', () => {
  it("keychain'e kaydedilmeyen bağlantıda şifre istenince ya da reddedilince pencere açılır", () => {
    expect(asksForSessionPassword({ savePassword: false }, 'sifreGerekli')).toBe(true);
    expect(asksForSessionPassword({ savePassword: false }, '28P01')).toBe(true);
  });

  it("başka hatalarda ve şifresi keychain'de tutulan bağlantıda açılmaz", () => {
    expect(asksForSessionPassword({ savePassword: false }, 'ECONNREFUSED')).toBe(false);
    expect(asksForSessionPassword({ savePassword: false }, null)).toBe(false);
    expect(asksForSessionPassword({ savePassword: true }, '28P01')).toBe(false);
    expect(asksForSessionPassword({ savePassword: true }, 'sifreGerekli')).toBe(false);
  });
});
