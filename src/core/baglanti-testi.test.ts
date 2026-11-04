import { describe, expect, it } from 'vitest';
import {
  classifyConnectError,
  classifyListError,
  classifyReachError,
  parseConnectionTestInput,
  shouldRetryWithoutSsl,
  TestRun,
  testPlan,
  testSummary,
  toDriverError,
  unsupportedSslMode,
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
    ['disable', true, 'basarili', null, []],
    ['prefer', false, 'basarili', null, []],
    ['prefer', true, 'uyari', 'sifresizDusus', ['requireYap']],
  ] as const)('TLS: sslmode=%s, SSL’siz=%s → %s', (sslmode, withoutSsl, sonuc, kod, oneriler) => {
    const run = new TestRun(['tls']);
    run.tls(sslmode, withoutSsl);
    expect(run.result().adimlar[0]).toMatchObject({ sonuc, kod, oneriler });
  });
});

describe('unsupportedSslMode', () => {
  it('bu sürümde yalnızca disable ve prefer çalışır', () => {
    expect(unsupportedSslMode('disable')).toBeNull();
    expect(unsupportedSslMode('prefer')).toBeNull();
    expect(unsupportedSslMode('verify-full')).toMatchObject({ kod: 'sslmodeDesteklenmiyor' });
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
