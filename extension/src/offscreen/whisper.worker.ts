import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';

/**
 * Runs Whisper inference off the offscreen main thread, so audio capture there
 * is never starved by a multi-second inference (ScriptProcessor would otherwise
 * drop frames). Receives 16 kHz mono chunks, returns transcribed text.
 *
 * Typed against the DOM lib (the project's lib) rather than WebWorker to avoid a
 * lib conflict; `self` message/post APIs are reached through narrow casts.
 */

// whisper-base.en — notably more accurate than tiny. In fp16 it's ~146 MB
// (≈ the tiny.en fp32 download) and runs comfortably on WebGPU. fp16 has no
// MatMulNBits nodes, so it avoids the quantization session-creation bug.
const MODEL = 'Xenova/whisper-base.en';

// Whisper invents stock phrases on silence/noise (esp. short clips). Drop a chunk
// whose entire output is one of these — but only when it's the WHOLE output, so a
// real "thank you" inside a sentence is kept.
const HALLUCINATION_PHRASES = new Set([
  'thank you',
  'thanks',
  'thank you so much',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'you',
  'bye',
  'bye bye',
  'the end',
]);

function isHallucination(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === '' || HALLUCINATION_PHRASES.has(normalized);
}

type Pipe = AutomaticSpeechRecognitionPipeline;
type InMessage =
  | { type: 'init'; wasmPaths: string }
  | { type: 'transcribe'; audio: Float32Array };
type OutMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; progress?: number; message?: string }
  | { type: 'text'; text: string }
  | { type: 'done' };

const worker = self as unknown as {
  postMessage(message: OutMessage): void;
  addEventListener(type: 'message', handler: (event: MessageEvent<InMessage>) => void): void;
};

let pipe: Pipe | null = null;
let loadPromise: Promise<Pipe> | null = null;
// Extension-local URL of the bundled ORT wasm/.mjs (set from the init message).
// Without it ORT defaults to a jsDelivr CDN that 404s on our dev-build version.
let wasmPaths = '';
// Which backend actually loaded, and (if WebGPU was skipped/failed) why — surfaced
// to the panel so we can tell GPU from CPU at a glance.
let backendLabel = 'CPU';

function post(message: OutMessage): void {
  worker.postMessage(message);
}

function progressCallback(report: { status: string; progress?: number }): void {
  if (report.status === 'progress') {
    post({ type: 'status', state: 'loading', progress: Math.round(report.progress ?? 0) });
  }
}

function buildPipeline(device: 'webgpu' | 'wasm'): Promise<Pipe> {
  return pipeline('automatic-speech-recognition', MODEL, {
    device,
    // fp32 only. fp16 degenerates on this WebGPU/ORT decoder (repetitive token
    // garbage), and q4/q8 (MatMulNBits) hit a session-creation bug in this ORT
    // dev build. fp32 is the one precision confirmed to produce clean output.
    dtype: 'fp32',
    progress_callback: progressCallback,
  });
}

async function ensurePipeline(): Promise<Pipe> {
  if (pipe) return pipe;

  env.allowLocalModels = false; // weights come from the HF CDN, cached after first run
  const wasmBackend = env.backends?.onnx?.wasm;
  if (wasmBackend) {
    wasmBackend.numThreads = 1; // no SharedArrayBuffer / cross-origin isolation needed
    if (wasmPaths) wasmBackend.wasmPaths = wasmPaths; // load ORT from the extension, not a CDN
  }

  // WebGPU is ~10× faster than single-thread WASM; fall back to WASM if the GPU
  // backend is unavailable or fails to initialise (model is cached, so the retry
  // is cheap). Same fp32 weights either way.
  const tryWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  loadPromise ??= (
    tryWebGpu
      ? buildPipeline('webgpu')
          .then((ready) => {
            backendLabel = 'GPU';
            return ready;
          })
          .catch((error: unknown) => {
            const why = error instanceof Error ? error.message : String(error);
            backendLabel = `CPU (WebGPU failed: ${why})`;
            console.warn('Breathe whisper worker: WebGPU unavailable, using WASM', error);
            return buildPipeline('wasm');
          })
      : ((backendLabel = 'CPU (no navigator.gpu in worker)'), buildPipeline('wasm'))
  )
    .then((ready) => {
      pipe = ready;
      post({ type: 'status', state: 'ready', message: backendLabel });
      return ready;
    })
    .catch((error: unknown) => {
      loadPromise = null; // allow a retry on the next chunk
      console.error('Breathe whisper worker: model load failed', error);
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      post({ type: 'status', state: 'error', message: detail });
      throw error;
    });

  return loadPromise;
}

async function transcribe(audio: Float32Array): Promise<void> {
  try {
    const ready = await ensurePipeline();
    const output = await ready(audio);
    const text = (Array.isArray(output) ? output[0]?.text : output.text) ?? '';
    const trimmed = text.trim();
    if (trimmed && !isHallucination(trimmed)) post({ type: 'text', text: trimmed });
  } catch (error) {
    console.error('Breathe whisper worker: inference failed', error);
  } finally {
    post({ type: 'done' });
  }
}

worker.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'init') {
    wasmPaths = message.wasmPaths;
    void ensurePipeline().catch(() => {
      // status:'error' already posted
    });
    return;
  }
  void transcribe(message.audio);
});
