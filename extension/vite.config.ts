import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';

import manifest from './manifest.config';

// Dev server port is pinned so the crxjs HMR client always finds it.
const DEV_SERVER_PORT = 5173;

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    hmr: {
      port: DEV_SERVER_PORT,
    },
  },
  build: {
    // Chrome's MV3 supports modern syntax; no need to down-level past this.
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Pages not referenced from the manifest need to be registered as extra
      // entries: the offscreen document (opened via chrome.offscreen) and the
      // history page (opened in a tab via chrome.tabs.create / getURL).
      input: {
        offscreen: 'src/offscreen/index.html',
        history: 'src/history/index.html',
      },
    },
  },
});
