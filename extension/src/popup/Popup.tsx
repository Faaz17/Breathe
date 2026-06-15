import { useEffect, useState } from 'react';

import { detectMeeting } from '../lib/meeting';
import { Ack, Message, RecordingState } from '../lib/messages';

type PopupState =
  | { kind: 'loading' }
  | { kind: 'no-meeting' }
  | { kind: 'ready'; tabId: number; recording: boolean }
  | { kind: 'error'; message: string };

async function loadState(): Promise<PopupState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !detectMeeting(new URL(tab.url))) {
    return { kind: 'no-meeting' };
  }

  const query: Message = { type: 'GET_STATE', tabId: tab.id };
  const response = await chrome.runtime.sendMessage(query);
  const parsed = RecordingState.safeParse(response);
  return {
    kind: 'ready',
    tabId: tab.id,
    recording: parsed.success && parsed.data.recording,
  };
}

export function Popup() {
  const [state, setState] = useState<PopupState>({ kind: 'loading' });

  // One-shot lifecycle query when the popup opens.
  useEffect(() => {
    void loadState().then(setState);
  }, []);

  async function start(tabId: number): Promise<void> {
    const message: Message = { type: 'START_RECORDING', tabId };
    const ack = Ack.safeParse(await chrome.runtime.sendMessage(message));
    if (ack.success && ack.data.ok) {
      window.close();
    } else {
      setState({
        kind: 'error',
        message: 'Could not start capture. Reload the meeting tab and try again.',
      });
    }
  }

  async function stop(): Promise<void> {
    const message: Message = { type: 'STOP_RECORDING' };
    await chrome.runtime.sendMessage(message);
    window.close();
  }

  return (
    <main className="flex w-72 flex-col gap-3 bg-zinc-950 p-5 font-sans text-zinc-50">
      <header className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
        <h1 className="text-base font-semibold tracking-tight">Breathe</h1>
      </header>

      {state.kind === 'loading' && (
        <p className="text-sm text-zinc-400">Checking this tab…</p>
      )}

      {state.kind === 'no-meeting' && (
        <p className="text-sm leading-relaxed text-zinc-400">
          Open a Google Meet or Zoom meeting tab to start taking notes.
        </p>
      )}

      {state.kind === 'error' && (
        <p className="text-sm leading-relaxed text-amber-400">{state.message}</p>
      )}

      {state.kind === 'ready' && !state.recording && (
        <>
          <button
            type="button"
            onClick={() => void start(state.tabId)}
            className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Start recording
          </button>
          <p className="text-xs leading-relaxed text-zinc-500">
            Captures this tab&rsquo;s audio locally. Nothing leaves your machine.
          </p>
        </>
      )}

      {state.kind === 'ready' && state.recording && (
        <>
          <button
            type="button"
            onClick={() => void stop()}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Stop recording
          </button>
          <span
            role="status"
            className="flex items-center gap-1 self-start text-xs text-emerald-400"
          >
            <span
              className="h-2 w-2 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            Recording this tab
          </span>
        </>
      )}
    </main>
  );
}
