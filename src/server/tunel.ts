/**
 * Tünel: bir Bağlantının sunucusuna SSH sunucusu üzerinden ulaşma yolu. Yerel port açılmaz; `pg`'ye her
 * client için `forwardOut` kanalını saran bir `Duplex` (`TunnelSocket`) verilir.
 *
 * SSH protokolü bir `SshConnector` arkasındadır (gerçeği ssh2, testlerde sahte). Kimlik doğrulama
 * hazırlığı, host anahtarı doğrulaması ve hataların sınıflandırılması burada, bağlayıcıdan bağımsızdır.
 */
import { readFile } from 'node:fs/promises';
import { Duplex } from 'node:stream';
import type { SshSettings } from '../core/baglanti';
import type { StepFailure } from '../core/baglanti-testi';
import {
  TUNNEL_CLOSED,
  classifySshError,
  hostKeyFailure,
  resolveAgentPath,
  type AgentEnvironment,
  type SshError,
} from '../core/ssh-tuneli';
import type { HostKeyStore } from './host-anahtarlari';
import { resolveHomePath } from './ssl-dosyalari';

export type SshAuthOptions =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: Buffer; passphrase: string | undefined }
  | { type: 'agent'; agent: string };

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  auth: SshAuthOptions;
  /** Sunulan host anahtarı (SSH wire biçiminde ham blob); `false` dönerse el sıkışma kesilir. */
  verifyHostKey(key: Buffer): Promise<boolean>;
}

/** Kurulmuş (kimliği doğrulanmış) SSH oturumu. */
export interface SshSession {
  /** SSH sunucusunun gördüğü `host:port`'a kanal açar. */
  forward(host: string, port: number): Promise<Duplex>;
  close(): void;
  /** Oturum (kopma ya da `close` ile) kapanınca bir kez çağrılır; aboneliği kaldıran fonksiyonu döner. */
  onClose(listener: () => void): () => void;
}

/**
 * SSH sunucusuna bağlanır, host anahtarını `verifyHostKey` ile doğrular ve kimlik doğrular. Hata
 * `SshError` biçimindedir (`level`: ssh2'nin hata düzeyi, anahtar ayrıştırmada `key`).
 */
export type SshConnector = (options: SshConnectOptions) => Promise<SshSession>;

/** Tünel açılamadı; test adımı ya da hedef hatası olarak gösterilecek neden. */
export class TunnelError extends Error {
  constructor(readonly failure: StepFailure) {
    super(failure.mesaj);
  }
}

export interface Tunnel {
  /** `pg`'nin `stream` factory'si için: her çağrıda hedefe (`host:port`, SSH sunucusundan) yeni kanal. */
  socket(host: string, port: number): Duplex;
  /** Hedefe bir kanal açılabiliyor mu (bağlantı testinin "sunucuya ulaşma" adımı). */
  probe(host: string, port: number): Promise<void>;
  close(): void;
  onClose(listener: () => void): () => void;
}

export interface TunnelDeps {
  connector: SshConnector;
  hostKeys: HostKeyStore;
  agentEnvironment: AgentEnvironment;
}

export type OpenTunnel = (ssh: SshSettings, secret: string | undefined) => Promise<Tunnel>;

/** Tüneli açar: kimlik bilgilerini hazırlar, host anahtarını iki `known_hosts`'a karşı doğrular. */
export function createTunnelOpener({ connector, hostKeys, agentEnvironment }: TunnelDeps): OpenTunnel {
  return async function open(ssh, secret) {
    const auth = await authOptions(ssh, secret, agentEnvironment);
    /** Host anahtarı reddedildiyse nedeni; bağlayıcının kendi el sıkışma hatasından önce gelir. */
    let rejected: StepFailure | null = null;
    let session: SshSession;
    try {
      session = await connector({
        host: ssh.host,
        port: ssh.port,
        username: ssh.user,
        auth,
        async verifyHostKey(key) {
          const check = await hostKeys.check(ssh.host, ssh.port, key.toString('base64'));
          if (check.sonuc === 'eslesti') return true;
          rejected = hostKeyFailure(check.sonuc, check.problem);
          return false;
        },
      });
    } catch (err) {
      throw new TunnelError(rejected ?? classifySshError(toSshError(err), ssh, agentEnvironment));
    }
    return wrapSession(session);
  };
}

