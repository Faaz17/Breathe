import type { SttState } from '../lib/messages';

/**
 * Buffers 16 kHz mono audio into fixed chunks and runs them through Whisper in a
 * Web Worker (see whisper.worker.ts) — keeping inference off this thread so audio
 * capture is never starved. Fully local; only the one-time model download leaves
 * the browser. WebGPU (≈10× faster, larger model files) is a Phase 6 perf upgrade;
 * if base.en can't keep up the worker queue absorbs the lag and chunks are dropped
 * past a cap rather than growing without bound.
 */

const SAMPLE_RATE = 16_000;
// Chunk length is the latency floor (text can't appear until its chunk fills).
// 3 s keeps lag low on the GPU backend; much shorter starves Whisper of context
// and hurts accuracy. Bump back up if running on the slower CPU/WASM fallback.
const CHUNK_SECONDS = 3;
const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS;
// Whisper hallucinates phantom words ("Thank you.") on silence — skip quiet chunks.
const SILENCE_RMS = 0.008;
// Bound the worker backlog (e.g. while a first-run model download is in flight).
const MAX_IN_FLIGHT = 6;

type WorkerOut =
  | { type: 'status'; state: SttState; progress?: number; message?: string }
  | { type: 'text'; text: string }
  | { type: 'done' };

export interface TranscriberCallbacks {
  onText: (text: string) => void;
  onStatus: (state: SttState, progress?: number, message?: string) => void;
}

function rms(samples: Float32Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / samples.length);
}

class Transcriber {
  private worker: Worker | null = null;
  private callbacks: TranscriberCallbacks | null = null;
  private active = false;

  private pending: Float32Array[] = [];
  private pendingLength = 0;
  private inFlight = 0;

  /** Begin a session: spin up the worker and kick off the (cached after first run) model load. */
  start(callbacks: TranscriberCallbacks): void {
    this.callbacks = callbacks;
    this.active = true;
    this.pending = [];
    this.pendingLength = 0;
    this.inFlight = 0;

    if (!this.worker) {
      this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event: MessageEvent<WorkerOut>) =>
        this.onWorkerMessage(event.data),
      );
    }
    // The worker has no chrome.* APIs, so hand it the extension-local ORT path.
    this.worker.postMessage({ type: 'init', wasmPaths: chrome.runtime.getURL('ort/') });
  }

  /** End a session. The worker (and its loaded model) is kept alive so re-recording is instant. */
  stop(): void {
    this.active = false;
    this.callbacks = null;
    this.pending = [];
    this.pendingLength = 0;
    this.inFlight = 0;
  }

  /** Feed one block of 16 kHz mono samples. The buffer is reused by the caller, so copy. */
  push(frame: Float32Array): void {
    if (!this.active) return;
    this.pending.push(frame.slice());
    this.pendingLength += frame.length;
    while (this.pendingLength >= CHUNK_SAMPLES) this.cutChunk();
  }

  private cutChunk(): void {
    const chunk = new Float32Array(CHUNK_SAMPLES);
    let offset = 0;
    while (offset < CHUNK_SAMPLES) {
      const head = this.pending[0];
      if (head === undefined) break;
      const need = CHUNK_SAMPLES - offset;
      if (head.length <= need) {
        chunk.set(head, offset);
        offset += head.length;
        this.pending.shift();
      } else {
        chunk.set(head.subarray(0, need), offset);
        this.pending[0] = head.subarray(need);
        offset += need;
      }
    }
    this.pendingLength -= CHUNK_SAMPLES;

    if (rms(chunk) < SILENCE_RMS) return; // drop silence without burdening the worker
    if (this.inFlight >= MAX_IN_FLIGHT) return; // backlog full; drop rather than grow unbounded

    this.inFlight += 1;
    this.worker?.postMessage({ type: 'transcribe', audio: chunk }, [chunk.buffer]);
  }

  private onWorkerMessage(message: WorkerOut): void {
    switch (message.type) {
      case 'status':
        this.callbacks?.onStatus(message.state, message.progress, message.message);
        return;
      case 'text':
        if (this.active) this.callbacks?.onText(message.text);
        return;
      case 'done':
        this.inFlight = Math.max(0, this.inFlight - 1);
        return;
    }
  }
}

export const transcriber = new Transcriber();
