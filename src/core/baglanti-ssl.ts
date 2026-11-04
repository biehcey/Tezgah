/**
 * SSL seçenekleri kurucusu: `sslmode`, dosya içerikleri ve gerçek host adından `pg`'nin `ssl`
 * nesnesi. libpq anlamına uyar; connection string kullanılmaz (`pg-connection-string`
 * varsayılanda `prefer`/`require`/`verify-ca`'yı `verify-full` gibi ele alır).
 */
import type { SslMode } from './baglanti';
import type { StepFailure } from './baglanti-testi';

/** CA, istemci sertifikası ve anahtarın içerikleri (PEM); verilmeyen `null`. */
export interface SslFileContents {
  ca: string | null;
  cert: string | null;
  key: string | null;
}

/** Node'un `tls.checkServerIdentity`'si; core Node'a bağımlı olmasın diye dışarıdan verilir. */
export type HostnameCheck = (host: string, cert: unknown) => Error | undefined;

/** `pg`'ye verilen `ssl` (Node `tls.connect` seçeneklerinin kullanılan alt kümesi). */
export type PgSsl =
  | false
  | {
      rejectUnauthorized: boolean;
      ca?: string;
      cert?: string;
      key?: string;
      servername?: string;
      checkServerIdentity?: (host: string, cert: unknown) => Error | undefined;
    };

export interface SslBuildInput {
  sslmode: SslMode;
  files: SslFileContents;
  /** Sertifikanın ait olması gereken host: tünelde de kullanıcının girdiği sunucu adı, yerel uç değil. */
  realHost: string;
  checkHostname: HostnameCheck;
}

export type SslBuildResult = { ok: true; ssl: PgSsl } | { ok: false; failure: StepFailure };

/** SNI IP adresine ayarlanamaz (RFC 6066); IP'de yalnızca açık kimlik doğrulaması yapılır. */
function isIpAddress(host: string): boolean {
  return host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * `prefer` burada yalnızca ilk (doğrulamasız SSL) denemedir; sunucu SSL desteklemezse düz bağlantıyla
 * yeniden deneme kararı `shouldRetryWithoutSsl`'dadır. Host adı her zaman açık `checkServerIdentity`
 * ile gerçek host'a karşı doğrulanır: tünelde `pg` `servername`'i yerel uçla ezse de doğru kalır.
 */
export function buildSslOptions({ sslmode, files, realHost, checkHostname }: SslBuildInput): SslBuildResult {
  if (sslmode === 'disable') return { ok: true, ssl: false };
  const client = {
    ...(files.cert !== null && { cert: files.cert }),
    ...(files.key !== null && { key: files.key }),
  };
  const noHostnameCheck = () => undefined;

  if (sslmode === 'prefer' || (sslmode === 'require' && files.ca === null)) {
    return { ok: true, ssl: { rejectUnauthorized: false, ...client } };
  }
  if (sslmode === 'require' || sslmode === 'verify-ca') {
    if (files.ca === null) {
      return {
        ok: false,
        failure: {
          kod: 'caGerekli',
          mesaj: 'sslmode=verify-ca için CA dosyası gerekli.',
          alan: 'sslrootcert',
          oneriler: ['caDosyasiSec'],
        },
      };
    }
    return { ok: true, ssl: { rejectUnauthorized: true, ca: files.ca, ...client, checkServerIdentity: noHostnameCheck } };
  }
  return {
    ok: true,
    ssl: {
      rejectUnauthorized: true,
      ...(files.ca !== null && { ca: files.ca }),
      ...client,
      ...(!isIpAddress(realHost) && { servername: realHost }),
      checkServerIdentity: (_host, cert) => checkHostname(realHost, cert),
    },
  };
}
