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
  /** `?t=` ile sunulan token doğruysa tarayıcıya yazılacak `Set-Cookie` değeri. */
  exchange(offered: string): string | undefined;
  /** İzin varsa `undefined`, yoksa döndürülecek HTTP durum kodu. */
  check(req: IncomingMessage, options: { requireOrigin: boolean }): number | undefined;
  /** Yalnızca `Host` denetimi (token değişimi cookie'den önce gelir). */
  hostAllowed(req: IncomingMessage): boolean;
}

export function createAccessPolicy(ports: number[]): AccessPolicy {
  const token = randomBytes(32).toString('base64url');
  // Cookie'ler porta göre ayrılmaz; aynı anda açık iki Tezgah birbirinin cookie'sini ezmesin.
  const cookieName = `tezgah_${ports[0]}`;
  const allowedHosts = new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
  const tokenDigest = digest(token);
  const isToken = (candidate: string | undefined) =>
    candidate !== undefined && timingSafeEqual(digest(candidate), tokenDigest);

  const hostAllowed = (req: IncomingMessage) => allowedHosts.has(req.headers.host?.toLowerCase() ?? '');

  return {
    token,
    cookieName,
    hostAllowed,
    exchange: (offered) =>
      isToken(offered) ? `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` : undefined,
    check(req, { requireOrigin }) {
      // DNS rebinding: yalnızca bilinen yerel adlarla gelen istekler.
      if (!hostAllowed(req)) return 403;
      if (!isToken(readCookie(req.headers.cookie, cookieName))) return 401;
      // CSRF: `Origin`, doğrulanmış `Host` ile aynı origin olmalı.
      if (requireOrigin && req.headers.origin?.toLowerCase() !== `http://${req.headers.host?.toLowerCase()}`) {
        return 403;
      }
      return undefined;
    },
  };
}

/** Sabit uzunluklu özet; böylece karşılaştırma uzunluktan bağımsız ve sabit zamanlıdır. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
