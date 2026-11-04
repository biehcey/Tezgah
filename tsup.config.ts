import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/server/cli.ts' },
  outDir: 'dist/server',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // ssh2 runtime bağımlılığı değildir; dist/server'a gömülür (wayfinder 19).
  // Native binding'ler ve cpu-features dışarıda kalır, ssh2 her zaman JS yoluna düşer.
  noExternal: ['ssh2'],
  external: [/\.node$/, 'cpu-features'],
});
