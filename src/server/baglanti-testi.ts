import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect as netConnect } from 'node:net';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import pg from 'pg';
import { sshSummary, type ValidationErrorResponse } from '../core/baglanti';
import { buildSslOptions, type PgSsl } from '../core/baglanti-ssl';
import {
  PASSWORD_REQUIRED,
  TestRun,
  classifyConnectError,
  classifyListError,
  classifyReachError,
  parseConnectionTestInput,
  shouldRetryWithoutSsl,
  testPlan,
  toDriverError,
  type ConnectionTestRequest,
  type ConnectionTestResponse,
  type DriverError,
  type TestInputField,
} from '../core/baglanti-testi';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, readJson } from './http';
import { passwordAccount, sshSecretAccount, type Keychain } from './keychain';
import { readSslFiles } from './ssl-dosyalari';
import { TunnelError, type OpenTunnel, type Tunnel } from './tunel';

export interface ConnectionTestDeps {
  store: SettingsStore;
  keychain: Keychain;
  openTunnel: OpenTunnel;
  log: (line: string) => void;
}

/** Tünelde `pg`'ye verilen host (SNI'yi ezmesin diye IP); gerçek host SSL nesnesindedir. */
const TUNNEL_PG_HOST = '127.0.0.1';
const KEYCHAIN_DENIED = "Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli)";

/** Ulaşma, bağlanma ve sorgu için ayrı ayrı süre sınırı. */
const TIMEOUT_MS = 10_000;
const PATH = '/api/baglanti-testi';

/** `POST /api/baglanti-testi`. İsteği ele aldıysa `true` döner. */
export function createConnectionTestRoutes(deps: ConnectionTestDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname !== PATH) return false;
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return true;
    }
    const parsed = parseConnectionTestInput(await readJson(req));
    if (!parsed.ok) {
      const body: ValidationErrorResponse<TestInputField> = { hata: 'Geçersiz test girdisi', alanlar: parsed.errors };
      json(res, 400, body);
      return true;
    }
    json(res, 200, await runConnectionTest(parsed.value, deps));
    return true;
  };
}

/**
 * Formdaki kaydedilmemiş değerlerle adımları sırayla koşar; hiçbir şey kaydetmez.
 * Sırlar → SSH tüneli → sunucuya ulaşma → TLS → kimlik doğrulama → veritabanlarını listeleme.
 */
export async function runConnectionTest(input: ConnectionTestRequest, deps: ConnectionTestDeps): Promise<ConnectionTestResponse> {
  const { store, keychain, openTunnel, log } = deps;
  const savedId = await savedConnectionId(store, input);
  const readsPassword = savedId !== null && input.password === undefined && input.savePassword;
  const ssh = input.ssh;
  const readsSshSecret = savedId !== null && ssh !== null && ssh.auth !== 'agent' && ssh.saveSecret && input.sshSecret === undefined;
  const run = new TestRun(testPlan({ readsKeychain: readsPassword || readsSshSecret, ssh: ssh !== null }));

  let password = input.password;
  let sshSecret = input.sshSecret;
  if (savedId !== null && (readsPassword || readsSshSecret)) {
    const read = {
      password: readsPassword ? await keychain.get(passwordAccount(savedId)) : null,
      ssh: readsSshSecret ? await keychain.get(sshSecretAccount(savedId)) : null,
    };
    if (read.password?.result === 'reddedildi') {
      log(`Keychain okuma reddedildi (${savedId}): ${read.password.message}`);
      run.fail('sirlar', {
        kod: 'reddedildi',
        mesaj: `${KEYCHAIN_DENIED}; kayıtlı şifre okunamadı.`,
        alan: 'password',
        oneriler: ['tekrarDene', 'sifreGir'],
      });
      return run.result();
    }
    if (read.ssh?.result === 'reddedildi') {
      log(`Keychain okuma reddedildi (${savedId}:ssh): ${read.ssh.message}`);
      run.fail('sirlar', {
        kod: 'reddedildi',
        mesaj: `${KEYCHAIN_DENIED}; kayıtlı SSH sırrı okunamadı.`,
        alan: 'sshSecret',
        oneriler: ['tekrarDene', 'sshSirriDuzelt'],
      });
      return run.result();
    }
    if (read.password?.result === 'bulundu') password = read.password.value;
    if (read.ssh?.result === 'bulundu') sshSecret = read.ssh.value;
    if (read.password?.result === 'yok') {
      run.warn('sirlar', {
        kod: 'sirYok',
        mesaj: "Keychain'de kayıtlı şifre yok; şifresiz deneniyor.",
        alan: 'password',
        oneriler: ['sifreGir'],
      });
    } else if (read.ssh?.result === 'yok' && ssh?.auth === 'password') {
      run.warn('sirlar', {
        kod: 'sirYok',
        mesaj: "Keychain'de kayıtlı SSH şifresi yok.",
        alan: 'sshSecret',
        oneriler: ['sshSirriDuzelt'],
      });
    } else {
      const which = [read.password && 'Şifre', read.ssh?.result === 'bulundu' && 'SSH sırrı'].filter(Boolean).join(' ve ');
      run.ok('sirlar', which ? `${which} keychain'den okundu.` : "Keychain'de kayıtlı passphrase yok; anahtar şifresiz deneniyor.");
    }
  }

  let tunnel: Tunnel | null = null;
  if (ssh) {
    try {
      tunnel = await openTunnel(ssh, sshSecret);
    } catch (err) {
      if (!(err instanceof TunnelError)) throw err;
      run.fail('ssh', err.failure);
      return run.result();
    }
    run.ok('ssh', `${sshSummary(ssh)}: host anahtarı doğrulandı, giriş yapıldı.`);
  }
  try {
    return await afterTunnel(input, password, run, tunnel);
  } finally {
    tunnel?.close();
  }
}

