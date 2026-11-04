import { STATUS_CODES, createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import pkg from '../../package.json' with { type: 'json' };
import { createAccessPolicy } from './erisim';
import { serveStatic } from './statik';

export interface ServerOptions {
  /** Sabit port; verilmezse işletim sistemi rastgele bir port seçer. */
  port?: number;
  /**
   * Yalnızca geliştirme: Vite dev sunucusunun portu. Vite `/api` ve `/ws`'i proxy'lediğinde
   * gelen `Host`/`Origin` bu porttur; tarayıcı da bu porttan açılır.
   */
  devWebPort?: number;
  /** Derlenmiş web arayüzünün dizini (`dist/web`). */
  webRoot: string;
  log: (line: string) => void;
}

export interface TezgahServer {
  port: number;
  token: string;
  cookieName: string;
  /** Tarayıcıda açılacak token'lı URL. */
  url: string;
  close(): Promise<void>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Sunucuyu yalnızca 127.0.0.1'de başlatır. Açılışta hiçbir veritabanına bağlanmaz.
 */
export async function startServer(options: ServerOptions): Promise<TezgahServer> {
  const http = createServer();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, '127.0.0.1', () => {
      http.off('error', reject);
      resolve();
    });
  });
  const port = (http.address() as AddressInfo).port;
  const access = createAccessPolicy(options.devWebPort ? [port, options.devWebPort] : [port]);
  const wss = new WebSocketServer({ noServer: true });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = requestUrl(req);

    const offered = url.searchParams.get('t');
    if (offered !== null && req.method === 'GET') {
      const exchanged = access.exchange(req, offered);
      if (!exchanged.ok) return sendStatus(res, exchanged.status);
      url.searchParams.delete('t');
      res
        .writeHead(302, {
          'set-cookie': exchanged.setCookie,
          location: url.pathname + url.search,
          // Token URL'de taşındığından ne önbelleğe ne de Referer'a düşmeli.
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        })
        .end();
      return;
    }

    const decision = access.check(req, { requireOrigin: !SAFE_METHODS.has(req.method ?? '') });
    if (!decision.ok) return sendStatus(res, decision.status);

    if (url.pathname === '/api/durum' && req.method === 'GET') {
      return json(res, 200, { uygulama: 'tezgah', surum: pkg.version });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return json(res, 404, { hata: 'Bulunamadı' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405);
    await serveStatic(options.webRoot, url.pathname, res);
  }

  http.on('request', (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err: unknown) => {
      options.log(`İstek hatası: ${String(err)}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const decision = access.check(req, { requireOrigin: true });
    if (!decision.ok) return rejectUpgrade(socket, decision.status);
    if (requestUrl(req).pathname !== '/ws') return rejectUpgrade(socket, 404);
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const browserPort = options.devWebPort ?? port;
  return {
    port,
    token: access.token,
    cookieName: access.cookieName,
    url: `http://127.0.0.1:${browserPort}/?t=${access.token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

function sendStatus(res: ServerResponse, status: number) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(STATUS_CODES[status]);
}

function rejectUpgrade(socket: Duplex, status: number) {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
