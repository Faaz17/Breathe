import type { StopReason, SttState, SummaryError } from '../lib/messages';

type Listener = () => void;
type PanelSttState = SttState | 'idle';
type PanelSummaryState = 'idle' | 'loading' | 'done' | 'error';

/**
 * Passive store of capture state for the panel. The offscreen document does the
 * actual capture/transcription; the service worker relays the level, recording
 * flag, transcript chunks and model status here. The VU meter reads `getLevel()`
 * each frame (no React churn); everything reactive notifies subscribers.
 */
class CaptureStore {
  private level = 0;
  private recording = false;
  private stopReason: StopReason | '' = '';
  private transcript = '';
  private sttState: PanelSttState = 'idle';
  private sttProgress = 0;
  private sttMessage = '';
  private summaryState: PanelSummaryState = 'idle';
  private summaryMarkdown = '';
  private summaryError: SummaryError | '' = '';
  private readonly listeners = new Set<Listener>();

  setLevel(level: number): void {
    this.level = level;
  }

  setRecording(recording: boolean, reason: StopReason | '' = ''): void {
    if (recording === this.recording) return;
    // A fresh recording starts with a clean transcript; a stopped one stays
    // readable until the next session begins.
    if (recording) {
      this.transcript = '';
      this.sttState = 'idle';
      this.sttProgress = 0;
      this.sttMessage = '';
      this.summaryState = 'idle';
      this.summaryMarkdown = '';
      this.summaryError = '';
    }
    this.stopReason = recording ? '' : reason;
    this.recording = recording;
    this.emit();
  }

  /**
   * Seed state from the service worker's GET_STATE on mount, so a panel that
   * remounts mid- or post-recording (Meet reload) doesn't look dead. Never
   * downgrades: live messages that raced ahead of the response win.
   */
  hydrate(recording: boolean, transcript: string, summary: string): void {
    if (this.recording && !recording) return;
    this.recording = this.recording || recording;
    // The persisted transcript includes anything already relayed live; only a
    // pending-write race could make it shorter, and then the live text wins.
    if (transcript.length > this.transcript.length) this.transcript = transcript;
    if (summary && this.summaryState === 'idle') {
      this.summaryState = 'done';
      this.summaryMarkdown = summary;
    }
    this.emit();
  }

  setSummaryStatus(
    state: PanelSummaryState,
    markdown = '',
    error: SummaryError | '' = '',
  ): void {
    this.summaryState = state;
    this.summaryMarkdown = markdown;
    this.summaryError = error;
    this.emit();
  }

  appendTranscript(text: string): void {
    this.transcript = this.transcript ? `${this.transcript} ${text}` : text;
    this.emit();
  }

  setSttStatus(state: SttState, progress = 0, message = ''): void {
    if (state === this.sttState && progress === this.sttProgress && message === this.sttMessage) {
      return;
    }
    this.sttState = state;
    this.sttProgress = progress;
    this.sttMessage = message;
    this.emit();
  }

  getLevel(): number {
    return this.level;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getStopReason(): StopReason | '' {
    return this.stopReason;
  }

  getTranscript(): string {
    return this.transcript;
  }

  getSttState(): PanelSttState {
    return this.sttState;
  }

  getSttProgress(): number {
    return this.sttProgress;
  }

  getSttMessage(): string {
    return this.sttMessage;
  }

  getSummaryState(): PanelSummaryState {
    return this.summaryState;
  }

  getSummaryMarkdown(): string {
    return this.summaryMarkdown;
  }

  getSummaryError(): SummaryError | '' {
    return this.summaryError;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const capture = new CaptureStore();
