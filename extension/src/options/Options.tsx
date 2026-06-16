import { useEffect, useState } from 'react';

import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../lib/db';

const GROQ_ORIGIN = 'https://api.groq.com/*';

const MODELS = [
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant — fast (default)' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile — higher quality' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'permission-denied' | 'error';

export function Options() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_SETTINGS.model);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Load the singleton settings row once on mount.
  useEffect(() => {
    let active = true;
    void getSettings().then((settings) => {
      if (!active) return;
      setApiKey(settings.groqApiKey);
      setModel(settings.model);
    });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    setSaveState('saving');
    try {
      await saveSettings({ groqApiKey: apiKey.trim(), model });
      // Summaries fetch api.groq.com from the service worker, which needs the
      // optional host permission — requestable only from a user gesture (this click).
      const granted = await chrome.permissions.request({ origins: [GROQ_ORIGIN] });
      setSaveState(granted ? 'saved' : 'permission-denied');
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
  if (state === 'error') {
    return <span role="status" className="text-sm text-amber-400">Couldn&rsquo;t save. Try again.</span>;
  }
  return null;
}
