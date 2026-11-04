import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'vitest';
import { WebSocket } from 'ws';
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
  cookie: string;
  host: string;
  origin: string;
  /** WS upgrade dener; açılırsa `open`, reddedilirse HTTP durum kodunu döndürür. */
  upgrade(path: string, headers: Record<string, string>): Promise<'open' | number>;
  close(): Promise<void>;
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

  return {
    server,
    configDir,
    keychain,
    request,
    authed: (path, opts = {}) =>
      request(path, { ...opts, headers: { cookie, origin, ...opts.headers } }),
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
    close: async () => {
      await server.close();
      await cleanup();
    },
  };
}
