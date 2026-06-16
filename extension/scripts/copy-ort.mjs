// Copies ONNX Runtime Web's wasm + .mjs loader glue into public/ort so the
// worker can load them from the extension itself. transformers.js pulls in a
// non-published dev build of onnxruntime-web, so at runtime ORT's default
// wasmPaths (the jsDelivr CDN) 404s on the .mjs loader → "no available backend".
// We bundle the files and point env.backends.onnx.wasm.wasmPaths here instead.
// Re-run on every build (the files track the dep).
//
// Run with: node scripts/copy-ort.mjs  (chained from the build script)

import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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
// Start clean so variants dropped from WANTED_VARIANTS don't linger from old builds.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Only the two variants we actually use: jsep (the WebGPU backend) and asyncify
// (the single-thread WASM fallback). The plain threaded build needs SharedArrayBuffer
// (not available without cross-origin isolation) and jspi is unused — skipping both
// roughly halves the bundled wasm.
const WANTED_VARIANTS = ['.jsep.', '.asyncify.'];

function isWanted(file) {
  if (!file.endsWith('.wasm') && !file.endsWith('.mjs')) return false;
  return WANTED_VARIANTS.some((variant) => file.includes(variant));
}

let copied = 0;
for (const file of readdirSync(ortDist)) {
  if (isWanted(file)) {
    copyFileSync(join(ortDist, file), join(outDir, file));
    copied += 1;
    console.log(`copied ort/${file}`);
  }
}

if (copied === 0) throw new Error(`No ORT wasm files found in ${ortDist}`);
