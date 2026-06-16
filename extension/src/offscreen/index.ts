import { Message, type SttState } from '../lib/messages';
import { transcriber } from './transcriber';

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

async function start(streamId: string, targetTabId: number): Promise<void> {
  await stop();
  tabId = targetTabId;

  const constraints: TabCaptureConstraints = {
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  };
  stream = await navigator.mediaDevices.getUserMedia(
    constraints as unknown as MediaStreamConstraints,
  );

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);
  // Play the captured audio back. This is the offscreen document, NOT the captured
  // meeting tab, so playback is audible and never re-captured (no feedback).
  source.connect(audioContext.destination);

  buffer = new Uint8Array(analyser.fftSize);
  timerId = setInterval(measure, MEASURE_INTERVAL_MS);

  startTranscription(stream, targetTabId);
}

/**
 * Taps raw 16 kHz PCM off the captured stream and feeds it to the local Whisper
 * transcriber. The ScriptProcessor outputs silence (we never fill its output
 * buffer) but must be connected to the destination to keep pulling input.
 */
function startTranscription(source: MediaStream, targetTabId: number): void {
  sttContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  const sttSource = sttContext.createMediaStreamSource(source);
  sttProcessor = sttContext.createScriptProcessor(STT_BUFFER_SIZE, 1, 1);
  sttSource.connect(sttProcessor);
  sttProcessor.connect(sttContext.destination);

  sttProcessor.onaudioprocess = (event) => {
    transcriber.push(event.inputBuffer.getChannelData(0));
  };

  transcriber.start({
    onText: (text) => sendTranscript(targetTabId, text),
    onStatus: (state, progress, message) => sendStatus(targetTabId, state, progress, message),
  });
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
  const payload: Message = {
    type: 'TRANSCRIBE_STATUS',
    tabId: targetTabId,
    state,
    progress,
    message,
  };
  void chrome.runtime.sendMessage(payload);
}

async function stop(): Promise<void> {
  if (timerId !== null) clearInterval(timerId);
  transcriber.stop();
  if (sttProcessor) sttProcessor.onaudioprocess = null;
  sttProcessor?.disconnect();
  if (sttContext) await sttContext.close();
  stream?.getTracks().forEach((track) => track.stop());
  if (audioContext) await audioContext.close();

  timerId = null;
  sttProcessor = null;
  sttContext = null;
  stream = null;
  audioContext = null;
  analyser = null;
  buffer = null;
  level = 0;
  tabId = null;
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

chrome.runtime.onMessage.addListener((raw) => {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return;

  switch (parsed.data.type) {
    case 'OFFSCREEN_START':
      start(parsed.data.streamId, parsed.data.tabId).catch((error: unknown) => {
        console.error('Breathe offscreen: capture failed', error);
      });
      return;
    case 'OFFSCREEN_STOP':
      void stop();
      return;
  }
});
