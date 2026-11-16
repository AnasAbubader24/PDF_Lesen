import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
export default defineConfig({
  server: {
    ...(process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH ? { https: { cert: readFileSync(process.env.TLS_CERT_PATH), key: readFileSync(process.env.TLS_KEY_PATH) } } : {}),
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } }
  },
  build: { chunkSizeWarningLimit: 1600, rollupOptions: { onwarn(warning, warn) {
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
    warn(warning);
  } } }
});
