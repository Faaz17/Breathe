import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Meeting pages (e.g. Google Meet) enforce a `strict-dynamic` CSP that blocks the
// dynamic-import loader crxjs uses for content scripts. So we build the content
// script as a single self-contained IIFE — React + the inlined Tailwind CSS, no
// dynamic import — that the service worker injects as a classic content script.
//
// Output: dist/content.js (appended to the crxjs build, which runs first).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    cssCodeSplit: false,
    target: 'esnext',
    rollupOptions: {
      input: 'src/content/index.ts',
      output: {
        format: 'iife',
        name: 'BreatheContent',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
      },
    },
  },
});
