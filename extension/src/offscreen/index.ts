import { getSettings } from '../lib/db';
import { Message, type PingReply, type SttState } from '../lib/messages';
import { transcriber } from './transcriber';

type DiagDetail = Record<string, string | number | boolean>;

/** Diagnostics go through the service worker — the ring buffer has one writer. */
function sendDiag(event: string, detail?: DiagDetail): void {
  const message: Message = { type: 'DIAG', event, detail };
  void chrome.runtime.sendMessage(message).catch(() => {
    /* SW between wakes; diagnostics are best-effort */
  });
}

// Non-standard tab-capture constraints (not in lib.dom's MediaTrackConstraints).
interface TabCaptureConstraints {
  audio: { mandatory: { chromeMediaSource: 'tab'; chromeMediaSourceId: string } };
  video: false;
}

const FFT_SIZE = 1024;
const LEVEL_GAIN = 4;
const FALL_SMOOTHING = 0.7; // meter rises instantly, falls gently
// Offscreen documents never paint, so requestAnimationFrame doesn't fire here —
// drive the meter off a timer instead (~30 updates/s; the panel paints at 60fps).
const MEASURE_INTERVAL_MS = 33;

// Whisper wants 16 kHz mono; a dedicated context resamples for us so the
// playback/VU context (full quality) stays untouched.
const STT_SAMPLE_RATE = 16_000;
const STT_BUFFER_SIZE = 4096;

let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let buffer: Uint8Array<ArrayBuffer> | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let level = 0;
let tabId: number | null = null;

let sttContext: AudioContext | null = null;
let sttProcessor: ScriptProcessorNode | null = null;
let captureLostReported = false;

// Tab capture only hears OTHER participants — the user's own mic never reaches
// the tab's audio output. When enabled in settings, the mic is mixed into the
// transcription graph (only; never played back) so their side is in the notes.
let micStream: MediaStream | null = null;
let micActive = false;
let micRequested = false;

/**
 * Chrome ended the capture out from under us (media-process death, tab
 * teardown). Report it ONCE so the service worker can auto-resume — without
 * this the panel keeps showing "Recording" over dead audio. Never fires on our
 * own teardown: stop() nulls tabId first, and a local track.stop() doesn't
 * raise 'ended' anyway.
 */
function reportCaptureLost(detail: 'track-ended' | 'stream-inactive' | 'no-track'): void {
  if (tabId === null || captureLostReported) return;
  captureLostReported = true;
  sendDiag('capture-lost', { detail });
  const message: Message = { type: 'CAPTURE_LOST', tabId, detail };
  void chrome.runtime.sendMessage(message).catch(() => {
    /* SW will notice via the watchdog heartbeat going stale */
  });
}

/** Offscreen docs shouldn't be throttled into suspension, but never trust it. */
function watchContextState(context: AudioContext, label: string): void {
  context.onstatechange = () => {
    if (context.state !== 'suspended') return;
    sendDiag('context-suspended', { label });
    void context.resume().catch(() => {
      /* resume can only fail if the context is being closed */
    });
  };
}

async function start(streamId: string, targetTabId: number): Promise<void> {
  await stop();
  tabId = targetTabId;
  captureLostReported = false;

  const constraints: TabCaptureConstraints = {
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  };
  stream = await navigator.mediaDevices.getUserMedia(
    constraints as unknown as MediaStreamConstraints,
  );

  const track = stream.getAudioTracks()[0];
  if (!track) {
    reportCaptureLost('no-track');
    return;
  }
  track.addEventListener('ended', () => reportCaptureLost('track-ended'));
  stream.addEventListener('inactive', () => reportCaptureLost('stream-inactive'));
  // Mute/unmute are transient (audio-process hiccups) — log, don't kill.
  track.addEventListener('mute', () => sendDiag('track-muted'));
  track.addEventListener('unmute', () => sendDiag('track-unmuted'));

  const settings = await getSettings();
  micRequested = settings.captureMicrophone;
  if (micRequested) await acquireMicrophone();

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);
  // Play the captured audio back. This is the offscreen document, NOT the captured
  // meeting tab, so playback is audible and never re-captured (no feedback).
  source.connect(audioContext.destination);
  watchContextState(audioContext, 'playback');

  buffer = new Uint8Array(analyser.fftSize);
  timerId = setInterval(measure, MEASURE_INTERVAL_MS);

  startTranscription(stream, targetTabId, settings.transcriptionModel);
}

/**
 * The mic permission itself is pre-granted from the options page (offscreen
 * documents can't show a prompt) — here a missing grant just means tab-only
 * transcription, surfaced via the "· mic off" status suffix.
 */
