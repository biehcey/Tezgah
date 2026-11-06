import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import type { SshAuthOptions, SshConnector, SshSession } from '../tunel';

/** ssh-keygen ile üretilmiş ed25519 host anahtarları (base64 blob) ve parmak izleri. */
export const HOST_KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIEU8D5up28tG1prR24yj9n15BaO74pWE01De7QehVbhR';
export const HOST_KEY_FP = 'SHA256:/aVfHyjB4cQdc1A3AIz9e7iLfEjEgWvgxjZr1g5opAI';
export const OTHER_HOST_KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIOyP74ydz9Ps58dooYInbvOU8kWYkMRfi7Ec5Stxiyth';
export const OTHER_HOST_KEY_FP = 'SHA256:nsK4jZTmc4LQvZA4GlALZoYYwbvwFt11c09fwTQhKf8';

/**
 * Sahte SSH sunucusu: host anahtarını sunar, kimlik doğrulamayı `accepts` ile karara bağlar ve
 * kanalları gerçek TCP ile (`127.0.0.1` üzerindeki sahte Postgres'e) açar.
 */
export interface FakeSsh {
  connector: SshConnector;
  /** Sunulan host anahtarı. */
  hostKey: string;
  /** Kimlik doğrulama kabul edilsin mi. */
  accepts: (auth: SshAuthOptions) => boolean;
  /** Bağlanma denemeleri (host anahtarı reddedilenler dahil). */
  connects: { host: string; port: number; username: string; auth: SshAuthOptions }[];
  /** Açık oturum sayısı. */
  readonly open: number;
  /** Açılan kanalların hedefleri. */
  forwards: string[];
  /** Tüm oturumları düşürür (tünel koptu): önce oturum kapanır, sonra kanallar. */
  drop(): void;
}

export function createFakeSsh(): FakeSsh {
  const sessions = new Set<{ fireClose: () => void; channels: Set<Duplex> }>();
  const fake: FakeSsh = {
    hostKey: HOST_KEY,
    accepts: () => true,
    connects: [],
    forwards: [],
    get open() {
      return sessions.size;
    },
    drop() {
      for (const s of [...sessions]) s.fireClose();
    },
    connector: async (options) => {
      fake.connects.push({ host: options.host, port: options.port, username: options.username, auth: options.auth });
      if (!(await options.verifyHostKey(Buffer.from(fake.hostKey, 'base64')))) {
        throw Object.assign(new Error('Host denied (verification failed)'), { level: 'handshake' });
      }
      if (!fake.accepts(options.auth)) {
        throw Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' });
      }
      const listeners = new Set<() => void>();
      let closed = false;
      const state = {
        channels: new Set<Duplex>(),
        fireClose() {
          if (closed) return;
          closed = true;
          sessions.delete(state);
          for (const l of [...listeners]) l();
          for (const c of state.channels) c.destroy();
        },
      };
      sessions.add(state);
      const session: SshSession = {
        forward: (host, port) =>
          new Promise((resolve, reject) => {
            fake.forwards.push(`${host}:${port}`);
            const socket = connect({ host, port });
            socket.once('connect', () => {
              state.channels.add(socket);
              socket.once('close', () => state.channels.delete(socket));
              resolve(socket);
            });
            socket.once('error', (err) => reject(new Error(`(SSH) Channel open failure: ${err.message.includes('ECONNREFUSED') ? 'Connection refused' : err.message}`)));
          }),
        close: () => state.fireClose(),
        onClose(listener) {
          if (closed) {
            queueMicrotask(listener);
            return () => {};
          }
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      return session;
    },
  };
  return fake;
}
