import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import pg from 'pg';
import { isProd, type Connection } from '../core/baglanti';
import { buildSslOptions, type PgSsl } from '../core/baglanti-ssl';
import {
  PASSWORD_REQUIRED,
  classifyConnectError,
  isPasswordRejected,
  classifyReachError,
  shouldRetryWithoutSsl,
  toDriverError,
  type StepFailure,
} from '../core/baglanti-testi';
import { passwordAccount, type Keychain } from './keychain';
import type { SessionPasswords } from './oturum-sifreleri';
import type { Clock } from './saat';
import { readSslFiles } from './ssl-dosyalari';

/** Hedef başına pool'un en fazla client sayısı. */
const MAX_CLIENTS = 3;
/** Hiç client kullanılmadan bu kadar beklenince pool kapanır. */
export const POOL_IDLE_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;
const APPLICATION_NAME = 'Tezgah';

/** Sunucuya TCP ile ulaşılamadığını söyleyen kodlar; diğer hatalar el sıkışma ya da kimlik doğrulamadandır. */
const REACH_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

/** Hedefe bağlanılamadı ya da hedefte sorgu başarısız oldu; kullanıcıya gösterilecek neden. */
export class TargetError extends Error {
  constructor(readonly failure: StepFailure) {
    super(failure.mesaj);
  }
}

interface Entry {
  connectionId: string;
  /** Açılış sürerken de aynı hedefe gelen istekler aynı pool'u bekler. */
  pool: Promise<pg.Pool>;
  /** Pool'dan alınıp henüz geri verilmemiş client sayısı. */
  inUse: number;
  idleTimer: unknown;
}

export interface PoolManagerDeps {
  keychain: Keychain;
  /** Keychain'e kaydedilmeyen bağlantıların oturumluk şifreleri (bağlantı kimliği → şifre). */
  sessionPasswords: SessionPasswords;
  clock: Clock;
  log: (line: string) => void;
}

/**
 * Hedef (bağlantı + veritabanı) başına tembel `pg.Pool`. İlk kullanımda açılır, hiç client
 * kullanılmadan `POOL_IDLE_MS` geçince kapanır. Açılışta hiçbir yere bağlanmaz.
 */
