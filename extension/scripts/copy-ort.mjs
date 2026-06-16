// Copies ONNX Runtime Web's wasm + .mjs loader glue into public/ort so the
// worker can load them from the extension itself. transformers.js pulls in a
// non-published dev build of onnxruntime-web, so at runtime ORT's default
// wasmPaths (the jsDelivr CDN) 404s on the .mjs loader → "no available backend".
// We bundle the files and point env.backends.onnx.wasm.wasmPaths here instead.
// Re-run on every build (the files track the dep).
//
// Run with: node scripts/copy-ort.mjs  (chained from the build script)

import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nodeModules = join(scriptDir, '..', 'node_modules');

// onnxruntime-web is a transitive dep of @huggingface/transformers; pnpm's strict
// layout doesn't hoist it, so resolve normally first, then fall back to scanning
// the .pnpm store for the versioned directory.
function resolveOrtDist() {
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('onnxruntime-web/package.json')), 'dist');
  } catch {
    const pnpmDir = join(nodeModules, '.pnpm');
    const match = readdirSync(pnpmDir).find((name) => name.startsWith('onnxruntime-web@'));
    if (match) {
      const dist = join(pnpmDir, match, 'node_modules', 'onnxruntime-web', 'dist');
      if (existsSync(dist)) return dist;
    }
    throw new Error('Could not locate onnxruntime-web/dist');
  }
}

const ortDist = resolveOrtDist();
const outDir = join(scriptDir, '..', 'public', 'ort');
mkdirSync(outDir, { recursive: true });

// The whole threaded-SIMD family (plain + asyncify/jsep/jspi) so ORT's runtime
// backend selection always finds the variant it picks for this browser.
const PREFIX = 'ort-wasm-simd-threaded';

let copied = 0;
for (const file of readdirSync(ortDist)) {
  if (file.startsWith(PREFIX) && (file.endsWith('.wasm') || file.endsWith('.mjs'))) {
    copyFileSync(join(ortDist, file), join(outDir, file));
    copied += 1;
    console.log(`copied ort/${file}`);
  }
}

if (copied === 0) throw new Error(`No ORT wasm files found in ${ortDist}`);
