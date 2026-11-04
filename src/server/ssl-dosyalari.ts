import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sslPathsUsed, type SslSettings } from '../core/baglanti';
import type { SslFileContents } from '../core/baglanti-ssl';
import { classifySslFileError, toDriverError, type StepFailure } from '../core/baglanti-testi';

/** `~/` ile başlayan yolu ev dizinine çevirir; diğer yollar (ayrıştırmada mutlak olduğu doğrulandı) aynen. */
function resolvePath(path: string): string {
  return /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
}

export type SslFiles = { ok: true; contents: SslFileContents } | { ok: false; failure: StepFailure };

/** Modun kullandığı SSL dosyalarını okur (disable'da hiçbiri, prefer'de CA değil). Dosyalar yerinde kalır. */
export async function readSslFiles(input: SslSettings): Promise<SslFiles> {
  const contents: SslFileContents = { ca: null, cert: null, key: null };
  const target = { sslrootcert: 'ca', sslcert: 'cert', sslkey: 'key' } as const;
  for (const field of sslPathsUsed(input.sslmode)) {
    const path = input[field];
    if (path === null) continue;
    try {
      contents[target[field]] = await readFile(resolvePath(path), 'utf8');
    } catch (err) {
      return { ok: false, failure: classifySslFileError(field, path, toDriverError(err)) };
    }
  }
  return { ok: true, contents };
}
