/**
 * Host anahtarı deposu: kullanıcının `~/.ssh/known_hosts`'u (salt okunur, güvenilir) ve Tezgah'ın
 * yapılandırma dizinindeki kendi `known_hosts`'u. Onaylanan anahtarlar yalnızca Tezgah'ınkine yazılır.
 */
import { createHash, createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkHostKey,
  forgetHost,
  hostKeyFingerprint,
  hostKeyType,
  knownHostsLine,
  type KnownHostsCrypto,
} from '../core/known-hosts';
import type { HostKeyForgetResponse, HostKeyProblem, HostKeyTrustResponse } from '../core/ssh-tuneli';
import { json, methodNotAllowed, readJson } from './http';

export const KNOWN_HOSTS_FILE = 'known_hosts';

export const nodeKnownHostsCrypto: KnownHostsCrypto = {
  hmacSha1: (salt, text) => createHmac('sha1', Buffer.from(salt, 'base64')).update(text).digest('base64'),
  sha256: (data) => createHash('sha256').update(Buffer.from(data, 'base64')).digest('base64'),
};

export type HostKeyLookup = { sonuc: 'eslesti' } | { sonuc: 'bilinmiyor' | 'uyusmazlik'; problem: HostKeyProblem };

export interface HostKeyStore {
  /** Önce kullanıcının dosyası; orada karar çıkmazsa (bilinmiyor) Tezgah'ın deposu. */
  check(host: string, port: number, key: string): Promise<HostKeyLookup>;
  /** "Güven ve tekrar dene": anahtarı Tezgah'ın deposuna ekler. */
  trust(host: string, port: number, key: string): Promise<void>;
  /** "Kayıtlı host anahtarını unut": Tezgah'ın deposundaki satırları siler; kullanıcının dosyasına dokunmaz. */
  forget(host: string, port: number): Promise<number>;
}

export function createHostKeyStore({ configDir, homeDir }: { configDir: string; homeDir: string }): HostKeyStore {
  const userFile = join(homeDir, '.ssh', KNOWN_HOSTS_FILE);
  const ownFile = join(configDir, KNOWN_HOSTS_FILE);
  const crypto = nodeKnownHostsCrypto;
  let queue: Promise<unknown> = Promise.resolve();
  /** Yazmalar sıraya girer: aynı anda iki onay satırı birbirini ezmesin. */
  const serialized = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  return {
    async check(host, port, key) {
      const target = { host, port, key };
      const user = checkHostKey(await readText(userFile), target, crypto);
      const own = user.sonuc === 'bilinmiyor' ? checkHostKey(await readText(ownFile), target, crypto) : null;
      const result = own ?? user;
      if (result.sonuc === 'eslesti') return result;
      const problem: HostKeyProblem = {
        host,
        port,
        tur: hostKeyType(key) ?? 'bilinmeyen',
        parmakIzi: hostKeyFingerprint(key, crypto),
        anahtar: key,
        digerTurler: result.sonuc === 'bilinmiyor' ? [...new Set([...(user.sonuc === 'bilinmiyor' ? user.digerTurler : []), ...result.digerTurler])] : [],
        kayitli: result.sonuc === 'uyusmazlik' ? result.kayitli : [],
        kaynak: result.sonuc === 'uyusmazlik' ? (own ? 'tezgah' : 'kullanici') : null,
        iptal: result.sonuc === 'uyusmazlik' && result.iptal,
      };
      return { sonuc: result.sonuc, problem };
    },

    trust: (host, port, key) =>
      serialized(async () => {
        await mkdir(configDir, { recursive: true });
        const current = await readText(ownFile);
        const separator = current === '' || current.endsWith('\n') ? '' : '\n';
        await appendFile(ownFile, `${separator}${knownHostsLine({ host, port, key })}\n`, { encoding: 'utf8', mode: 0o600 });
      }),

    forget: (host, port) =>
      serialized(async () => {
        const current = await readText(ownFile);
        const { text, removed } = forgetHost(current, { host, port }, crypto);
        if (removed === 0) return 0;
        const tmp = `${ownFile}.${process.pid}.tmp`;
        try {
          await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
          await rename(tmp, ownFile);
        } catch (err) {
          await unlink(tmp).catch(() => {});
          throw err;
        }
        return removed;
      }),
  };
}

/** Dosya yoksa boş; okunamıyorsa da boş sayılır (kullanıcının dosyası izin dışıysa tünel yine sorar). */
async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

const PATH = /^\/api\/host-anahtarlari(\/unut)?$/;

/** `POST /api/host-anahtarlari` (güven) ve `POST /api/host-anahtarlari/unut`. İsteği ele aldıysa `true`. */
export function createHostKeyRoutes({ hostKeys }: { hostKeys: HostKeyStore }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const match = PATH.exec(pathname);
    if (!match) return false;
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return true;
    }
    const body = await readJson(req);
    const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const { host, port, anahtar } = input;
    if (typeof host !== 'string' || host.trim() === '' || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      json(res, 400, { hata: 'Geçersiz host ya da port' });
      return true;
    }
    if (match[1]) {
      const response: HostKeyForgetResponse = { silinen: await hostKeys.forget(host.trim(), port) };
      json(res, 200, response);
      return true;
    }
    if (typeof anahtar !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(anahtar) || hostKeyType(anahtar) === null) {
      json(res, 400, { hata: 'Geçersiz host anahtarı' });
      return true;
    }
    await hostKeys.trust(host.trim(), port, anahtar);
    const response: HostKeyTrustResponse = { parmakIzi: hostKeyFingerprint(anahtar, nodeKnownHostsCrypto) };
    json(res, 200, response);
    return true;
  };
}
