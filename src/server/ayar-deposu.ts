import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { emptySettings, migrateSettings, type Settings } from '../core/ayarlar';

export const SETTINGS_FILE = 'tezgah.json';

/** Ayar dosyası okunamadı ya da çözümlenemedi; dosyanın üzerine yazılmaz. */
export class SettingsFileError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = 'SettingsFileError';
  }
}

export interface SettingsStore {
  read(): Promise<Settings>;
  /**
   * Ayarın kopyası üzerinde `change`'i çalıştırır ve değiştiyse atomik olarak yazar. Güncellemeler
   * sıraya girer; `change` hata fırlatırsa hiçbir şey yazılmaz.
   */
  update<T>(change: (settings: Settings) => T): Promise<T>;
}

/**
 * OS yapılandırma dizini: macOS `~/Library/Application Support/Tezgah`, Windows `%APPDATA%\Tezgah`.
 * Diğer platformlar (yalnızca geliştirme/CI) XDG kuralını izler.
 */
export function defaultConfigDir({
  env = process.env,
  platform = process.platform,
  home = homedir(),
}: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string } = {}): string {
  if (platform === 'win32') return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), 'Tezgah');
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'Tezgah');
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, '.config'), 'tezgah');
}

export function createSettingsStore(configDir: string): SettingsStore {
  const file = join(configDir, SETTINGS_FILE);
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Settings> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptySettings();
      throw new SettingsFileError(`${file} okunamadı: ${(err as Error).message}`, { cause: err });
    }
    try {
      return migrateSettings(JSON.parse(text));
    } catch (err) {
      throw new SettingsFileError(`${file} çözümlenemedi: ${(err as Error).message}`, { cause: err });
    }
  }

  async function write(settings: Settings) {
    await mkdir(configDir, { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  }

  return {
    read,
    update<T>(change: (settings: Settings) => T): Promise<T> {
      const run = queue.then(async () => {
        const current = await read();
        const settings = structuredClone(current);
        const result = change(settings);
        if (JSON.stringify(settings) !== JSON.stringify(current)) await write(settings);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

/**
 * Dosyayı geçici dosya + rename ile yazar: okuyan ya da çöken süreç yarım dosya görmez. `mode`
 * yalnızca POSIX'te etkilidir (ör. `0o600`).
 */
export async function writeFileAtomic(file: string, text: string, { mode }: { mode?: number } = {}) {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, text, { encoding: 'utf8', flush: true, mode });
    await renameWithRetry(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Windows'ta hedef dosya o an başka bir süreçte (antivirüs, OneDrive, dizin indeksleyici)
 * açıksa rename kısa süreliğine EPERM/EACCES/EBUSY verebilir.
 */
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}
