/**
 * ssh2 `forwardOut` kanalı ile `pg`'nin belgesiz `stream` sözleşmesi (TunnelSocket) gerçek bir sshd'ye
 * karşı. Yalnızca ortam değişkenleri tanımlıysa koşar:
 *
 * - `TEZGAH_TEST_SSH_URL`: `ssh://kullanıcı[:şifre]@host[:port]`; şifre yoksa `SSH_AUTH_SOCK` agent'ı.
 * - `TEZGAH_TEST_SSH_PG_URL`: SSH sunucusunun gördüğü Postgres, ör. `postgres://postgres:gizli@127.0.0.1:5432/postgres`.
 *
 * Host anahtarı burada doğrulanmaz (sözleşme testi); doğrulama akışı sahte tünelle sınanır.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TUNNEL_CLOSED } from '../core/ssh-tuneli';
import type { HostKeyStore } from './host-anahtarlari';
import { ssh2Connector } from './ssh2-baglayici';
import { createTunnelOpener, type Tunnel } from './tunel';

const sshUrl = process.env.TEZGAH_TEST_SSH_URL;
const pgUrl = process.env.TEZGAH_TEST_SSH_PG_URL;
const describeSshd = sshUrl && pgUrl ? describe : describe.skip;

describeSshd('gerçek sshd üzerinden tünel', () => {
  const ssh = new URL(sshUrl ?? 'ssh://x@localhost');
  const target = new URL(pgUrl ?? 'postgres://x@localhost');
  const trustAll: HostKeyStore = {
    check: async () => ({ sonuc: 'eslesti' }),
    trust: async () => {},
    forget: async () => 0,
  };
  let tunnel: Tunnel;

  beforeAll(async () => {
    const open = createTunnelOpener({
      connector: ssh2Connector,
      hostKeys: trustAll,
      agentEnvironment: { platform: process.platform, env: process.env },
    });
    const password = decodeURIComponent(ssh.password);
    tunnel = await open(
      {
        host: ssh.hostname,
        port: Number(ssh.port || 22),
        user: decodeURIComponent(ssh.username),
        auth: password ? 'password' : 'agent',
        keyPath: null,
        agentPath: null,
        saveSecret: false,
      },
      password || undefined,
    );
  });
  afterAll(() => tunnel?.close());

  const client = () =>
    new pg.Client({
      host: '127.0.0.1',
      port: Number(target.port || 5432),
      user: decodeURIComponent(target.username),
      password: decodeURIComponent(target.password),
      database: target.pathname.slice(1) || 'postgres',
      keepAlive: true,
      stream: () => tunnel.socket(target.hostname, Number(target.port || 5432)),
    });

  it('pg tünel kanalı üzerinden bağlanır ve sorgu çalıştırır; yerel port açılmaz', async () => {
    const c = client();
    await c.connect();
    const { rows } = await c.query<{ n: number }>('SELECT 1::int AS n');
    expect(rows).toEqual([{ n: 1 }]);
    await c.end();
  });

  it('aynı tünelde birden çok client', async () => {
    const clients = [client(), client(), client()];
    await Promise.all(clients.map((c) => c.connect()));
    const pids = await Promise.all(clients.map(async (c) => (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid));
    expect(new Set(pids).size).toBe(3);
    await Promise.all(clients.map((c) => c.end()));
  });

  it('tünel kapanınca bağlı client tunelKoptu hatasıyla düşer', async () => {
    const c = client();
    await c.connect();
    const failed = new Promise<unknown>((resolve) => c.on('error', resolve));
    tunnel.close();
    expect(await failed).toMatchObject({ code: TUNNEL_CLOSED });
  });
});
