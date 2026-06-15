import { Message } from '../lib/messages';

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

let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let buffer: Uint8Array<ArrayBuffer> | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let level = 0;
let tabId: number | null = null;

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
}

async function stop(): Promise<void> {
  if (timerId !== null) clearInterval(timerId);
  stream?.getTracks().forEach((track) => track.stop());
  if (audioContext) await audioContext.close();

  timerId = null;
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
