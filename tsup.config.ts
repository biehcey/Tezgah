import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/** dist/server'a gömülen paketler; lisans metinleri dağıtıma eklenir. */
const BUNDLED = ['ssh2', 'asn1', 'bcrypt-pbkdf', 'tweetnacl', 'safer-buffer'];

export default defineConfig({
  entry: { cli: 'src/server/cli.ts' },
  outDir: 'dist/server',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // ssh2 runtime bağımlılığı değildir; dist/server'a gömülür (wayfinder 19). ESM çıktısında gömülen
  // CommonJS'in `require`'ı için.
  banner: { js: "import { createRequire as __tezgahCreateRequire } from 'node:module'; const require = __tezgahCreateRequire(import.meta.url);" },
  // Gömülen CommonJS'in `__dirname`/`__filename`'ı için.
  shims: true,
  // Native binding'ler ve cpu-features dışarıda kalır, ssh2 her zaman JS yoluna düşer.
  noExternal: BUNDLED,
  external: [/\.node$/, 'cpu-features'],
  async onSuccess() {
    const sections = BUNDLED.map((name) => {
      const pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as { version: string };
      const license = readFileSync(`node_modules/${name}/LICENSE`, 'utf8').trim();
      return `${name}@${pkg.version}\n${'-'.repeat(40)}\n${license}\n`;
    });
    writeFileSync('dist/server/THIRD_PARTY_LICENSES.txt', `Tezgah'a gömülen paketlerin lisansları\n\n${sections.join('\n')}`);
  },
});
