/**
 * Persistent diagnostics ring buffer. Recording failures on an hour-long call
 * can't be debugged live, so every lifecycle event (start/stop + reason, tab
 * updates, capture loss, watchdog firings, resume attempts, worker respawns)
 * is appended here and survives service-worker restarts.
 *
 * Read it from the service-worker console with `breatheDiag()` (registered in
 * src/background/index.ts). Only the service worker writes — the offscreen
 * document logs via the DIAG message — so ring-buffer writes never race.
 */

export type DiagDetail = Record<string, string | number | boolean>;

interface DiagEntry extends DiagDetail {
  t: number;
  src: 'sw' | 'off';
  event: string;
}

const DIAG_KEY = 'diag';
const MAX_ENTRIES = 200;

// Serialise read-modify-writes so concurrent events can't clobber each other.
let queue: Promise<void> = Promise.resolve();

export function diag(src: 'sw' | 'off', event: string, detail?: DiagDetail): void {
  const entry: DiagEntry = { ...detail, t: Date.now(), src, event };
  queue = queue
    .then(async () => {
      const stored = await chrome.storage.local.get(DIAG_KEY);
      const entries = Array.isArray(stored[DIAG_KEY]) ? (stored[DIAG_KEY] as DiagEntry[]) : [];
      entries.push(entry);
      await chrome.storage.local.set({ [DIAG_KEY]: entries.slice(-MAX_ENTRIES) });
    })
    .catch(() => {
      // Diagnostics must never break the pipeline.
    });
}

export async function readDiag(): Promise<DiagEntry[]> {
  const stored = await chrome.storage.local.get(DIAG_KEY);
  return Array.isArray(stored[DIAG_KEY]) ? (stored[DIAG_KEY] as DiagEntry[]) : [];
}
