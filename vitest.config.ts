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
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['src/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['src/web/test/setup.ts'],
        },
      },
    ],
  },
});
