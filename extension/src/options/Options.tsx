import { useEffect, useState } from 'react';

import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  TRANSCRIPTION_MODELS,
  type Settings,
} from '../lib/db';

const GROQ_ORIGIN = 'https://api.groq.com/*';

const MODELS = [
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant — fast (default)' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile — higher quality' },
];

const TRANSCRIPTION_MODEL_OPTIONS: { id: Settings['transcriptionModel']; label: string }[] = [
  {
    id: 'Xenova/whisper-small.en',
    label: 'Whisper Small (English) — best accuracy, ~970 MB one-time download',
  },
  {
    id: 'Xenova/whisper-base.en',
    label: 'Whisper Base (English) — lighter, ~290 MB download',
  },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'permission-denied' | 'mic-denied' | 'error';

type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

export function Options() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_SETTINGS.model);
  const [transcriptionModel, setTranscriptionModel] = useState<Settings['transcriptionModel']>(
    DEFAULT_SETTINGS.transcriptionModel,
  );
  const [captureMic, setCaptureMic] = useState(DEFAULT_SETTINGS.captureMicrophone);
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown');
  const [retentionDays, setRetentionDays] = useState(String(DEFAULT_SETTINGS.retentionDays));
  const [autoSummarise, setAutoSummarise] = useState(DEFAULT_SETTINGS.autoSummariseOnStop);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Load the singleton settings row once on mount.
  useEffect(() => {
    let active = true;
    void getSettings().then((settings) => {
      if (!active) return;
      setApiKey(settings.groqApiKey);
      setModel(settings.model);
      setTranscriptionModel(settings.transcriptionModel);
      setCaptureMic(settings.captureMicrophone);
      setRetentionDays(String(settings.retentionDays));
      setAutoSummarise(settings.autoSummariseOnStop);
    });
    // Track the extension's mic permission live (updates if the user flips the
    // address-bar padlock setting while this page is open).
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (!active) return;
        setMicPermission(status.state);
        status.onchange = () => setMicPermission(status.state);
      })
      .catch(() => {
        if (active) setMicPermission('unknown');
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * The offscreen document that records meetings cannot show a permission
   * prompt — the grant must happen on a visible page like this one. We only
   * want the grant, not the stream, so tracks stop immediately.
   */
  async function requestMicAccess(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission('granted');
      return true;
    } catch {
      setMicPermission('denied');
      return false;
    }
  }

  function handleMicToggle(checked: boolean): void {
    setCaptureMic(checked);
    setSaveState('idle');
    if (checked && micPermission !== 'granted') void requestMicAccess();
  }

  async function save(): Promise<void> {
    setSaveState('saving');
    const days = Math.max(
      MIN_RETENTION_DAYS,
      Math.min(MAX_RETENTION_DAYS, Math.round(Number(retentionDays) || DEFAULT_SETTINGS.retentionDays)),
    );
    setRetentionDays(String(days)); // reflect any clamping back into the field
    try {
      await saveSettings({
        groqApiKey: apiKey.trim(),
        model,
        transcriptionModel,
        captureMicrophone: captureMic,
        retentionDays: days,
        autoSummariseOnStop: autoSummarise,
      });
      const micOk = !captureMic || micPermission === 'granted' || (await requestMicAccess());
      // Summaries fetch api.groq.com from the service worker, which needs the
      // optional host permission — requestable only from a user gesture (this click).
      const granted = await chrome.permissions.request({ origins: [GROQ_ORIGIN] });
      setSaveState(granted ? (micOk ? 'saved' : 'mic-denied') : 'permission-denied');
    } catch {
      setSaveState('error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 bg-zinc-950 px-6 py-10 font-sans text-zinc-50">
      <header className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight">Breathe settings</h1>
      </header>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="groq-key" className="text-sm font-medium text-zinc-200">
            Groq API key
          </label>
          <input
            id="groq-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setSaveState('idle');
            }}
            placeholder="gsk_…"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          />
          <p className="text-xs leading-relaxed text-zinc-500">
            Stored locally in your browser, never bundled or sent anywhere except Groq when
            you click Summarise. Get a free key at{' '}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 underline underline-offset-2"
            >
              console.groq.com/keys
            </a>
            .
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="groq-model" className="text-sm font-medium text-zinc-200">
            Summary model
          </label>
          <select
            id="groq-model"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setSaveState('idle');
            }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="transcription-model" className="text-sm font-medium text-zinc-200">
            Transcription model
          </label>
          <select
            id="transcription-model"
            value={transcriptionModel}
            onChange={(event) => {
              const next = TRANSCRIPTION_MODELS.find((id) => id === event.target.value);
              if (next) setTranscriptionModel(next);
              setSaveState('idle');
            }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs leading-relaxed text-zinc-500">
            Runs entirely on your machine — nothing is uploaded. Small needs your GPU; on
            CPU-only machines Breathe automatically uses Base instead. Downloads once, then
            works offline. Takes effect the next time you start recording.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-sm font-medium text-zinc-200">
            <input
              type="checkbox"
              checked={captureMic}
              onChange={(event) => handleMicToggle(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            />
            Also transcribe my microphone
          </label>
          {captureMic && <MicPermissionNote permission={micPermission} />}
          <p className="text-xs leading-relaxed text-zinc-500">
            Tab capture only hears the other participants — turn this on so your own voice
            makes it into the notes. Your mic is transcribed locally, exactly like the rest,
            and never recorded or uploaded. If access is missing during a meeting, Breathe
            records the others and shows &ldquo;mic off&rdquo;.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="retention-days" className="text-sm font-medium text-zinc-200">
            Keep notes for
          </label>
          <div className="flex items-center gap-2">
            <input
              id="retention-days"
              type="number"
              min={MIN_RETENTION_DAYS}
              max={MAX_RETENTION_DAYS}
              value={retentionDays}
              onChange={(event) => {
                setRetentionDays(event.target.value);
                setSaveState('idle');
              }}
              className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            />
            <span className="text-sm text-zinc-400">days</span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">
            Sessions older than this are removed automatically when the extension starts. Default 30.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-sm font-medium text-zinc-200">
            <input
              type="checkbox"
              checked={autoSummarise}
              onChange={(event) => {
                setAutoSummarise(event.target.checked);
                setSaveState('idle');
              }}
              className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            />
            Summarise automatically when I stop recording
          </label>
          <p className="text-xs leading-relaxed text-zinc-500">
            Off by default — summarising stays a deliberate action. When on, stopping a recording makes
            one Groq call (needs your API key) to generate notes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveState === 'saving'}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-60"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          <StatusNote state={saveState} />
        </div>
      </form>
    </main>
  );
}

function StatusNote({ state }: { state: SaveState }) {
  if (state === 'saved') {
    return <span role="status" className="text-sm text-emerald-400">Saved — summaries enabled.</span>;
  }
  if (state === 'permission-denied') {
    return (
      <span role="status" className="text-sm text-amber-400">
        Saved, but Groq access was denied — summaries won&rsquo;t work until you allow it.
      </span>
    );
  }
  if (state === 'mic-denied') {
    return (
      <span role="status" className="text-sm text-amber-400">
        Saved — but microphone access is blocked, so meetings will transcribe other
        participants only.
      </span>
    );
  }
  if (state === 'error') {
    return <span role="status" className="text-sm text-amber-400">Couldn&rsquo;t save. Try again.</span>;
  }
  return null;
}

function MicPermissionNote({ permission }: { permission: MicPermission }) {
  if (permission === 'granted') {
    return (
      <p role="status" className="text-xs text-emerald-400">
        Microphone access allowed.
      </p>
    );
  }
  if (permission === 'denied') {
    return (
      <p role="status" className="text-xs leading-relaxed text-amber-400">
        Microphone access is blocked for Breathe. Click the mic icon in this page&rsquo;s
        address bar (or Chrome Settings → Privacy → Microphone) to allow it, then toggle
        again.
      </p>
    );
  }
  return (
    <p role="status" className="text-xs text-zinc-500">
      Chrome will ask for microphone access when you enable this.
    </p>
  );
}