function wrapSession(session: SshSession): Tunnel {
  let closed = false;
  session.onClose(() => (closed = true));
  return {
    socket: (host, port) => new TunnelSocket(session, host, port, () => closed),
    async probe(host, port) {
      const channel = await forward(session, host, port);
      channel.destroy();
    },
    close: () => session.close(),
    onClose: (listener) => session.onClose(listener),
  };
}

async function authOptions(ssh: SshSettings, secret: string | undefined, environment: AgentEnvironment): Promise<SshAuthOptions> {
  if (ssh.auth === 'password') {
    if (secret === undefined || secret === '') {
      throw new TunnelError({ kod: 'sshSirGerekli', mesaj: 'SSH şifresi gerekli.', alan: 'sshSecret', oneriler: ['sshSirriDuzelt'] });
    }
    return { type: 'password', password: secret };
  }
  if (ssh.auth === 'agent') {
    const agent = resolveAgentPath(ssh, environment);
    if (agent === null) throw new TunnelError(classifySshError({ level: 'agent', message: 'agent yok' }, ssh, environment));
    return { type: 'agent', agent };
  }
  try {
    const privateKey = await readFile(resolveHomePath(ssh.keyPath ?? ''));
    return { type: 'key', privateKey, passphrase: secret === '' ? undefined : secret };
  } catch (err) {
    const { code, message } = err as NodeJS.ErrnoException;
    throw new TunnelError(classifySshError({ level: 'key', code, message }, ssh, environment));
  }
}

function toSshError(err: unknown): SshError {
  const e = err as { level?: unknown; code?: unknown; message?: unknown } | null;
  return {
    level: typeof e?.level === 'string' ? e.level : undefined,
    code: typeof e?.code === 'string' ? e.code : undefined,
    message: String(e?.message ?? err),
  };
}

/**
 * SSH sunucusunun hedefe bağlanamaması (`Channel open failure`): `pg` ve bağlantı testi bunu doğrudan
 * bağlantıdaki ağ hataları gibi sınıflandırsın diye Node koduyla.
 */
async function forward(session: SshSession, host: string, port: number): Promise<Duplex> {
  try {
    return await session.forward(host, port);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    const code = /refused/i.test(message)
      ? 'ECONNREFUSED'
      : /resolve|not known|no address/i.test(message)
        ? 'ENOTFOUND'
        : /timed? ?out/i.test(message)
          ? 'ETIMEDOUT'
          : 'EHOSTUNREACH';
    throw Object.assign(new Error(`SSH sunucusu ${host}:${port} hedefine bağlanamadı: ${message}`), { code });
  }
}

function tunnelClosedError(): Error {
  return Object.assign(new Error('Tünel koptu'), { code: TUNNEL_CLOSED });
}

/**
 * `pg`'nin `stream` sözleşmesi (belgesiz): eşzamanlı `setNoDelay()` ve `connect(port, host)` çağrılır,
 * `'connect'` olayı beklenir; keepAlive açıksa `setKeepAlive`, ayrıca `ref`/`unref`. `connect`'e gelen
 * adres yok sayılır (pg'ye `127.0.0.1` verilir ki TLS SNI'yi ezmesin); kanal kurucudaki hedefe açılır.
 * Tünel koparsa soket `tunelKoptu` koduyla düşer.
 */
export class TunnelSocket extends Duplex {
  private channel: Duplex | null = null;

  constructor(
    private readonly session: SshSession,
    private readonly host: string,
    private readonly port: number,
    private readonly sessionClosed: () => boolean,
  ) {
    super();
  }

  setNoDelay(): this {
    return this;
  }
  setKeepAlive(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }

  connect(): this {
    if (this.sessionClosed()) {
      process.nextTick(() => this.destroy(tunnelClosedError()));
      return this;
    }
    const unsubscribe = this.session.onClose(() => this.destroy(tunnelClosedError()));
    this.once('close', unsubscribe);
    forward(this.session, this.host, this.port).then(
      (channel) => {
        if (this.destroyed) return void channel.destroy();
        this.channel = channel;
        channel.on('data', (chunk: Buffer) => {
          if (!this.push(chunk)) channel.pause();
        });
        channel.on('end', () => this.push(null));
        channel.on('error', (err: Error) => this.destroy(err));
        channel.on('close', () => this.destroy());
        this.emit('connect');
      },
      (err: Error) => this.destroy(err),
    );
    return this;
  }

  override _read(): void {
    this.channel?.resume();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.channel) return callback(new Error('Tünel kanalı açık değil'));
    this.channel.write(chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.channel?.end();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.channel?.destroy();
    callback(error);
  }
}
