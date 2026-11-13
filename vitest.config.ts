import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          include: ['src/core/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts'],
          environment: 'node',
          // Gerçek Postgres testleri Tezgah oturumlarını sayar; dosyalar aynı sunucuda paralel koşmasın.
          fileParallelism: false,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['src/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          // Testler tüm App'i render eder; tek başına 1–2 sn süren testler tam takımın yükünde
          // varsayılan 5 sn'yi aşabiliyor. Yavaş bir testi hızlandırmak (ör. `fill`) asıl çözüm.
          testTimeout: 15_000,
          setupFiles: ['src/web/test/setup.ts'],
        },
      },
    ],
  },
});
