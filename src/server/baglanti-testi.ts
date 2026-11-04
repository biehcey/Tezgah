import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { connect as netConnect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import pg from 'pg';
import { sslPathsUsed, type SslSettings, type ValidationErrorResponse } from '../core/baglanti';
import { buildSslOptions, type PgSsl, type SslFileContents } from '../core/baglanti-ssl';
import {
  PASSWORD_REQUIRED,
  TestRun,
  classifyConnectError,
  classifyListError,
  classifyReachError,
  classifySslFileError,
  parseConnectionTestInput,
  shouldRetryWithoutSsl,
  testPlan,
  toDriverError,
  type ConnectionTestRequest,
  type ConnectionTestResponse,
  type DriverError,
  type StepFailure,
  type TestInputField,
} from '../core/baglanti-testi';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, readJson } from './http';
import { passwordAccount, type Keychain } from './keychain';

export interface ConnectionTestDeps {
  store: SettingsStore;
  keychain: Keychain;
  log: (line: string) => void;
}

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
 * Sırlar → sunucuya ulaşma → TLS → kimlik doğrulama → veritabanlarını listeleme.
 */
export async function runConnectionTest(
  input: ConnectionTestRequest,
  { store, keychain, log }: ConnectionTestDeps,
): Promise<ConnectionTestResponse> {
  const savedId = input.password === undefined && input.savePassword ? await savedConnectionId(store, input) : null;
  const run = new TestRun(testPlan({ readsKeychain: savedId !== null }));

  let password = input.password;
  if (savedId !== null) {
    const read = await keychain.get(passwordAccount(savedId));
    if (read.result === 'reddedildi') {
      log(`Keychain okuma reddedildi (${savedId}): ${read.message}`);
      run.fail('sirlar', {
        kod: 'reddedildi',
        mesaj: "Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli); kayıtlı şifre okunamadı.",
        alan: 'password',
        oneriler: ['tekrarDene', 'sifreGir'],
      });
      return run.result();
    }
    if (read.result === 'yok') {
      run.warn('sirlar', {
        kod: 'sirYok',
        mesaj: "Keychain'de kayıtlı şifre yok; şifresiz deneniyor.",
        alan: 'password',
        oneriler: ['sifreGir'],
      });
    } else {
      password = read.value;
      run.ok('sirlar', "Şifre keychain'den okundu.");
    }
  }

  const unreachable = await probeTcp(input.host, input.port);
  if (unreachable) {
    run.fail('ulasma', classifyReachError(unreachable, input));
    return run.result();
  }
  run.ok('ulasma', `${input.host}:${input.port} yanıt veriyor.`);

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
  let attempt = await connect(input, password, ssl);
  if (!attempt.ok && input.sslmode === 'prefer' && shouldRetryWithoutSsl(attempt.error)) {
    ssl = false;
    attempt = await connect(input, password, ssl);
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

async function connect(input: ConnectionTestRequest, password: string | undefined, ssl: PgSsl): Promise<Attempt> {
  const client = new pg.Client({
    host: input.host,
    port: input.port,
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

/** `~/` ile başlayan yolu ev dizinine çevirir; diğer yollar (ayrıştırmada mutlak olduğu doğrulandı) aynen. */
function resolvePath(path: string): string {
  return /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
}

type SslFiles = { ok: true; contents: SslFileContents } | { ok: false; failure: StepFailure };

/** Modun kullandığı SSL dosyalarını okur (disable'da hiçbiri, prefer'de CA değil). Dosyalar yerinde kalır. */
async function readSslFiles(input: SslSettings): Promise<SslFiles> {
  const contents: SslFileContents = { ca: null, cert: null, key: null };
  const target = { sslrootcert: 'ca', sslcert: 'cert', sslkey: 'key' } as const;
  for (const field of sslPathsUsed(input.sslmode)) {
    const path = input[field];
    if (path === null) continue;
    try {
      contents[target[field]] = await readFile(resolvePath(path), 'utf8');
    } catch (err) {
      return { ok: false, failure: classifySslFileError(field, path, toDriverError(err)) };
    }
  }
  return { ok: true, contents };
}

/** Keychain'deki şifresi okunacak kayıtlı bağlantının kimliği; kayıtlı değilse `null`. */
async function savedConnectionId(store: SettingsStore, { connectionId }: ConnectionTestRequest): Promise<string | null> {
  if (connectionId === null) return null;
  return (await store.read()).connections.some((c) => c.id === connectionId) ? connectionId : null;
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