async function acquireMicrophone(): Promise<void> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation strips the meeting audio this document plays back
      // from the mic signal, so remote speech isn't transcribed twice.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const micTrack = micStream.getAudioTracks()[0];
    // Headset unplugged mid-call: keep recording tab-only. NEVER treat this as
    // capture loss — tab capture is healthy and auto-resume must not fire.
    micTrack?.addEventListener('ended', () => {
      micActive = false;
      sendDiag('mic-track-ended');
    });
    micActive = micTrack !== undefined;
  } catch (error) {
    micStream = null;
    micActive = false;
    sendDiag('mic-unavailable', { message: String(error) });
  }
}

/**
 * Taps raw 16 kHz PCM off the captured stream and feeds it to the local Whisper
 * transcriber. The ScriptProcessor outputs silence (we never fill its output
 * buffer) but must be connected to the destination to keep pulling input.
 */
function startTranscription(source: MediaStream, targetTabId: number, model: string): void {
  sttContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  // Tab audio and (when enabled) the mic are summed through one mixer node —
  // the ScriptProcessor has a single input. Chrome resamples the 48 kHz mic
  // into this 16 kHz context automatically. The mic never touches the playback
  // context (self-echo); levels are left at unity — platform AGC plus the
  // segmenter's per-segment normalization even them out.
  const mixer = sttContext.createGain();
  sttContext.createMediaStreamSource(source).connect(mixer);
  if (micStream && micActive) {
    sttContext.createMediaStreamSource(micStream).connect(mixer);
  }
  sttProcessor = sttContext.createScriptProcessor(STT_BUFFER_SIZE, 1, 1);
  mixer.connect(sttProcessor);
  sttProcessor.connect(sttContext.destination);
  watchContextState(sttContext, 'stt');

  sttProcessor.onaudioprocess = (event) => {
    transcriber.push(event.inputBuffer.getChannelData(0));
  };

  transcriber.start(
    {
      onText: (text) => sendTranscript(targetTabId, text),
      onStatus: (state, progress, message) => sendStatus(targetTabId, state, progress, message),
      onDiag: sendDiag,
    },
    { model },
  );
}

function sendTranscript(targetTabId: number, text: string): void {
  const message: Message = { type: 'TRANSCRIPT_CHUNK', tabId: targetTabId, text };
  void chrome.runtime.sendMessage(message);
}

function sendStatus(
  targetTabId: number,
  state: SttState,
  progress?: number,
  message?: string,
): void {
  // Panel shows "Transcribing · {message}" — flag a wanted-but-missing mic
  // there ("GPU · small.en · mic off") without any new message plumbing.
  const decorated =
    state === 'ready' && micRequested && !micActive && message
      ? `${message} · mic off`
      : message;
  const payload: Message = {
    type: 'TRANSCRIBE_STATUS',
    tabId: targetTabId,
    state,
    progress,
    message: decorated,
  };
  void chrome.runtime.sendMessage(payload);
}

async function stop(): Promise<void> {
  // Null tabId first: reportCaptureLost becomes a no-op, so our own teardown
  // (or a stream going inactive as we close it) never reads as a lost capture.
  tabId = null;
  if (timerId !== null) clearInterval(timerId);
  transcriber.stop();
  if (sttProcessor) sttProcessor.onaudioprocess = null;
  sttProcessor?.disconnect();
  if (sttContext) {
    sttContext.onstatechange = null;
    await sttContext.close();
  }
  stream?.getTracks().forEach((track) => track.stop());
  // Stopping mic tracks explicitly releases the OS mic indicator immediately.
  micStream?.getTracks().forEach((track) => track.stop());
  if (audioContext) {
    audioContext.onstatechange = null;
    await audioContext.close();
  }

  timerId = null;
  sttProcessor = null;
  sttContext = null;
  stream = null;
  micStream = null;
  micActive = false;
  micRequested = false;
  audioContext = null;
  analyser = null;
  buffer = null;
  level = 0;
}

function measure(): void {
  if (!analyser || !buffer || tabId === null) return;

  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (const sample of buffer) {
    const centered = (sample - 128) / 128;
    sumSquares += centered * centered;
  }
  const rms = Math.sqrt(sumSquares / buffer.length);
  const target = Math.min(1, rms * LEVEL_GAIN);
  level =
    target > level ? target : level * FALL_SMOOTHING + target * (1 - FALL_SMOOTHING);

  const message: Message = { type: 'VU_LEVEL', tabId, level };
  void chrome.runtime.sendMessage(message);
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return;

  switch (parsed.data.type) {
    case 'OFFSCREEN_START':
      start(parsed.data.streamId, parsed.data.tabId).catch((error: unknown) => {
        console.error('Breathe offscreen: capture failed', error);
        sendDiag('offscreen-start-failed', { message: String(error) });
      });
      return;
    case 'OFFSCREEN_STOP':
      void stop();
      return;
    case 'OFFSCREEN_PING': {
      // Watchdog health probe: alive AND holding a live capture track.
      const reply: PingReply = {
        capturing: stream !== null && stream.getAudioTracks()[0]?.readyState === 'live',
      };
      sendResponse(reply);
      return;
    }
  }
});
