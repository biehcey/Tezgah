import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import pg from 'pg';
import { isProd, type Connection } from '../core/baglanti';
import { buildSslOptions, type PgSsl } from '../core/baglanti-ssl';
import {
  PASSWORD_REQUIRED,
  classifyConnectError,
  classifyListError,
  isPasswordRejected,
  classifyReachError,
  shouldRetryWithoutSsl,
  toDriverError,
  type StepFailure,
} from '../core/baglanti-testi';
import type { TargetErrorResponse } from '../core/veritabani-secimi';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, notFound } from './http';
import { passwordAccount, sshSecretAccount, type Keychain } from './keychain';
import type { SessionPasswords } from './oturum-sifreleri';
import type { Clock } from './saat';
import { readSslFiles } from './ssl-dosyalari';
import { TunnelError, type OpenTunnel, type Tunnel } from './tunel';

/** Hedef başına aynı anda açık en fazla oturum (client tutan script çalıştırması). */
export const MAX_SESSIONS = 5;
/**
 * Pool'un en fazla client sayısı: oturumlar + kısa süreli sorgulara ayrılan bir yer. Böylece 5 oturum
 * açıkken de katalog okunur ve çalışan ifade iptal edilebilir (iptal ayrı bir client ister).
 */
const MAX_CLIENTS = MAX_SESSIONS + 1;
/** Hiç client kullanılmadan bu kadar beklenince pool kapanır. */
export const POOL_IDLE_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;

/**
 * Panelin ve çalıştırıcının kendi kısa sorguları; 10 sn'de zaman aşımına uğrar. Script ifadelerine
 * süre konmaz (iptal edilebilirler), bu yüzden süre pool'da değil sorgu başına verilir.
 */
export async function catalogQuery<R extends pg.QueryResultRow>(client: pg.ClientBase, text: string, values?: unknown[]): Promise<R[]> {
  // `query_timeout` sorgu başına desteklenir ama @types/pg'de tanımlı değil.
  const config = { text, values, query_timeout: TIMEOUT_MS } as pg.QueryConfig;
  return (await client.query<R>(config)).rows;
}
const APPLICATION_NAME = 'Tezgah';

/** Sunucuya TCP ile ulaşılamadığını söyleyen kodlar; diğer hatalar el sıkışma ya da kimlik doğrulamadandır. */
const REACH_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

/** Hedefte `MAX_SESSIONS` oturum açık; yeni oturum kuyrukta beklemeden reddedilir. */
export class PoolFullError extends Error {
  constructor(readonly sessions: number) {
    super(`Bu hedefte ${sessions} açık oturum var; en fazla ${MAX_SESSIONS} oturum açılabilir. Birini bitirip tekrar deneyin.`);
  }
}

/** `ifFree` istendi ama pool'un tüm client'ları kullanımda; sorgu kuyrukta beklemeden atlanır. */
export class PoolBusyError extends Error {
  constructor() {
    super("Pool'un tüm client'ları kullanımda");
  }
}

/** Hedefe bağlanılamadı ya da hedefte sorgu başarısız oldu; kullanıcıya gösterilecek neden. */
export class TargetError extends Error {
  constructor(readonly failure: StepFailure) {
    super(failure.mesaj);
  }

  /** İstemciye giden 502 gövdesi. */
  get body(): TargetErrorResponse {
    const { mesaj: hata, kod, hostAnahtari } = this.failure;
    return { hata, kod, ...(hostAnahtari && { hostAnahtari }) };
  }
}

/**
 * Değerler Postgres'in metni olarak gelir: JSON'a kayıpsız girer (bigint, numeric, tarih), sahte
 * ve gerçek Postgres'te aynı biçimde ayrıştırılır, keyset imleci aynı metinle geri gönderilir.
 */
export const RAW_TYPES = { getTypeParser: () => (value: string) => value };

interface Entry {
  connectionId: string;
  /** Açılış sürerken de aynı hedefe gelen istekler aynı pool'u bekler. */
  pool: Promise<pg.Pool>;
  /** Pool'dan alınıp henüz geri verilmemiş client sayısı. */
  inUse: number;
  /** Bunlardan oturum olarak alınanlar (kısa süreli sorgular sayılmaz). */
  sessions: number;
  idleTimer: unknown;
}

export interface PoolManagerDeps {
  keychain: Keychain;
  /** Keychain'e kaydedilmeyen bağlantıların oturumluk şifreleri (bağlantı kimliği → şifre). */
  sessionPasswords: SessionPasswords;
  clock: Clock;
  openTunnel: OpenTunnel;
  log: (line: string) => void;
}

/** Tünel üzerinde `pg`'ye verilen host: IP olmalı ki `pg` TLS SNI'yi bununla ezmesin (gerçek host SSL nesnesinde). */
const TUNNEL_PG_HOST = '127.0.0.1';

/**
 * Hedef (bağlantı + veritabanı) başına tembel `pg.Pool`. İlk kullanımda açılır, hiç client
 * kullanılmadan `POOL_IDLE_MS` geçince kapanır. Açılışta hiçbir yere bağlanmaz.
 */
