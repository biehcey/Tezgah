import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Geliştirmede sunucu `npm run dev:server` ile 5174'te çalışır (bkz. package.json).
const sunucu = 'http://127.0.0.1:5174';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // ADR-0001: hiçbir CORS başlığı gönderilmez; geliştirmede de.
    cors: false,
    proxy: {
      // Erişim anahtarı değişimi (`/?t=<token>`) sunucuda yapılır; cookie Vite origin'ine yazılır.
      '^/[?]t=': { target: sunucu },
      '/api': { target: sunucu },
      '/ws': { target: sunucu, ws: true },
    },
  },
});
