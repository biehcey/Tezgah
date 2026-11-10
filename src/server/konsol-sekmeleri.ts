import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TabsFormatError, emptyTabs, parseTabs, type SavedTabs } from '../core/konsol-sekmeleri';
import { writeFileAtomic } from './ayar-deposu';
import { json, methodNotAllowed, readJson } from './http';

/** Sekmeler `tezgah.json`'dan ayrı, kendi dizininde: sık değişen metin bağlantı ayarlarıyla yazılmaz. */
export const TABS_DIR = 'konsol';
export const TABS_FILE = 'sekmeler.json';

/** Script metinleri büyüyebilir; genel 1 MB sınırı bu uç için yetmez. */
const MAX_TABS_BYTES = 16 * 1024 * 1024;

/** Sekme dosyası okunamadı ya da daha yeni bir Tezgah'ın biçiminde; üzerine yazılmaz. */
export class TabsFileError extends Error {
  /** Daha yeni bir Tezgah'ın biçimi: üzerine yazılmaz. */
  readonly newer: boolean;
  constructor(message: string, { newer = false, cause }: { newer?: boolean; cause?: unknown } = {}) {
    super(message, { cause });
    this.newer = newer;
    this.name = 'TabsFileError';
  }
}

export interface TabStore {
  read(): Promise<SavedTabs>;
  /** Biçime göre süzüp atomik yazar (geçici dosya + rename, POSIX'te `0600`); yazılanı döndürür. */
  write(tabs: SavedTabs): Promise<SavedTabs>;
}

export function createTabStore(configDir: string): TabStore {
  const dir = join(configDir, TABS_DIR);
  const file = join(dir, TABS_FILE);
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<SavedTabs> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyTabs();
      throw new TabsFileError(`${file} okunamadı: ${(err as Error).message}`, { cause: err });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new TabsFileError(`${file} çözümlenemedi: ${(err as Error).message}`, { cause: err });
    }
    try {
      return parseTabs(raw);
    } catch (err) {
      if (!(err instanceof TabsFormatError)) throw err;
      throw new TabsFileError(`${file}: ${err.message}`, { newer: err.newer, cause: err });
    }
  }

  async function write(tabs: SavedTabs): Promise<SavedTabs> {
    // Daha yeni bir Tezgah'ın dosyası ezilmez; bozuk ya da eski dosyanın yerine yenisi yazılır.
    await read().catch((err: unknown) => {
      if (err instanceof TabsFileError && err.newer) throw err;
    });
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(tabs, null, 2)}\n`, { mode: 0o600 });
    return tabs;
  }

  return {
    read,
    write(tabs) {
      const run = queue.then(() => write(tabs));
      queue = run.catch(() => {});
      return run;
    },
  };
}

/** `/api/konsol-sekmeleri`: oku (GET) ve tümünü yaz (PUT). İsteği ele aldıysa `true` döner. */
export function createTabRoutes({ tabs }: { tabs: TabStore }) {
  async function put(req: IncomingMessage, res: ServerResponse) {
    const raw = await readJson(req, { maxBytes: MAX_TABS_BYTES });
    let parsed: SavedTabs;
    try {
      parsed = parseTabs(raw);
    } catch (err) {
      if (err instanceof TabsFormatError) return json(res, 400, { hata: err.message });
      throw err;
    }
    try {
      json(res, 200, await tabs.write(parsed));
    } catch (err) {
      if (err instanceof TabsFileError && err.newer) return json(res, 409, { hata: err.message });
      throw err;
    }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname !== '/api/konsol-sekmeleri') return false;
    if (req.method === 'GET') {
      try {
        json(res, 200, await tabs.read());
      } catch (err) {
        if (err instanceof TabsFileError) json(res, 500, { hata: err.message });
        else throw err;
      }
    } else if (req.method === 'PUT') await put(req, res);
    else methodNotAllowed(res);
    return true;
  };
}