export function createPoolManager({ keychain, sessionPasswords, clock, log }: PoolManagerDeps) {
  const entries = new Map<string, Entry>();
  /** Pool'un sunucuya sunduğu şifre; ret (`28P01`) hangi şifreye geldi bilinsin. */
  const poolPasswords = new WeakMap<pg.Pool, string | undefined>();
  const keyOf = (connectionId: string, database: string) => `${connectionId}\u0000${database}`;

  /** Pool'u listeden çıkarır ve kapatır; kullanımdaki client'lar geri verilince kapanış tamamlanır. */
  function remove(key: string, entry: Entry): Promise<void> {
    if (entries.get(key) !== entry) return Promise.resolve();
    entries.delete(key);
    clock.clearTimeout(entry.idleTimer);
    return entry.pool.then(
      (pool) => pool.end().catch(() => {}),
      () => {},
    );
  }

  function scheduleIdle(key: string, entry: Entry) {
    clock.clearTimeout(entry.idleTimer);
    entry.idleTimer = clock.setTimeout(() => {
      if (entry.inUse === 0) void remove(key, entry);
    }, POOL_IDLE_MS);
  }

  /** Hedefin pool'undan bir client alır, `fn` bitince geri verir. */
  async function withClient<T>(connection: Connection, database: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const key = keyOf(connection.id, database);
    let entry = entries.get(key);
    if (!entry) {
      const created: Entry = { connectionId: connection.id, pool: openPool(connection, database), inUse: 0, idleTimer: undefined };
      entry = created;
      entries.set(key, created);
      // Açılamayan pool saklanmaz: sonraki istek (ör. "Tekrar dene") baştan dener.
      created.pool.catch(() => void remove(key, created));
    }
    entry.inUse++;
    clock.clearTimeout(entry.idleTimer);
    try {
      const pool = await entry.pool;
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (err) {
        throw new TargetError(authFailure(err, connection, database, { triedSsl: false, password: poolPasswords.get(pool) }));
      }
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    } finally {
      entry.inUse--;
      if (entry.inUse === 0 && entries.get(key) === entry) scheduleIdle(key, entry);
    }
  }

  async function openPool(connection: Connection, database: string): Promise<pg.Pool> {
    const password = await readPassword(connection);
    const files = await readSslFiles(connection);
    if (!files.ok) throw new TargetError(files.failure);
    const built = buildSslOptions({
      sslmode: connection.sslmode,
      files: files.contents,
      realHost: connection.host,
      checkHostname: (host, cert) => checkServerIdentity(host, cert as PeerCertificate),
    });
    if (!built.ok) throw new TargetError(built.failure);

    // İlk client pool'u sınar; prefer'de sunucu SSL desteklemiyorsa bir kez düz bağlantı.
    let ssl = built.ssl;
    let pool = createPool(connection, database, password, ssl);
    let probe = await tryConnect(pool);
    if (!probe.ok && connection.sslmode === 'prefer' && shouldRetryWithoutSsl(toDriverError(probe.error))) {
      ssl = false;
      pool = createPool(connection, database, password, ssl);
      probe = await tryConnect(pool);
    }
    if (!probe.ok) throw new TargetError(authFailure(probe.error, connection, database, { triedSsl: ssl !== false, password }));
    return pool;
  }

  async function readPassword(connection: Connection): Promise<string | undefined> {
    // Oturumluk şifre henüz verilmediyse sunucu isterse "şifre gerekli" döner.
    if (!connection.savePassword) return sessionPasswords.get(connection.id);
    const read = await keychain.get(passwordAccount(connection.id));
    if (read.result === 'reddedildi') {
      log(`Keychain okuma reddedildi (${connection.id}): ${read.message}`);
      throw new TargetError({
        kod: 'reddedildi',
        mesaj: "Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli); kayıtlı şifre okunamadı.",
        alan: 'password',
        oneriler: ['tekrarDene'],
      });
    }
    return read.result === 'bulundu' ? read.value : undefined;
  }

  /** Sunucu oturumluk şifreyi reddettiyse (`28P01`) şifre unutulur; arayüz yeniden sorar. */
  function authFailure(
    err: unknown,
    connection: Connection,
    database: string,
    { triedSsl, password }: { triedSsl: boolean; password: string | undefined },
  ): StepFailure {
    const failure = classify(err, connection, database, { triedSsl });
    if (isPasswordRejected(failure.kod) && !connection.savePassword) sessionPasswords.forgetRejected(connection.id, password);
    return failure;
  }

  function createPool(connection: Connection, database: string, password: string | undefined, ssl: PgSsl): pg.Pool {
    const pool = new pg.Pool({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      database,
      // Şifre yalnızca sunucu isterse sorulur; yoksa pg'nin .pgpass'a bakmasına izin verilmez.
      password: async () => {
        if (password === undefined || password === '') {
          throw Object.assign(new Error('şifre gerekli'), { code: PASSWORD_REQUIRED });
        }
        return password;
      },
      ssl,
      max: MAX_CLIENTS,
      // Client'lar tek tek kapanmaz; pool bütün olarak boşta kalınca kapanır.
      idleTimeoutMillis: 0,
      connectionTimeoutMillis: TIMEOUT_MS,
      // Yalnızca panelin katalog sorguları bu pool'u kullanıyor; script çalıştırma kendi süresini koyacak.
      query_timeout: TIMEOUT_MS,
      application_name: APPLICATION_NAME,
      ...(isProd(connection.envTag) && { options: '-c default_transaction_read_only=on' }),
    });
    poolPasswords.set(pool, password);
    // Boşta duran client'ın bağlantısı düşerse süreç çökmesin; pool o client'ı atar.
    pool.on('error', (err) => log(`Bağlantı düştü (${connection.name} / ${database}): ${err.message}`));
    return pool;
  }

  async function tryConnect(pool: pg.Pool): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
      (await pool.connect()).release();
      return { ok: true };
    } catch (error) {
      await pool.end().catch(() => {});
      return { ok: false, error };
    }
  }

  return {
    withClient,

    /** Bağlantının tüm pool'larını kapatır (bağlantıyı kes, ayar değişti, silindi). */
    async disconnect(connectionId: string): Promise<void> {
      const closing = [...entries].filter(([, e]) => e.connectionId === connectionId).map(([key, e]) => remove(key, e));
      await Promise.all(closing);
    },

    async closeAll(): Promise<void> {
      await Promise.all([...entries].map(([key, e]) => remove(key, e)));
    },
  };
}

export type PoolManager = ReturnType<typeof createPoolManager>;

function classify(err: unknown, connection: Connection, database: string, { triedSsl }: { triedSsl: boolean }): StepFailure {
  const driverError = toDriverError(err);
  const address = { host: connection.host, port: connection.port, database };
  if (REACH_ERRORS.has(driverError.code ?? '')) return classifyReachError(driverError, address);
  const { adim: _step, ...failure } = classifyConnectError(driverError, { ...address, ssl: triedSsl, sslmode: connection.sslmode });
  return failure;
}
