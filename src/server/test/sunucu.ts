import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerEvent } from '../../core/script-calistirma';
import { startServer, type ServerOptions, type TezgahServer } from '../app';
import { createFakeKeychain, type FakeKeychain } from './sahte-keychain';

/** Gerçek Postgres yalnızca `TEZGAH_TEST_PG_URL` tanımlıysa kullanılır; yoksa bu testler atlanır. */
export const pgUrl = process.env.TEZGAH_TEST_PG_URL;
export const describePg = pgUrl ? describe : describe.skip;

export const INDEX_HTML = '<!doctype html><title>Tezgah</title><div id="root"></div>';

export interface Response {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface TestServer {
  server: TezgahServer;
  /** Geçici yapılandırma dizini (`tezgah.json` burada). */
  configDir: string;
  keychain: FakeKeychain;
  /** Doğru `Host` ile; `headers` ile üzerine yazılabilir. */
  request(path: string, options?: RequestOptions): Promise<Response>;
  /** Geçerli erişim cookie'si ve aynı-origin `Origin` ile. */
  authed(path: string, options?: RequestOptions): Promise<Response>;
  /** Yetkili JSON isteği; gövde varsa JSON olarak gönderilir, yanıt gövdesi ayrıştırılır. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testler JSON gövdeyi serbestçe okur
  api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  cookie: string;
  host: string;
  origin: string;
  /** WS upgrade dener; açılırsa `open`, reddedilirse HTTP durum kodunu döndürür. */
  upgrade(path: string, headers: Record<string, string>): Promise<'open' | number>;
  /** Yetkili `/ws` bağlantısı açar; gelen olayları sırayla toplar. */
  socket(): Promise<TestSocket>;
  close(): Promise<void>;
}

export interface TestSocket {
  send(message: unknown): void;
  /** Şimdiye kadar gelen olaylar. */
  events: ServerEvent[];
  /** Koşulu sağlayan ilk olayı (gelmişse hemen) bekler. */
  waitFor<T extends ServerEvent['type']>(type: T, match?: (e: Extract<ServerEvent, { type: T }>) => boolean): Promise<Extract<ServerEvent, { type: T }>>;
  close(): void;
  /** Soketi el sıkışmasız düşürür (sekme çöktü / ağ koptu). */
  terminate(): void;
}

function openSocket(port: number, headers: Record<string, string>): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const events: ServerEvent[] = [];
    const waiters: (() => void)[] = [];
    ws.on('message', (data) => {
      events.push(JSON.parse(String(data)) as ServerEvent);
      for (const w of [...waiters]) w();
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        events,
        send: (message) => ws.send(JSON.stringify(message)),
        waitFor: (type, match) =>
          new Promise((done, fail) => {
            type Wanted = Extract<ServerEvent, { type: typeof type }>;
            const check = () => {
              const found = events.find((e): e is Wanted => e.type === type && (!match || match(e as Wanted)));
              if (!found) return false;
              waiters.splice(waiters.indexOf(check), 1);
              clearTimeout(timer);
              done(found);
              return true;
            };
            const timer = setTimeout(() => {
              waiters.splice(waiters.indexOf(check), 1);
              fail(new Error(`"${type}" olayı gelmedi; gelenler: ${JSON.stringify(events)}`));
            }, 8000);
            waiters.push(check);
            check();
          }),
        close: () => ws.close(),
        terminate: () => ws.terminate(),
      }),
    );
  });
}

/**
 * Sunucuyu test içinde; geçici web kökü, geçici yapılandırma dizini, sahte keychain ve
 * rastgele portla başlatır.
 */
export async function startTestServer(options: Partial<ServerOptions> = {}): Promise<TestServer> {
  const webRoot = await mkdtemp(join(tmpdir(), 'tezgah-web-'));
  // Dizinin kendisi henüz yok: sunucu ilk yazmada oluşturmalı.
  const configDir = join(await mkdtemp(join(tmpdir(), 'tezgah-config-')), 'Tezgah');
  const keychain = createFakeKeychain();
  const cleanup = () =>
    Promise.all([
      rm(webRoot, { recursive: true, force: true }),
      rm(join(configDir, '..'), { recursive: true, force: true }),
    ]);
  await writeFile(join(webRoot, 'index.html'), INDEX_HTML);
  await writeFile(join(webRoot, 'app.js'), 'console.log("tezgah")');
  let server: TezgahServer;
  try {
    server = await startServer({ webRoot, configDir, keychain, log: () => {}, ...options });
  } catch (err) {
    await cleanup();
    throw err;
  }
  const host = `127.0.0.1:${server.port}`;
  const origin = `http://${host}`;
  const cookie = `${server.cookieName}=${server.token}`;

  const request = (path: string, opts: RequestOptions = {}) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          path,
          method: opts.method ?? 'GET',
          headers: { host, ...opts.headers },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on('error', reject);
      req.end(opts.body);
    });

  const authed = (path: string, opts: RequestOptions = {}) =>
    request(path, { ...opts, headers: { cookie, origin, ...opts.headers } });

  return {
    server,
    configDir,
    keychain,
    request,
    authed,
    async api(method, path, body) {
      const res = await authed(path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: res.body ? JSON.parse(res.body) : undefined };
    },
    cookie,
    host,
    origin,
    upgrade: (path, headers) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, { headers: { host, ...headers } });
        ws.on('open', () => {
          ws.close();
          resolve('open');
        });
        ws.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
        });
        ws.on('error', reject);
      }),
    socket: () => openSocket(server.port, { host, cookie, origin }),
    close: async () => {
      await server.close();
      await cleanup();
    },
  };
}
