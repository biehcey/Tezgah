/**
 * Gerçek Postgres'e karşı server testleri: geçici bir Postgres (embedded-postgres) açar,
 * `TEZGAH_TEST_PG_URL`'i ona yöneltip server projesini koşar, sonra sunucuyu ve veri dizinini siler.
 * Ek argümanlar vitest'e geçer: `npm run test:pg -- src/server/katalog.test.ts`.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

const dir = await mkdtemp(join(tmpdir(), 'tezgah-pg-'));
const port = await freePort();
const user = 'tezgah';
const password = 'tezgah';
const postgres = new EmbeddedPostgres({
  databaseDir: dir,
  port,
  user,
  password,
  authMethod: 'scram-sha-256',
  persistent: false,
  // Sistem yerel ayarı (ör. "Turkish_Türkiye.1254") ASCII dışı olunca initdb düşer; mesajlar da İngilizce kalsın.
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
  onLog: () => {},
});

let code: number;
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgres://${user}:${password}@127.0.0.1:${port}/postgres`;
  console.log(`Geçici Postgres: 127.0.0.1:${port}`);
  code = await new Promise<number>((resolve) => {
    const child = spawn('npx', ['vitest', 'run', '--project', 'server', ...process.argv.slice(2)], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, TEZGAH_TEST_PG_URL: url },
    });
    child.on('exit', (exit) => resolve(exit ?? 1));
  });
} finally {
  await postgres.stop().catch(() => {});
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
process.exit(code);
