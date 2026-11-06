/**
 * Gerçek ssh2 bağlayıcısı, süreç içindeki bir ssh2 `Server`'a karşı: host anahtarı blob'u, şifre ve
 * anahtar ile kimlik doğrulama, hata düzeyleri ve `pg`'nin `forwardOut` kanalı (TunnelSocket) üzerinden
 * sorgu çalıştırması. Gerçek sshd ile aynı sözleşme `tunel-sshd.test.ts`'te (opsiyonel).
 */
import { createHash } from 'node:crypto';
import { connect, createServer, type AddressInfo } from 'node:net';
import pg from 'pg';
import { Server, utils, type Connection as SshServerConnection, type ParsedKey } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUNNEL_CLOSED } from '../core/ssh-tuneli';
import type { HostKeyLookup, HostKeyStore } from './host-anahtarlari';
import { ssh2Connector } from './ssh2-baglayici';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { TunnelError, createTunnelOpener } from './tunel';

const hostKey = utils.generateKeyPairSync('ed25519');
const clientKey = utils.generateKeyPairSync('ed25519', { passphrase: 'pp', cipher: 'aes256-ctr', rounds: 4 });
const clientPublic = utils.parseKey(clientKey.public) as ParsedKey;
/** Sunucunun sunduğu host anahtarının blob'u (known_hosts'taki base64 alan). */
const hostBlob = (utils.parseKey(hostKey.public) as ParsedKey).getPublicSSH().toString('base64');

let server: Server;
let port: number;
let fakePg: FakePostgres;
const sessions = new Set<SshServerConnection>();

beforeEach(async () => {
  fakePg = await startFakePostgres({ password: 'gizli' });
  server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    sessions.add(client);
    client.on('close', () => sessions.delete(client));
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'deploy' && ctx.password === 'ssh-gizli') return ctx.accept();
      if (ctx.method === 'publickey') {
        const same = ctx.key.algo === clientPublic.type && ctx.key.data.equals(clientPublic.getPublicSSH());
        if (same && (!ctx.signature || clientPublic.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true)) return ctx.accept();
      }
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => {
      client.on('tcpip', (accept, reject, info) => {
        const socket = connect({ host: info.destIP, port: info.destPort });
        socket.once('error', () => reject?.());
        socket.once('connect', () => {
          const channel = accept();
          channel.pipe(socket).pipe(channel);
          channel.on('close', () => socket.destroy());
          socket.on('close', () => channel.close());
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const s of sessions) s.end();
  await new Promise((resolve) => server.close(resolve));
  await fakePg.close();
});

function opener(lookup: HostKeyLookup = { sonuc: 'eslesti' }, seen: string[] = []) {
  const hostKeys: HostKeyStore = {
    check: async (_host, _port, key) => {
      seen.push(key);
      return lookup;
    },
    trust: async () => {},
    forget: async () => 0,
  };
  return createTunnelOpener({ connector: ssh2Connector, hostKeys, agentEnvironment: { platform: 'linux', env: {} } });
}

const settings = (overrides = {}) => ({
  host: '127.0.0.1',
  port,
  user: 'deploy',
  auth: 'password' as const,
  keyPath: null,
  agentPath: null,
  saveSecret: true,
  ...overrides,
});

const pgClient = (tunnel: Awaited<ReturnType<ReturnType<typeof opener>>>) =>
  new pg.Client({
    host: '127.0.0.1',
    port: fakePg.port,
    user: 'postgres',
    password: 'gizli',
    database: 'postgres',
    keepAlive: true,
    stream: () => tunnel.socket('127.0.0.1', fakePg.port),
  });

describe('ssh2 bağlayıcısı', () => {
  it('host anahtarını ham blob olarak doğrulatır; pg tünel kanalı üzerinden sorgu çalıştırır', async () => {
    const seen: string[] = [];
    const tunnel = await opener({ sonuc: 'eslesti' }, seen)(settings(), 'ssh-gizli');
    expect(seen).toEqual([hostBlob]);
    const client = pgClient(tunnel);
    await client.connect();
    expect((await client.query('SELECT 1')).rows).toEqual([{ ad: 'postgres' }]);
    await client.end();
    tunnel.close();
  });

  it('tünel kapanınca bağlı client tunelKoptu koduyla düşer', async () => {
    const tunnel = await opener()(settings(), 'ssh-gizli');
    const client = pgClient(tunnel);
    await client.connect();
    const failed = new Promise<unknown>((resolve) => client.on('error', resolve));
    for (const s of sessions) s.end();
    expect(await failed).toMatchObject({ code: TUNNEL_CLOSED });
  });

  it('reddedilen host anahtarında el sıkışma kesilir ve yapısal hata döner', async () => {
    const problem = {
      host: '127.0.0.1',
      port,
      tur: 'ssh-ed25519',
      parmakIzi: `SHA256:${createHash('sha256').update(Buffer.from(hostBlob, 'base64')).digest('base64').replace(/=+$/, '')}`,
      anahtar: hostBlob,
      digerTurler: [],
      kayitli: [],
      kaynak: null,
      iptal: false,
    };
    const error = await opener({ sonuc: 'bilinmiyor', problem })(settings(), 'ssh-gizli').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TunnelError);
    expect((error as TunnelError).failure).toMatchObject({ kod: 'hostKeyUnknown', hostAnahtari: problem });
    await vi.waitFor(() => expect(sessions.size).toBe(0));
  });

  it('yanlış şifre SSH sırrının reddidir', async () => {
    const error = (await opener()(settings(), 'yanlis').catch((e: unknown) => e)) as TunnelError;
    expect(error.failure.kod).toBe('sshSirReddedildi');
  });

  it('şifreli anahtar: passphrase yoksa istenir, yanlışsa reddedilir, doğruysa bağlanır', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'tezgah-key-'));
    const keyPath = join(dir, 'id_ed25519');
    await writeFile(keyPath, clientKey.private);
    try {
      const key = settings({ auth: 'key', keyPath });
      expect(((await opener()(key, undefined).catch((e: unknown) => e)) as TunnelError).failure.kod).toBe('sshSirGerekli');
      expect(((await opener()(key, 'yanlis').catch((e: unknown) => e)) as TunnelError).failure.kod).toBe('sshSirReddedildi');
      const tunnel = await opener()(key, 'pp');
      tunnel.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('kapalı porttaki SSH sunucusu: bağlantı reddi SSH portuna bağlanır', async () => {
    const free = createServer();
    await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve));
    const closedPort = (free.address() as AddressInfo).port;
    await new Promise((resolve) => free.close(resolve));
    const error = (await opener()(settings({ port: closedPort }), 'ssh-gizli').catch((e: unknown) => e)) as TunnelError;
    expect(error.failure).toMatchObject({ kod: 'ECONNREFUSED', alan: 'sshPort' });
  });

  it("agent soketi yoksa agentYok", async () => {
    const error = (await opener()(settings({ auth: 'agent', agentPath: '/yok/agent.sock' }), undefined).catch((e: unknown) => e)) as TunnelError;
    expect(error.failure).toMatchObject({ kod: 'agentYok', alan: 'sshAgentPath' });
  });
});
