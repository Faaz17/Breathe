import { useEffect, useState } from 'react';

import { getAllSessions, type Session } from '../lib/db';
import { formatStarted } from '../lib/export';
import { detectMeeting } from '../lib/meeting';
import { Ack, Message, RecordingState } from '../lib/messages';

const RECENT_LIMIT = 5;

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

function openHistory(id?: string): void {
  const base = chrome.runtime.getURL('src/history/index.html');
  void chrome.tabs.create({ url: id ? `${base}?id=${id}` : base });
  window.close();
}

export function Popup() {
  const [state, setState] = useState<PopupState>({ kind: 'loading' });
  const [recent, setRecent] = useState<Session[] | null>(null);

  // One-shot lifecycle query + recent-notes load when the popup opens.
  useEffect(() => {
    void loadState().then(setState);
    void getAllSessions().then((all) => setRecent(all.slice(0, RECENT_LIMIT)));
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
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
        <h1 className="text-base font-semibold tracking-tight">Breathe</h1>
      </header>

      {state.kind === 'loading' && <p className="text-sm text-zinc-400">Checking this tab…</p>}

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
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Recording this tab
          </span>
        </>
      )}

      <RecentNotes sessions={recent} />

      <footer className="flex items-center justify-between border-t border-zinc-800 pt-3 text-xs">
        <button
          type="button"
          onClick={() => openHistory()}
          className="rounded-md px-1.5 py-1 text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          All notes
        </button>
        <button
          type="button"
          onClick={() => {
            void chrome.runtime.openOptionsPage();
            window.close();
          }}
          className="rounded-md px-1.5 py-1 text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Settings
        </button>
      </footer>
    </main>
  );
}

function RecentNotes({ sessions }: { sessions: Session[] | null }) {
  if (!sessions || sessions.length === 0) return null;
  return (
    <section className="flex flex-col gap-1 border-t border-zinc-800 pt-3" aria-label="Recent notes">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent</h2>
      <ul className="flex flex-col">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => openHistory(session.id)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <span className="line-clamp-1 text-sm text-zinc-100">{session.title}</span>
              <span className="text-xs text-zinc-500">
                {formatStarted(session.startedAt)}
                {session.summary && ' · summarised'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
