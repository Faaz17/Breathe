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

// The model id arrives via the init message (user-selectable in settings;
// workers have no chrome.* / IndexedDB plumbing of their own). fp32 only:
// fp16 degenerates on this WebGPU/ORT decoder and q4/q8 hit a session bug.
const DEFAULT_MODEL = 'Xenova/whisper-small.en';
// small.en is unusably slow on single-thread WASM — substitute base.en there.
const WASM_MODEL = 'Xenova/whisper-base.en';

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

// After this many inference failures in a row on the GPU backend (typically a
// lost WebGPU device — the worker survives but every call throws), rebuild the
// pipeline on WASM instead of erroring silently for the rest of the meeting.
const GPU_FAILURE_ESCALATION = 3;

type Pipe = AutomaticSpeechRecognitionPipeline;
type InMessage =
  | { type: 'init'; wasmPaths: string; model: string; forceWasm?: boolean }
  | { type: 'transcribe'; audio: Float32Array };
type OutMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; progress?: number; message?: string }
  | { type: 'text'; text: string }
  | { type: 'diag'; event: string; detail?: Record<string, string | number | boolean> }
  // Posted when a transcription is picked up, so the transcriber's stall clock
  // can tell "slow inference" from "dead worker" (nothing else is emitted
  // between picking up a segment and finishing it).
  | { type: 'tick' }
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
// What the user picked (init message) vs what the live pipe was built with.
let requestedModel = DEFAULT_MODEL;
// Backend + model label surfaced to the panel ("Transcribing · GPU · small.en").
let backendLabel = 'CPU';
// The device the live pipeline runs on (drives the GPU-failure escalation).
let activeDevice: 'webgpu' | 'wasm' | null = null;
// Set via init (after repeated worker deaths) or by the escalation below.
let forcedWasm = false;
let consecutiveFailures = 0;

function post(message: OutMessage): void {
  worker.postMessage(message);
}

/**
 * Aggregate download progress across ALL model files (small.en is a 353 MB
 * encoder + 615 MB decoder plus small configs) into one smooth, monotonic
 * percentage — per-file progress would sawtooth 0→100 repeatedly.
 */
const fileProgress = new Map<string, { loaded: number; total: number }>();
let maxPercent = 0;

function resetProgress(): void {
  fileProgress.clear();
  maxPercent = 0;
}

function progressCallback(report: {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}): void {
  if (!report.file) return;
  if (report.status === 'initiate') {
    fileProgress.set(report.file, { loaded: 0, total: 0 });
  } else if (report.status === 'progress') {
    fileProgress.set(report.file, { loaded: report.loaded ?? 0, total: report.total ?? 0 });
  } else if (report.status === 'done') {
    const entry = fileProgress.get(report.file);
    if (entry) entry.loaded = entry.total;
  } else {
    return;
  }

  let loaded = 0;
  let total = 0;
  for (const entry of fileProgress.values()) {
    loaded += entry.loaded;
    total += entry.total;
  }
  if (total === 0) return;
  // Cap at 99 (100 shows as "Preparing…"; 'ready' ends it) and clamp monotonic
  // so the percentage never drops when a new file joins the denominator.
  const percent = Math.min(99, Math.round((loaded / total) * 100));
  if (percent <= maxPercent) return;
  maxPercent = percent;
  post({ type: 'status', state: 'loading', progress: percent });
}

/** Model actually loaded for a device — WASM always gets the lighter base.en. */
function effectiveModel(device: 'webgpu' | 'wasm'): string {
  return device === 'wasm' ? WASM_MODEL : requestedModel;
}

/** 'Xenova/whisper-small.en' → 'small.en' for the panel label. */
function shortName(model: string): string {
  const marker = 'whisper-';
  const index = model.lastIndexOf(marker);
  return index === -1 ? model : model.slice(index + marker.length);
}

function buildPipeline(device: 'webgpu' | 'wasm'): Promise<Pipe> {
  return pipeline('automatic-speech-recognition', effectiveModel(device), {
    device,
    // fp32 only. fp16 degenerates on this WebGPU/ORT decoder (repetitive token
    // garbage), and q4/q8 (MatMulNBits) hit a session-creation bug in this ORT
    // dev build. fp32 is the one precision confirmed to produce clean output.
    dtype: 'fp32',
    progress_callback: progressCallback,
  });
}

