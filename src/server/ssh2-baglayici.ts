/**
 * `SshConnector`'ın ssh2 implementasyonu. ssh2 tsup ile `dist/server`'a gömülür; native binding'ler
 * dışarıda kaldığından her zaman JS / Node `crypto` yolu kullanılır (wayfinder 19).
 */
import type { Duplex } from 'node:stream';
import { Client, type ConnectConfig } from 'ssh2';
import type { SshConnector, SshSession } from './tunel';

/** Kopmayı ~45 sn'de fark etmek için (ticket 17). */
const KEEPALIVE_INTERVAL_MS = 15_000;
const KEEPALIVE_COUNT_MAX = 3;
const READY_TIMEOUT_MS = 20_000;

type LeveledError = Error & { level?: string };

export const ssh2Connector: SshConnector = (options) =>
  new Promise<SshSession>((resolve, reject) => {
    const client = new Client();
    let ready = false;
    let closed = false;
    /** Agent'a bağlanılamazsa ssh2 bunu bildirip sonraki yönteme geçer; asıl neden budur. */
    let agentError: LeveledError | null = null;
    const listeners = new Set<() => void>();
    const fireClose = () => {
      if (closed) return;
      closed = true;
      for (const listener of [...listeners]) listener();
    };
    const fail = (err: LeveledError) => {
      if (ready) return;
      ready = true; // yalnızca bir kez reddedilsin
      reject(err);
      client.end();
    };

    const session: SshSession = {
      forward: (host, port) =>
        new Promise<Duplex>((done, failForward) => {
          client.forwardOut('127.0.0.1', 0, host, port, (err, channel) => (err ? failForward(err) : done(channel)));
        }),
      close: () => client.end(),
      onClose(listener) {
        if (closed) {
          queueMicrotask(listener);
          return () => {};
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    client.on('ready', () => {
      ready = true;
      resolve(session);
    });
    client.on('error', (err: LeveledError) => {
      if (err.level === 'agent') {
        agentError = err;
        return;
      }
      if (!ready) return fail(agentError && err.level === 'client-authentication' ? agentError : err);
      // Kurulmuş oturumda hata (ör. keepalive yanıtsız): ssh2 soketi kapatır, `close` gelir.
    });
    client.on('close', () => {
      fail(agentError ?? Object.assign(new Error('SSH oturumu el sıkışmadan kapandı'), { level: 'protocol' }));
      fireClose();
    });

    const { auth } = options;
    const config: ConnectConfig = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: KEEPALIVE_COUNT_MAX,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        options.verifyHostKey(key).then(verify, () => verify(false));
      },
    };
    if (auth.type === 'password') {
      Object.assign(config, { password: auth.password, tryKeyboard: true });
      // Bazı sunucular şifreyi yalnızca keyboard-interactive ile kabul eder. Şifre yalnızca tek,
      // gizli bir isteme verilir; birden çok istem (ör. şifre + OTP) yanıtsız kalır ve giriş reddedilir.
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) =>
        finish(prompts.length === 1 && !prompts[0]!.echo ? [auth.password] : prompts.map(() => '')),
      );
    } else if (auth.type === 'key') {
      Object.assign(config, { privateKey: auth.privateKey, passphrase: auth.passphrase });
    } else {
      config.agent = auth.agent;
    }
    try {
      client.connect(config);
    } catch (err) {
      // Anahtar ayrıştırılamadı (passphrase yok/yanlış, desteklenmeyen biçim) eşzamanlı fırlatılır.
      fail(Object.assign(err as Error, { level: 'key' }));
    }
  });
