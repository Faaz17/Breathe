// Removes the redundant ORT wasm/.mjs that Vite emits into dist/assets from
// onnxruntime-web's internal `new URL(...)` references. At runtime ORT loads its
// wasm/.mjs from dist/ort via env.backends.onnx.wasm.wasmPaths, so the dist/assets
// copies are never fetched — they just bloat the package (~23 MB). Runs after the
// Vite builds.
//
// Run with: node scripts/trim-dist.mjs  (chained at the end of the build script)

import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

let removedBytes = 0;
let removedCount = 0;
try {
  for (const file of readdirSync(assetsDir)) {
    if (file.startsWith('ort-wasm-') && (file.endsWith('.wasm') || file.endsWith('.mjs'))) {
      const full = join(assetsDir, file);
      removedBytes += statSync(full).size;
      rmSync(full);
      removedCount += 1;
      console.log(`removed dist/assets/${file}`);
    }
  }
} catch (error) {
  console.warn('trim-dist: skipped', error instanceof Error ? error.message : error);
}

console.log(`trim-dist: removed ${removedCount} redundant ORT asset(s), ${(removedBytes / 1024 / 1024).toFixed(1)} MB`);
