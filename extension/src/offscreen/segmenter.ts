/**
 * Pause-based speech segmentation (energy VAD with hysteresis). Replaces the
 * old fixed 3 s chunking, which sliced words mid-syllable at every boundary and
 * starved Whisper of context — the main source of garbled transcripts. Segments
 * are cut at natural silences (word onsets protected by a pre-roll), capped at
 * 12 s during continuous speech, and peak-normalized so quiet speakers stay
 * above Whisper's noise floor. Pure audio logic — no worker/chrome deps.
 */

const SAMPLE_RATE = 16_000;

// 32 ms subframes: 512 divides the ScriptProcessor's 4096-sample pushes
// exactly, gives ±32 ms boundary precision, and spans ≥2.7 pitch periods even
// for a low (85 Hz) voice, so per-subframe RMS is a stable energy estimate.
const SUBFRAME_SAMPLES = 512;
const FRAME_MS = (SUBFRAME_SAMPLES / SAMPLE_RATE) * 1000; // 32

// Hysteresis: speech must exceed ENTER_RMS to open a segment, but only
// dropping below EXIT_RMS counts as silence. 0.008 is the field-proven floor
// from the old whole-chunk gate.
const ENTER_RMS = 0.012;
const EXIT_RMS = 0.008;

// ~416 ms kept from before the detected onset — covers plosive lead-in and
// detection lag so the first word is never clipped.
const PRE_ROLL_FRAMES = 13;
// ~704 ms of continuous sub-EXIT audio ends a segment: stop-consonant closures
// (50–150 ms) and comma pauses (200–500 ms) stay inside; sentence gaps end it.
const HANG_FRAMES = 22;
// Latency: once a segment already holds ~5 s of audio it has plenty of context,
// so a shorter (~512 ms) pause is enough to cut — flowing speech otherwise
// waits the full hangover every time, or worse, the 12 s cap. 512 ms sits just
// past the 200–500 ms comma-pause band, so clauses still stay intact.
const SOFT_HANG_AFTER_FRAMES = 156;
const SOFT_HANG_FRAMES = 16;
// ~192 ms of that trailing silence is kept on the emitted segment as padding.
const TRAIL_PAD_FRAMES = 6;
// Noise gate: ≥ ~288 ms of above-ENTER audio required to emit at all.
const MIN_SPEECH_FRAMES = 9;
// Hard cap: 12 s (well under Whisper's 30 s window). During continuous speech
// the cut lands on the quietest subframe of the last ~2 s, with ~192 ms carried
// into the next segment so the boundary word survives.
const MAX_SEGMENT_FRAMES = Math.round(12_000 / FRAME_MS); // 375
const CUT_SEARCH_FRAMES = 63;
const OVERLAP_FRAMES = 6;

// Quiet-speaker rescue: segments peaking below 0.5 are scaled toward 0.9
// (gain capped ×6). VAD thresholds are always evaluated PRE-gain.
const PEAK_TARGET = 0.9;
const NORMALIZE_BELOW_PEAK = 0.5;
const MAX_GAIN = 6;

export interface SegmenterStats {
  segments: number;
  droppedShort: number;
  speechPct: number;
}

function rms(samples: Float32Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / samples.length);
}

export class Segmenter {
  private state: 'silence' | 'speech' = 'silence';
  private remainder: Float32Array | null = null;
  private preRoll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private frameRms: number[] = [];
  private speechFrames = 0;
  private silenceRun = 0;

  private statSegments = 0;
  private statDroppedShort = 0;
  private statTotalFrames = 0;
  private statSpeechFrames = 0;

  constructor(private readonly onSegment: (samples: Float32Array) => void) {}

  /** Feed a block of 16 kHz mono samples. The caller reuses the buffer — copy. */
  push(block: Float32Array): void {
    let samples = block;
    if (this.remainder) {
      const joined = new Float32Array(this.remainder.length + block.length);
      joined.set(this.remainder);
      joined.set(block, this.remainder.length);
      samples = joined;
      this.remainder = null;
    }
    let offset = 0;
    while (offset + SUBFRAME_SAMPLES <= samples.length) {
      // slice() copies — required, the audio callback reuses its buffer.
      this.processSubframe(samples.slice(offset, offset + SUBFRAME_SAMPLES));
      offset += SUBFRAME_SAMPLES;
    }
    if (offset < samples.length) this.remainder = samples.slice(offset);
  }

  reset(): void {
    this.state = 'silence';
    this.remainder = null;
    this.preRoll = [];
    this.frames = [];
    this.frameRms = [];
    this.speechFrames = 0;
    this.silenceRun = 0;
  }