/** Sunucuya ulaşma → TLS → kimlik doğrulama → listeleme; tünel varsa her şey onun üzerinden. */
async function afterTunnel(
  input: ConnectionTestRequest,
  password: string | undefined,
  run: TestRun,
  tunnel: Tunnel | null,
): Promise<ConnectionTestResponse> {
  const unreachable = tunnel ? await probeTunnel(tunnel, input.host, input.port) : await probeTcp(input.host, input.port);
  if (unreachable) {
    run.fail('ulasma', classifyReachError(unreachable, input));
    return run.result();
  }
  run.ok('ulasma', `${input.host}:${input.port} yanıt veriyor${tunnel ? ' (tünel üzerinden)' : ''}.`);

  const files = await readSslFiles(input);
  if (!files.ok) {
    run.fail('tls', files.failure);
    return run.result();
  }
  const built = buildSslOptions({
    sslmode: input.sslmode,
    files: files.contents,
    realHost: input.host,
    checkHostname: (host, cert) => checkServerIdentity(host, cert as PeerCertificate),
  });
  if (!built.ok) {
    run.fail('tls', built.failure);
    return run.result();
  }

  // prefer: önce doğrulamasız SSL; yalnızca sunucu SSL desteklemiyorsa bir kez düz bağlantı.
  let ssl = built.ssl;
  let attempt = await connect(input, password, ssl, tunnel);
  if (!attempt.ok && input.sslmode === 'prefer' && shouldRetryWithoutSsl(attempt.error)) {
    ssl = false;
    attempt = await connect(input, password, ssl, tunnel);
  }
  const tls = { sslmode: input.sslmode, withoutSsl: ssl === false, ca: files.contents.ca !== null };

  if (!attempt.ok) {
    const failure = classifyConnectError(attempt.error, { ...input, ssl: ssl !== false });
    if (failure.adim === 'tls') {
      run.fail('tls', failure);
      return run.result();
    }
    run.tls(tls);
    run.fail('kimlik', failure);
    return run.result();
  }

  const { client } = attempt;
  try {
    run.tls(tls);
    run.ok('kimlik', `${input.user} olarak ${input.database} veritabanına giriş yapıldı.`);
    try {
      const { rows } = await client.query<{ surum: string; sayi: number }>(
        `SELECT current_setting('server_version') AS surum,
                (SELECT count(*) FROM pg_catalog.pg_database WHERE NOT datistemplate)::int AS sayi`,
      );
      const { surum, sayi } = rows[0]!;
      run.ok('listeleme', `PostgreSQL ${surum} · ${sayi} veritabanı`);
      return run.result({ surum, veritabaniSayisi: sayi });
    } catch (err) {
      run.fail('listeleme', classifyListError(toDriverError(err)));
      return run.result();
    }
  } finally {
    await client.end().catch(() => {});
  }
}

type Attempt = { ok: true; client: pg.Client } | { ok: false; error: DriverError };

async function connect(input: ConnectionTestRequest, password: string | undefined, ssl: PgSsl, tunnel: Tunnel | null): Promise<Attempt> {
  const client = new pg.Client({
    host: tunnel ? TUNNEL_PG_HOST : input.host,
    port: input.port,
    ...(tunnel && { stream: () => tunnel.socket(input.host, input.port) }),
    user: input.user,
    database: input.database,
    // Şifre yalnızca sunucu isterse sorulur; yoksa pg'nin .pgpass'a bakmasına izin verilmez.
    password: async () => {
      if (password === undefined || password === '') {
        throw Object.assign(new Error('şifre gerekli'), { code: PASSWORD_REQUIRED });
      }
      return password;
    },
    ssl,
    connectionTimeoutMillis: TIMEOUT_MS,
    query_timeout: TIMEOUT_MS,
    application_name: 'Tezgah (bağlantı testi)',
  });
  // Bağlantı sonradan düşerse süreç çökmesin.
  client.on('error', () => {});
  try {
    await client.connect();
    return { ok: true, client };
  } catch (err) {
    await client.end().catch(() => {});
    return { ok: false, error: toDriverError(err) };
  }
}

/** Keychain'deki şifresi okunacak kayıtlı bağlantının kimliği; kayıtlı değilse `null`. */
async function savedConnectionId(store: SettingsStore, { connectionId }: ConnectionTestRequest): Promise<string | null> {
  if (connectionId === null) return null;
  return (await store.read()).connections.some((c) => c.id === connectionId) ? connectionId : null;
}

/** SSH sunucusu hedefe kanal açabiliyor mu; açamıyorsa hatayı döndürür. */
async function probeTunnel(tunnel: Tunnel, host: string, port: number): Promise<DriverError | null> {
  try {
    await tunnel.probe(host, port);
    return null;
  } catch (err) {
    return toDriverError(err);
  }
}

/** TCP ile ulaşılabiliyor mu; ulaşılamıyorsa hatayı döndürür. */
function probeTcp(host: string, port: number): Promise<DriverError | null> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port });
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => {
      socket.destroy();
      resolve(null);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ code: 'ETIMEDOUT', message: 'zaman aşımı' });
    });
    socket.once('error', (err) => resolve(toDriverError(err)));
  });
}
