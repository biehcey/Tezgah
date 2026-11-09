#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startServer } from './app';
import { defaultConfigDir } from './ayar-deposu';
import { createOsKeychain } from './keychain';
import { openBrowser } from './tarayici';

const HELP = `Kullanım: tezgah-db [seçenekler]

  --port <n>      Sabit port (varsayılan: rastgele)
  --no-open       Tarayıcıyı açma, yalnızca URL'i yaz
  -h, --help      Bu yardımı göster
`;

function parsePort(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`${flag} 1–65535 arasında bir tam sayı olmalı: ${value}\n`);
    process.exit(2);
  }
  return port;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        port: { type: 'string' },
        'no-open': { type: 'boolean', default: false },
        // Yalnızca `npm run dev` için; yardımda gösterilmez.
        'dev-web-port': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  // Derlenmiş paket: dist/server/cli.js → dist/web
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
  const log = (line: string) => process.stdout.write(`${line}\n`);

  let server;
  try {
    server = await startServer({
      port: parsePort(values.port, '--port'),
      devWebPort: parsePort(values['dev-web-port'], '--dev-web-port'),
      webRoot,
      configDir: defaultConfigDir(),
      keychain: createOsKeychain(),
      log,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    process.stderr.write(
      code === 'EADDRINUSE' ? `Port kullanımda: ${values.port}\n` : `Tezgah başlatılamadı: ${String(err)}\n`,
    );
    process.exit(1);
  }

  log(`Tezgah çalışıyor: ${server.url}`);
  log('Kapatmak için Ctrl+C.');
  if (!values['no-open']) openBrowser(server.url);

  const shutdown = () => {
    server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main();
