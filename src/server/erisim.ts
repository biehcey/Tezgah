import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { readCookie } from '../core/cookie';

/**
 * Yerel erişim politikası (ADR-0001): açılışta üretilen erişim anahtarı, ondan türeyen
 * cookie ve `Host`/`Origin` doğrulaması. HTTP istekleri ve WS upgrade aynı kuralları kullanır.
 */
export interface AccessPolicy {
  token: string;
  cookieName: string;
  /** `?t=` ile sunulan token'ı değiştirir: başarıda tarayıcıya yazılacak `Set-Cookie` değeri. */
  exchange(req: IncomingMessage, offered: string): Decision<{ setCookie: string }>;
  /** Cookie ile gelen her istek (WS upgrade dahil). */
  check(req: IncomingMessage, options: { requireOrigin: boolean }): Decision;
}

/** Erişim kararı: izin ya da döndürülecek HTTP durum kodu. */
export type Decision<T = object> = ({ ok: true } & T) | { ok: false; status: 401 | 403 };

export function createAccessPolicy(ports: number[]): AccessPolicy {
  const token = randomBytes(32).toString('base64url');
  // Cookie'ler porta göre ayrılmaz; aynı anda açık iki Tezgah birbirinin cookie'sini ezmesin.
  const cookieName = `tezgah_${ports[0]}`;
  const allowedHosts = new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
  const tokenDigest = digest(token);
  const isToken = (candidate: string | undefined) =>
    candidate !== undefined && timingSafeEqual(digest(candidate), tokenDigest);

  // DNS rebinding: yalnızca bilinen yerel adlarla gelen istekler.
  const hostAllowed = (req: IncomingMessage) => allowedHosts.has(req.headers.host?.toLowerCase() ?? '');

  return {
    token,
    cookieName,
    exchange(req, offered) {
      if (!hostAllowed(req)) return { ok: false, status: 403 };
      if (!isToken(offered)) return { ok: false, status: 401 };
      return { ok: true, setCookie: `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` };
    },
    check(req, { requireOrigin }) {
      if (!hostAllowed(req)) return { ok: false, status: 403 };
      if (!isToken(readCookie(req.headers.cookie, cookieName))) return { ok: false, status: 401 };
      // CSRF: `Origin`, doğrulanmış `Host` ile aynı origin olmalı.
      if (requireOrigin && req.headers.origin?.toLowerCase() !== `http://${req.headers.host?.toLowerCase()}`) {
        return { ok: false, status: 403 };
      }
      return { ok: true };
    },
  };
}

/** Sabit uzunluklu özet; böylece karşılaştırma uzunluktan bağımsız ve sabit zamanlıdır. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