export function createPoolManager({ keychain, sessionPasswords, clock, openTunnel, log }: PoolManagerDeps) {
  const entries = new Map<string, Entry>();
  /** Bağlantı başına tek tünel; o bağlantının tüm pool'ları paylaşır. */
  const tunnels = new Map<string, Promise<Tunnel>>();
  /** Pool'un sunucuya sunduğu şifre; ret (`28P01`) hangi şifreye geldi bilinsin. */
  const poolPasswords = new WeakMap<pg.Pool, string | undefined>();
  const keyOf = (connectionId: string, database: string) => `${connectionId}\u0000${database}`;
  /** `closeAll` çağrıldı: yeni pool açılmaz, yoksa kapanıştan sonra açılan pool hiç kapanmazdı. */
  let closed = false;

  /** Pool'u listeden çıkarır ve kapatır; kullanımdaki client'lar geri verilince kapanış tamamlanır. */
  function remove(key: string, entry: Entry): Promise<void> {
    if (entries.get(key) !== entry) return Promise.resolve();
    entries.delete(key);
    clock.clearTimeout(entry.idleTimer);
    const closed = entry.pool.then(
      (pool) => pool.end().catch(() => {}),
      () => {},
    );
    // Son pool kapanınca tünel de kapanır.
    return closed.then(() => {
      if (![...entries.values()].some((e) => e.connectionId === entry.connectionId)) closeTunnel(entry.connectionId);
    });
  }

  function closeTunnel(connectionId: string) {
    const tunnel = tunnels.get(connectionId);
    if (!tunnel) return;
    tunnels.delete(connectionId);
    tunnel.then((t) => t.close(), () => {});
  }

  /** Tembel: bağlantının ilk pool'u açılırken. Kopunca bağlantının tüm pool'ları atılır; yeniden bağlanma yok. */
  function tunnelFor(connection: Connection): Promise<Tunnel> {
    const existing = tunnels.get(connection.id);
    if (existing) return existing;
    const opening = (async () => {
      const secret = await readSshSecret(connection);
      try {
        return await openTunnel(connection.ssh!, secret);
      } catch (err) {
        if (!(err instanceof TunnelError)) throw err;
        if (err.failure.kod === 'sshSirReddedildi' && !connection.ssh!.saveSecret) {
          sessionPasswords.forgetRejected(sshSecretAccount(connection.id), secret);
        }
        throw new TargetError(err.failure);
      }
    })();
    tunnels.set(connection.id, opening);
    opening.then(
      (tunnel) =>
        tunnel.onClose(() => {
          if (tunnels.get(connection.id) !== opening) return;
          tunnels.delete(connection.id);
          log(`Tünel koptu (${connection.name}); bağlantının pool'ları atıldı.`);
          void dropPools(connection.id);
        }),
      () => {
        if (tunnels.get(connection.id) === opening) tunnels.delete(connection.id);
      },
    );
    return opening;
  }

  function dropPools(connectionId: string): Promise<void> {
    const closing = [...entries].filter(([, e]) => e.connectionId === connectionId).map(([key, e]) => remove(key, e));
    return Promise.all(closing).then(() => closeTunnel(connectionId));
  }

  async function readSshSecret(connection: Connection): Promise<string | undefined> {
    const ssh = connection.ssh!;
    if (ssh.auth === 'agent') return undefined;
    if (!ssh.saveSecret) return sessionPasswords.get(sshSecretAccount(connection.id));
    const read = await keychain.get(sshSecretAccount(connection.id));
    if (read.result === 'reddedildi') {
      log(`Keychain okuma reddedildi (${connection.id}:ssh): ${read.message}`);
      throw new TargetError({
        kod: 'reddedildi',
        mesaj: "Keychain'e erişilemedi (erişim reddedildi ya da keychain kilitli); kayıtlı SSH sırrı okunamadı.",
        alan: 'sshSecret',
        oneriler: ['tekrarDene'],
      });
    }
    return read.result === 'bulundu' ? read.value : undefined;
  }

  function scheduleIdle(key: string, entry: Entry) {
    clock.clearTimeout(entry.idleTimer);
    entry.idleTimer = clock.setTimeout(() => {
      if (entry.inUse === 0) void remove(key, entry);
    }, POOL_IDLE_MS);
  }

  /**
   * Hedefin pool'undan bir client alır, `fn` bitince geri verir. `fn` bağlantısı bozulan client'ı
   * `discard` ile işaretlerse client pool'a dönmez, kapatılır. `session`: client uzun süre tutulacak
   * (script çalıştırma); hedefte `MAX_SESSIONS` oturum açıksa beklemeden `PoolFullError` atılır.
   * Kısa süreli sorgular (katalog, iptal) oturum sayılmaz. `ifFree`: pool'un tüm client'ları
   * kullanımdaysa beklemeden `PoolBusyError` atılır (bekletme izleyicisinin tiki).
   */
  async function withClient<T>(
    connection: Connection,
    database: string,
    fn: (client: pg.PoolClient, discard: () => void) => Promise<T>,
    { session = false, ifFree = false }: { session?: boolean; ifFree?: boolean } = {},
  ): Promise<T> {
    if (closed) throw new Error('Tezgah kapanıyor; yeni bağlantı açılmaz');
    const key = keyOf(connection.id, database);
    let entry = entries.get(key);
    if (session && entry && entry.sessions >= MAX_SESSIONS) throw new PoolFullError(entry.sessions);
    if (ifFree && entry && entry.inUse >= MAX_CLIENTS) throw new PoolBusyError();
    if (!entry) {
      const created: Entry = {
        connectionId: connection.id,
        pool: openPool(connection, database),
        inUse: 0,
        sessions: 0,
        idleTimer: undefined,
      };
      entry = created;
      entries.set(key, created);
      // Açılamayan pool saklanmaz: sonraki istek (ör. "Tekrar dene") baştan dener.
      created.pool.catch(() => void remove(key, created));
    }
    entry.inUse++;
    if (session) entry.sessions++;
    clock.clearTimeout(entry.idleTimer);
    try {
      const pool = await entry.pool;
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (err) {
        throw new TargetError(authFailure(err, connection, database, { triedSsl: false, password: poolPasswords.get(pool) }));
      }
      let discarded = false;
      // Checkout sırasında pool'un dinleyicisi yok: sorgu sürerken bağlantı düşerse süreç çökmesin.
      // Sorgu zaten hatayla döner; client pool'a dönmez. Oturumlar düşmeyi kendi dinleyicileriyle yazar.
      const onError = (err: Error) => {
        discarded = true;
        if (!session) log(`Bağlantı düştü (${connection.name} / ${database}): ${err.message}`);
      };
      client.on('error', onError);
      try {
        return await fn(client, () => (discarded = true));
      } finally {
        client.off('error', onError);
        client.release(discarded || undefined);
      }
    } finally {
      entry.inUse--;
      if (session) entry.sessions--;
      if (entry.inUse === 0 && entries.get(key) === entry) scheduleIdle(key, entry);
    }
  }

  async function openPool(connection: Connection, database: string): Promise<pg.Pool> {
    const tunnel = connection.ssh ? await tunnelFor(connection) : null;
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
    let pool = createPool(connection, database, password, ssl, tunnel);
    let probe = await tryConnect(pool);
    if (!probe.ok && connection.sslmode === 'prefer' && shouldRetryWithoutSsl(toDriverError(probe.error))) {
      ssl = false;
      pool = createPool(connection, database, password, ssl, tunnel);
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

  function createPool(
    connection: Connection,
    database: string,
    password: string | undefined,
    ssl: PgSsl,
    tunnel: Tunnel | null,
  ): pg.Pool {
    const pool = new pg.Pool({
      host: tunnel ? TUNNEL_PG_HOST : connection.host,
      port: connection.port,
      // Her client için tünelden yeni kanal; yerel port açılmaz.
      ...(tunnel && { stream: () => tunnel.socket(connection.host, connection.port) }),
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

    /** Bağlantının tüm pool'larını ve tünelini kapatır (bağlantıyı kes, ayar değişti, silindi). */
    disconnect: dropPools,

    async closeAll(): Promise<void> {
      closed = true;
      await Promise.all([...entries].map(([key, e]) => remove(key, e)));
      for (const id of [...tunnels.keys()]) closeTunnel(id);
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

/** Hedefte sorgu başarısız oldu: sürücü hatası sınıflanır, mesaj `<ne> okunamadı: …` olur. */
export function targetQueryError(err: unknown, what: string): TargetError {
  const driver = toDriverError(err);
  return new TargetError({ ...classifyListError(driver), mesaj: `${what} okunamadı: ${driver.message}` });
}

/**
 * `POST /api/baglantilar/:id/veritabanlari/:db/<uç>` iskeleti: yol eşleşmesi, yöntem (405), kimlik
 * ve veritabanı çözümü, bağlantı araması (404) ve hedef hatasının 502 gövdesi. `handle` gövdeyi
 * ayrıştırır ve işi yapar; `TargetError` dışındaki hatalar yukarı gider.
 */
export function targetPostRoute(
  store: SettingsStore,
  path: RegExp,
  handle: (req: IncomingMessage, res: ServerResponse, connection: Connection, database: string) => Promise<void>,
) {
  return async function route(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const match = path.exec(pathname);
    if (!match) return false;
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return true;
    }
    const id = decodeURIComponent(match[1]!);
    const database = decodeURIComponent(match[2]!);
    const connection = (await store.read()).connections.find((c) => c.id === id);
    if (!connection) {
      notFound(res, 'Bağlantı bulunamadı');
      return true;
    }
    try {
      await handle(req, res, connection, database);
    } catch (err) {
      if (!(err instanceof TargetError)) throw err;
      json(res, 502, err.body);
    }
    return true;
  };
}
