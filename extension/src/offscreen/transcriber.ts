import type { SttState } from '../lib/messages';
import { Segmenter } from './segmenter';

/**
 * Feeds pause-based speech segments (see segmenter.ts) through Whisper in a
 * Web Worker (whisper.worker.ts) — keeping inference off this thread so audio
 * capture is never starved. Fully local; only the one-time model download
 * leaves the browser. If the worker thread dies (WebGPU device loss, OOM) or
 * stalls, it is terminated and respawned — repeated failures force the WASM
 * backend (which loads the lighter base.en model). Respawn model reloads are
 * CacheStorage hits, not fresh downloads.
 */

// Segments are up to 12 s, so cap the backlog by count: 3 × 12 s = 36 s of
// queued audio worst-case. Beyond that, drop rather than grow unbounded.
const MAX_IN_FLIGHT = 3;

// A worker with work in flight but no message of any kind for this long is
// presumed dead/hung — without this, inFlight pins at MAX_IN_FLIGHT and every
// later segment is silently dropped for the rest of the meeting. 120 s because
// a single 12 s segment on single-thread WASM can legitimately take >45 s
// between its 'tick' and 'done' with nothing in between.
const STALL_TIMEOUT_MS = 120_000;
const STALL_CHECK_INTERVAL_MS = 15_000;
// After this many worker deaths, stop trusting the GPU and force WASM.
const FORCE_WASM_AFTER_FAILURES = 2;
// Periodic VAD counters to breatheDiag() — the tuning signal for thresholds.
const VAD_STATS_INTERVAL_MS = 60_000;

type DiagDetail = Record<string, string | number | boolean>;

type WorkerOut =
  | { type: 'status'; state: SttState; progress?: number; message?: string }
  | { type: 'text'; text: string }
  | { type: 'diag'; event: string; detail?: DiagDetail }
  | { type: 'tick' }
  | { type: 'done' };

export interface TranscriberCallbacks {
  onText: (text: string) => void;
  onStatus: (state: SttState, progress?: number, message?: string) => void;
  onDiag: (event: string, detail?: DiagDetail) => void;
}

export interface TranscriberConfig {
  model: string;
}

class Transcriber {
  private worker: Worker | null = null;
  private callbacks: TranscriberCallbacks | null = null;
  private active = false;
  private model = '';

  private readonly segmenter = new Segmenter((samples) => this.onSegment(samples));
  private inFlight = 0;
  private droppedBackpressure = 0;

  private lastWorkerActivityAt = 0;
  private stallTimerId: ReturnType<typeof setInterval> | null = null;
  private lastStatsAt = 0;
  private workerFailures = 0;

  /** Begin a session: spin up the worker and kick off the (cached after first run) model load. */
  start(callbacks: TranscriberCallbacks, config: TranscriberConfig): void {
    this.callbacks = callbacks;
    this.model = config.model;
    this.active = true;
    this.segmenter.reset();
    this.inFlight = 0;
    this.droppedBackpressure = 0;
    this.lastStatsAt = Date.now();

    this.ensureWorker();
    if (this.stallTimerId === null) {
      this.stallTimerId = setInterval(() => this.checkStall(), STALL_CHECK_INTERVAL_MS);
    }
  }

  /** End a session. The worker (and its loaded model) is kept alive so re-recording is instant. */
  stop(): void {
    this.active = false;
    this.callbacks = null;
    // The in-progress segment is dropped: endpointing fires ~700 ms after the
    // last word, so only stopping mid-utterance loses text. (A flush-on-stop
    // handshake with the service worker is future work.)
    this.segmenter.reset();
    this.inFlight = 0;
    if (this.stallTimerId !== null) {
      clearInterval(this.stallTimerId);
      this.stallTimerId = null;
    }
  }

  /** Feed one block of 16 kHz mono samples. The buffer is reused by the caller. */
  push(frame: Float32Array): void {
    if (!this.active) return;
    this.segmenter.push(frame);
  }

  private onSegment(samples: Float32Array): void {
    if (!this.active) return;
    if (this.inFlight >= MAX_IN_FLIGHT) {
      this.droppedBackpressure += 1;
      return;
    }
    this.inFlight += 1;
    this.worker?.postMessage({ type: 'transcribe', audio: samples }, [samples.buffer]);
  }

  private ensureWorker(): void {
    if (!this.worker) {
      this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event: MessageEvent<WorkerOut>) =>
        this.onWorkerMessage(event.data),
      );
      // A dead worker thread never posts 'done' — without these, inFlight pins
      // at the cap and transcription dies silently while "Recording" stays on.
      this.worker.addEventListener('error', (event) =>
        this.handleWorkerFailure('worker-error', event.message ?? ''),
      );
      this.worker.addEventListener('messageerror', () =>
        this.handleWorkerFailure('worker-messageerror', ''),
      );
    }
    this.lastWorkerActivityAt = Date.now();
    // The worker has no chrome.* APIs, so hand it the extension-local ORT path
    // and the user's chosen model.
    this.worker.postMessage({
      type: 'init',
      wasmPaths: chrome.runtime.getURL('ort/'),
      model: this.model,
      forceWasm: this.workerFailures >= FORCE_WASM_AFTER_FAILURES,
    });
  }

  /** Terminate and respawn the worker; the in-flight segments (≤36 s audio) are lost. */
  private handleWorkerFailure(event: string, detail: string): void {
    this.callbacks?.onDiag('worker-respawn', {
      event,
      detail,
      failures: this.workerFailures + 1,
      droppedSegments: this.inFlight,
    });
    this.workerFailures += 1;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = 0;
    if (!this.active) return;
    this.callbacks?.onStatus('loading', undefined, 'Restarting transcription…');
    this.ensureWorker();
  }

  private checkStall(): void {
    if (!this.active) return;

    const now = Date.now();
    if (now - this.lastStatsAt >= VAD_STATS_INTERVAL_MS) {
      this.lastStatsAt = now;
      const stats = this.segmenter.takeStats();
      this.callbacks?.onDiag('vad-stats', {
        ...stats,
        droppedBackpressure: this.droppedBackpressure,
        inFlight: this.inFlight,
      });
      this.droppedBackpressure = 0;
    }

    if (this.inFlight === 0) return;
    if (now - this.lastWorkerActivityAt <= STALL_TIMEOUT_MS) return;
    this.handleWorkerFailure('worker-stalled', `inFlight=${this.inFlight}`);
  }

  private onWorkerMessage(message: WorkerOut): void {
    this.lastWorkerActivityAt = Date.now();
    switch (message.type) {
      case 'status':
        this.callbacks?.onStatus(message.state, message.progress, message.message);
        return;
      case 'text':
        if (this.active) this.callbacks?.onText(message.text);
        return;
      case 'diag':
        this.callbacks?.onDiag(message.event, message.detail);
        return;
      case 'tick':
        return; // activity stamp only (handled above)
      case 'done':
        this.inFlight = Math.max(0, this.inFlight - 1);
        return;
    }
  }
}

export const transcriber = new Transcriber();
