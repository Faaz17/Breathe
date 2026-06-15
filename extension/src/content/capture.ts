type Listener = () => void;

/**
 * Passive store of capture state for the panel. The offscreen document does the
 * actual capture/analysis; the service worker relays the level and recording flag
 * here. The VU meter reads `getLevel()` each frame (no React state churn); the
 * panel subscribes to the recording flag.
 */
class CaptureStore {
  private level = 0;
  private recording = false;
  private readonly listeners = new Set<Listener>();

  setLevel(level: number): void {
    this.level = level;
  }

  setRecording(recording: boolean): void {
    if (recording === this.recording) return;
    this.recording = recording;
    for (const listener of this.listeners) listener();
  }

  getLevel(): number {
    return this.level;
  }

  isRecording(): boolean {
    return this.recording;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const capture = new CaptureStore();
