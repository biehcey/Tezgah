import { readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * `webRoot` altındaki dosyayı servis eder. Uzantısız yollar tek sayfalık uygulamaya
 * (`index.html`) düşer; kök dışına çıkan yollar 404 olur.
 */
export async function serveStatic(webRoot: string, pathname: string, res: ServerResponse): Promise<void> {
  const root = resolve(webRoot);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = resolve(join(root, decoded));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(404).end();
    return;
  }
  if (!(await isFile(file))) {
    if (extname(decoded) !== '') {
      res.writeHead(404).end();
      return;
    }
    file = join(root, 'index.html');
    if (!(await isFile(file))) {
      res
        .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Web arayüzü derlenmemiş: önce `npm run build` çalıştırın.');
      return;
    }
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