  /** Counters since the last call (for the periodic vad-stats diagnostic). */
  takeStats(): SegmenterStats {
    const stats: SegmenterStats = {
      segments: this.statSegments,
      droppedShort: this.statDroppedShort,
      speechPct:
        this.statTotalFrames === 0
          ? 0
          : Math.round((this.statSpeechFrames / this.statTotalFrames) * 100),
    };
    this.statSegments = 0;
    this.statDroppedShort = 0;
    this.statTotalFrames = 0;
    this.statSpeechFrames = 0;
    return stats;
  }

  private processSubframe(subframe: Float32Array): void {
    const level = rms(subframe);
    this.statTotalFrames += 1;

    if (this.state === 'silence') {
      if (level >= ENTER_RMS) {
        // Onset: open a segment seeded with the pre-roll so the first word's
        // leading edge (already in the past) is included.
        this.frames = [...this.preRoll, subframe];
        this.frameRms = [...this.preRoll.map(rms), level];
        this.preRoll = [];
        this.speechFrames = 1;
        this.silenceRun = 0;
        this.state = 'speech';
        this.statSpeechFrames += 1;
      } else {
        this.preRoll.push(subframe);
        if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
      }
      return;
    }

    this.statSpeechFrames += 1;
    this.frames.push(subframe);
    this.frameRms.push(level);

    if (level < EXIT_RMS) {
      this.silenceRun += 1;
      const hang =
        this.frames.length >= SOFT_HANG_AFTER_FRAMES ? SOFT_HANG_FRAMES : HANG_FRAMES;
      if (this.silenceRun >= hang) {
        this.endpoint();
        return;
      }
    } else {
      this.silenceRun = 0;
      if (level >= ENTER_RMS) this.speechFrames += 1;
    }

    if (this.frames.length >= MAX_SEGMENT_FRAMES) this.forceCut();
  }

  /** Natural pause: trim the hangover to a short pad, emit, recycle silence. */
  private endpoint(): void {
    // The hangover is adaptive, so trim from the run actually observed.
    const drop = Math.max(0, this.silenceRun - TRAIL_PAD_FRAMES);
    const emitted = this.frames.slice(0, this.frames.length - drop);
    // Seed the next onset's pre-roll from the FULL trailing-silence run — it
    // may overlap the emitted trail pad, but duplicated silence is harmless;
    // a starved pre-roll after a short soft-hang cut would clip word onsets.
    this.preRoll = this.frames.slice(-Math.min(this.silenceRun, PRE_ROLL_FRAMES));

    if (this.speechFrames >= MIN_SPEECH_FRAMES && emitted.length > 0) {
      this.emit(emitted);
    } else {
      this.statDroppedShort += 1;
    }
    this.frames = [];
    this.frameRms = [];
    this.speechFrames = 0;
    this.silenceRun = 0;
    this.state = 'silence';
  }

  /** 12 s of continuous speech: cut at the quietest recent subframe. */
  private forceCut(): void {
    const searchStart = Math.max(1, this.frames.length - CUT_SEARCH_FRAMES);
    let cut = searchStart;
    for (let i = searchStart; i < this.frames.length; i += 1) {
      const level = this.frameRms[i];
      const best = this.frameRms[cut];
      if (level !== undefined && best !== undefined && level < best) cut = i;
    }

    this.emit(this.frames.slice(0, cut));

    // Carry a short overlap into the next segment so the boundary word — even
    // at the quietest point — isn't lost. May rarely duplicate one word.
    const keepFrom = Math.max(0, cut - OVERLAP_FRAMES);
    this.frames = this.frames.slice(keepFrom);
    this.frameRms = this.frameRms.slice(keepFrom);
    this.speechFrames = this.frameRms.filter((level) => level >= ENTER_RMS).length;
    this.silenceRun = 0;
    for (let i = this.frameRms.length - 1; i >= 0; i -= 1) {
      const level = this.frameRms[i];
      if (level === undefined || level >= EXIT_RMS) break;
      this.silenceRun += 1;
    }
    // state stays 'speech'
  }

  private emit(frames: Float32Array[]): void {
    let length = 0;
    for (const frame of frames) length += frame.length;
    if (length === 0) return;
    const segment = new Float32Array(length);
    let offset = 0;
    for (const frame of frames) {
      segment.set(frame, offset);
      offset += frame.length;
    }

    let peak = 0;
    for (const sample of segment) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
    if (peak > 0 && peak < NORMALIZE_BELOW_PEAK) {
      const gain = Math.min(PEAK_TARGET / peak, MAX_GAIN);
      for (let i = 0; i < segment.length; i += 1) {
        const sample = segment[i];
        if (sample !== undefined) segment[i] = sample * gain;
      }
    }

    this.statSegments += 1;
    this.onSegment(segment);
  }
}
