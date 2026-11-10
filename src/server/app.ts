import { STATUS_CODES, createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import pkg from '../../package.json' with { type: 'json' };
import { SettingsFileError, createSettingsStore } from './ayar-deposu';
import { createConnectionTestRoutes } from './baglanti-testi';
import { createConnectionRoutes } from './baglantilar';
import { createRunHistory, createRunHistoryRoutes } from './calistirma-kayitlari';
import { createAccessPolicy } from './erisim';
import { createPoolManager } from './havuzlar';
import { createHostKeyRoutes, createHostKeyStore } from './host-anahtarlari';
import { createTunnelOpener, type SshConnector } from './tunel';
import type { AgentEnvironment } from '../core/ssh-tuneli';
import { createSessionPasswords } from './oturum-sifreleri';
import { createFolderRoutes } from './klasorler';
import { createImportRoutes, type ImportEnvironment } from './ice-aktarma';
import { createTabRoutes, createTabStore } from './konsol-sekmeleri';
import { BodyError, json } from './http';
import type { Keychain } from './keychain';
import { systemClock, type Clock } from './saat';
import { createScriptRunner } from './script-calistirici';
import { serveStatic } from './statik';
import { openFolder } from './tarayici';
import { createDatabaseRoutes } from './veritabanlari';

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
  /** `tezgah.json`'ın bulunduğu yapılandırma dizini; ilk yazmada oluşturulur. */
  configDir: string;
  keychain: Keychain;
  /** Pool boşta kalma süresi gibi zamanlayıcılar; testlerde sahte saat. */
  clock?: Clock;
  /** Çalıştırma kayıtları klasörünü OS dosya yöneticisinde açar; testlerde sahte. */
  openFolder?: (dir: string) => void;
  /** SSH protokolü; verilmezse ssh2 (ilk tünelde yüklenir). Testlerde sahte tünel. */
  sshConnector?: SshConnector;
  /** Kullanıcının ev dizini (`~/.ssh/known_hosts` buradan salt okunur); testlerde geçici dizin. */
  homeDir?: string;
  /** Agent yolunun varsayılanı için platform ve ortam değişkenleri. */
  agentEnvironment?: AgentEnvironment;
  /** `.pgpass` araması için platform ve ortam (`PGPASSFILE`, `APPDATA`); testlerde enjekte. */
  importEnvironment?: ImportEnvironment;
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
  const store = createSettingsStore(options.configDir);
  const folderRoutes = createFolderRoutes({ store });
  // Oturumluk şifreler yalnızca bu süreçte; diske yazılmaz.
  const sessionPasswords = createSessionPasswords();
  const clock = options.clock ?? systemClock;
  const hostKeys = createHostKeyStore({ configDir: options.configDir, homeDir: options.homeDir ?? homedir() });
  const openTunnel = createTunnelOpener({
    connector: options.sshConnector ?? (async (o) => (await import('./ssh2-baglayici')).ssh2Connector(o)),
    hostKeys,
    agentEnvironment: options.agentEnvironment ?? { platform: process.platform, env: process.env },
  });
  // Pool'lar ve tüneller tembel: açılışta hiçbir sunucuya bağlanılmaz.
  const pools = createPoolManager({ keychain: options.keychain, sessionPasswords, clock, openTunnel, log: options.log });
  const connectionRoutes = createConnectionRoutes({
    store,
    keychain: options.keychain,
    sessionPasswords,
    log: options.log,
    // Ayarı değişen ya da silinen bağlantının pool'ları eski ayarla açık kalmasın.
    onChanged: (id) => void pools.disconnect(id),
  });
  const databaseRoutes = createDatabaseRoutes({ store, pools });
  const history = createRunHistory({ configDir: options.configDir, log: options.log });
  const historyRoutes = createRunHistoryRoutes({ history, openFolder: options.openFolder ?? openFolder });
  // Her `/ws` bağlantısı kendi çalıştırmasını taşır; koparsa transaction geri alınır (ADR-0002).
  const attachScriptRunner = createScriptRunner({ store, pools, clock, history, log: options.log });
  wss.on('connection', attachScriptRunner);

  const connectionTestRoutes = createConnectionTestRoutes({ store, keychain: options.keychain, openTunnel, log: options.log });
  const hostKeyRoutes = createHostKeyRoutes({ hostKeys });
  const importRoutes = createImportRoutes({
    store,
    keychain: options.keychain,
    homeDir: options.homeDir ?? homedir(),
    environment: options.importEnvironment ?? { platform: process.platform, env: process.env },
    log: options.log,
  });

  // Konsol sekmeleri yalnızca dosyaya yazılır ve okunur; hiçbir sunucuya bağlanmaz.
  const tabRoutes = createTabRoutes({ tabs: createTabStore(options.configDir) });

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
    if (await connectionRoutes(req, res, url.pathname)) return;
    if (await databaseRoutes(req, res, url.pathname)) return;
    if (await connectionTestRoutes(req, res, url.pathname)) return;
    if (await hostKeyRoutes(req, res, url.pathname)) return;
    if (await folderRoutes(req, res, url.pathname)) return;
    if (await historyRoutes(req, res, url.pathname)) return;
    if (await importRoutes(req, res, url.pathname)) return;
    if (await tabRoutes(req, res, url.pathname)) return;
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return json(res, 404, { hata: 'Bulunamadı' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405);
    await serveStatic(options.webRoot, url.pathname, res);
  }

  http.on('request', (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof BodyError && !res.headersSent) return json(res, err.status, { hata: err.message });
      options.log(`İstek hatası: ${String(err)}`);
      if (res.headersSent) return res.end();
      // Bozuk ya da daha yeni sürümlü ayar dosyası: kullanıcı nedenini görmeli; dosyaya dokunulmaz.
      if (err instanceof SettingsFileError) return json(res, 500, { hata: err.message });
      res.writeHead(500).end();
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
        http.close((err) => {
          if (err) return reject(err);
          pools.closeAll().then(resolve, reject);
        });
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
