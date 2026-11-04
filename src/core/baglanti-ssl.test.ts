import { describe, expect, it, vi } from 'vitest';
import { buildSslOptions, type SslFileContents } from './baglanti-ssl';

const none: SslFileContents = { ca: null, cert: null, key: null };
const ca: SslFileContents = { ca: 'CA-PEM', cert: null, key: null };
const client: SslFileContents = { ca: null, cert: 'CERT-PEM', key: 'KEY-PEM' };
const cert = { subject: { CN: 'db.internal' } };

function build(sslmode: Parameters<typeof buildSslOptions>[0]['sslmode'], files = none, realHost = 'db.internal') {
  const checkHostname = vi.fn<(host: string, cert: unknown) => Error | undefined>(() => undefined);
  return { result: buildSslOptions({ sslmode, files, realHost, checkHostname }), checkHostname };
}

function options(sslmode: Parameters<typeof buildSslOptions>[0]['sslmode'], files = none, realHost?: string) {
  const { result } = build(sslmode, files, realHost);
  if (!result.ok) throw new Error(`beklenmeyen hata: ${result.failure.mesaj}`);
  return result.ssl;
}

describe('buildSslOptions', () => {
  it('disable → ssl: false (dosyalar yok sayılır)', () => {
    expect(options('disable', { ca: 'CA-PEM', cert: 'CERT-PEM', key: 'KEY-PEM' })).toBe(false);
  });

  it.each(['prefer', 'require'] as const)('%s, CA yoksa → doğrulamasız SSL', (sslmode) => {
    expect(options(sslmode)).toEqual({ rejectUnauthorized: false });
  });

  it('prefer CA verilse de doğrulamaz', () => {
    expect(options('prefer', ca)).toEqual({ rejectUnauthorized: false });
  });

  it('require, CA verilmişse verify-ca gibi: zincir doğrulanır, host adı doğrulanmaz', () => {
    const ssl = options('require', ca);
    expect(ssl).toMatchObject({ rejectUnauthorized: true, ca: 'CA-PEM', checkServerIdentity: expect.any(Function) });
    expect(ssl && ssl.checkServerIdentity?.('baska.host', cert)).toBeUndefined();
    expect(ssl).not.toHaveProperty('servername');
  });

  it('verify-ca: zincir doğrulanır, host adı doğrulanmaz', () => {
    const { result, checkHostname } = build('verify-ca', ca);
    expect(result).toMatchObject({
      ok: true,
      ssl: { rejectUnauthorized: true, ca: 'CA-PEM', checkServerIdentity: expect.any(Function) },
    });
    const ssl = result.ok && result.ssl;
    expect(ssl && ssl.checkServerIdentity?.('baska.host', cert)).toBeUndefined();
    expect(checkHostname).not.toHaveBeenCalled();
  });

  it('verify-ca, CA yoksa "CA dosyası seç" önerisiyle reddedilir', () => {
    expect(build('verify-ca').result).toEqual({
      ok: false,
      failure: {
        kod: 'caGerekli',
        mesaj: 'sslmode=verify-ca için CA dosyası gerekli.',
        alan: 'sslrootcert',
        oneriler: ['caDosyasiSec'],
      },
    });
  });

  it('verify-full: rejectUnauthorized, servername gerçek host, host adı gerçek host ile doğrulanır', () => {
    const { result, checkHostname } = build('verify-full', ca);
    expect(result).toMatchObject({ ok: true, ssl: { rejectUnauthorized: true, ca: 'CA-PEM', servername: 'db.internal' } });
    const ssl = result.ok && result.ssl;
    const mismatch = new Error('altname');
    checkHostname.mockReturnValueOnce(mismatch);
    expect(ssl && ssl.checkServerIdentity?.('db.internal', cert)).toBe(mismatch);
    expect(checkHostname).toHaveBeenCalledWith('db.internal', cert);
  });

  it('verify-full, tünelde: TLS yerel uca bağlansa da host adı gerçek host ile doğrulanır', () => {
    const { result, checkHostname } = build('verify-full', none, 'db.internal');
    const ssl = result.ok && result.ssl;
    if (ssl) ssl.checkServerIdentity?.('127.0.0.1', cert);
    expect(checkHostname).toHaveBeenCalledWith('db.internal', cert);
  });

  it('verify-full CA olmadan sistem CA’larını kullanır', () => {
    const ssl = options('verify-full');
    expect(ssl).toMatchObject({ rejectUnauthorized: true, servername: 'db.internal' });
    expect(ssl).not.toHaveProperty('ca');
  });

  it.each(['10.0.4.12', '::1'])('verify-full, gerçek host IP ise (%s) SNI gönderilmez ama kimlik yine doğrulanır', (ip) => {
    const { result, checkHostname } = build('verify-full', none, ip);
    const ssl = result.ok && result.ssl;
    expect(ssl).not.toHaveProperty('servername');
    if (ssl) ssl.checkServerIdentity?.('localhost', cert);
    expect(checkHostname).toHaveBeenCalledWith(ip, cert);
  });

  it.each(['prefer', 'require', 'verify-ca', 'verify-full'] as const)(
    '%s istemci sertifikası ve anahtarını taşır',
    (sslmode) => {
      expect(options(sslmode, { ...client, ca: 'CA-PEM' })).toMatchObject({ cert: 'CERT-PEM', key: 'KEY-PEM' });
    },
  );
});