/** Drop the live pipeline (model switch): frees ~1 GB before the rebuild. */
function resetPipeline(): void {
  const stale = pipe;
  pipe = null;
  loadPromise = null;
  activeDevice = null;
  consecutiveFailures = 0;
  resetProgress();
  if (stale) void Promise.resolve(stale.dispose()).catch(() => undefined);
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
  // is cheap). forcedWasm skips the GPU entirely after it has already proven
  // unstable this session. The WASM path always loads base.en (effectiveModel),
  // so every degradation chain lands on the lighter model automatically.
  const tryWebGpu = !forcedWasm && typeof navigator !== 'undefined' && 'gpu' in navigator;
  const buildWasm = (why: string): Promise<Pipe> => {
    post({ type: 'diag', event: 'wasm-backend', detail: { why } });
    const substituted = requestedModel !== WASM_MODEL;
    backendLabel = substituted
      ? `CPU · ${shortName(WASM_MODEL)} (${shortName(requestedModel)} is GPU-only)`
      : `CPU · ${shortName(WASM_MODEL)}`;
    activeDevice = 'wasm';
    resetProgress();
    return buildPipeline('wasm');
  };
  resetProgress();
  loadPromise ??= (
    tryWebGpu
      ? buildPipeline('webgpu')
          .then((ready) => {
            backendLabel = `GPU · ${shortName(requestedModel)}`;
            activeDevice = 'webgpu';
            return ready;
          })
          .catch((error: unknown) => {
            const why = error instanceof Error ? error.message : String(error);
            console.warn('Breathe whisper worker: WebGPU unavailable, using WASM', error);
            return buildWasm(`webgpu-failed: ${why}`);
          })
      : buildWasm(forcedWasm ? 'forced after GPU failures' : 'no navigator.gpu in worker')
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

/**
 * Repeated inference failures usually mean a lost WebGPU device: the worker
 * survives but every call throws, so without this the transcript silently goes
 * blank for the rest of the meeting. On the GPU backend, rebuild on WASM; if
 * WASM itself keeps failing, surface an error state to the panel.
 */
function escalateRepeatedFailures(error: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures < GPU_FAILURE_ESCALATION) return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (activeDevice === 'webgpu') {
    post({ type: 'diag', event: 'gpu-escalation', detail: { failures: consecutiveFailures } });
    post({ type: 'status', state: 'loading', message: 'Restarting transcription on CPU…' });
    consecutiveFailures = 0;
    forcedWasm = true;
    pipe = null;
    loadPromise = null; // next chunk rebuilds on WASM (weights are cache hits)
    // Chunks still in flight against the dead GPU pipe keep failing while the
    // rebuild runs; null marks "in transition" so they can't re-escalate.
    activeDevice = null;
  } else if (activeDevice === 'wasm') {
    post({ type: 'status', state: 'error', message: detail });
  }
}

async function transcribe(audio: Float32Array): Promise<void> {
  post({ type: 'tick' }); // stall clock: segment picked up (inference emits nothing until done)
  try {
    const ready = await ensurePipeline();
    const output = await ready(audio);
    const text = (Array.isArray(output) ? output[0]?.text : output.text) ?? '';
    const trimmed = text.trim();
    if (trimmed && !isHallucination(trimmed)) post({ type: 'text', text: trimmed });
    consecutiveFailures = 0;
  } catch (error) {
    console.error('Breathe whisper worker: inference failed', error);
    escalateRepeatedFailures(error);
  } finally {
    post({ type: 'done' });
  }
}

worker.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'init') {
    wasmPaths = message.wasmPaths;
    if (message.forceWasm) forcedWasm = true;
    if (message.model !== requestedModel) {
      // Model changed in settings: drop the loaded pipeline and rebuild. Init
      // re-arrives on every session start and worker respawn, so a switch
      // takes effect on the next recording.
      requestedModel = message.model;
      resetPipeline();
    }
    void ensurePipeline().catch(() => {
      // status:'error' already posted
    });
    return;
  }
  void transcribe(message.audio);
});
