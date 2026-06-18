import { useEffect, useState } from 'react';

import { deleteSession, getAllSessions, type Session } from '../lib/db';
import {
  PLATFORM_LABELS,
  formatDuration,
  formatStarted,
  sessionFilename,
  sessionToMarkdown,
} from '../lib/export';
import { renderMarkdown } from '../lib/markdown';

type MobileView = 'list' | 'detail';

export function History() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>('list');

  useEffect(() => {
    let active = true;
    void getAllSessions().then((all) => {
      if (!active) return;
      setSessions(all);
      const requested = new URLSearchParams(location.search).get('id');
      setSelectedId(requested && all.some((s) => s.id === requested) ? requested : (all[0]?.id ?? null));
    });
    return () => {
      active = false;
    };
  }, []);

  function select(id: string) {
    setSelectedId(id);
    setMobileView('detail');
  }

  async function handleDelete(session: Session) {
    await deleteSession(session.id);
    const remaining = (sessions ?? []).filter((s) => s.id !== session.id);
    setSessions(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setMobileView('list');
  }

  const selected = sessions?.find((s) => s.id === selectedId) ?? null;

  return (
    <main className="flex h-screen flex-col bg-zinc-950 font-sans text-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <h1 className="text-base font-semibold tracking-tight">Breathe — Notes</h1>
        </div>
        <button
          type="button"
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Settings
        </button>
      </header>

      {sessions === null ? (
        <p className="p-5 text-sm text-zinc-400">Loading…</p>
      ) : sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <aside
            className={`${mobileView === 'list' ? 'flex' : 'hidden'} w-full flex-col overflow-y-auto border-zinc-800 md:flex md:w-72 md:border-r`}
          >
            <ul>
              {sessions.map((session) => (
                <li key={session.id}>
                  <SessionRow
                    session={session}
                    selected={session.id === selectedId}
                    onSelect={() => select(session.id)}
                  />
                </li>
              ))}
            </ul>
          </aside>

          <section
            className={`${mobileView === 'detail' ? 'flex' : 'hidden'} flex-1 flex-col overflow-y-auto md:flex`}
          >
            {selected && (
              <SessionDetail
                session={selected}
                onBack={() => setMobileView('list')}
                onDelete={() => void handleDelete(selected)}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-5 text-center">
      <p className="text-sm text-zinc-300">No notes yet.</p>
      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
        Open a meeting, click the Breathe icon, and start recording. Your sessions will appear here.
      </p>
    </div>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full flex-col items-start gap-0.5 border-b border-zinc-900 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${
        selected ? 'bg-zinc-900' : 'hover:bg-zinc-900/50'
      }`}
    >
      <span className="line-clamp-1 text-sm font-medium text-zinc-100">{session.title}</span>
      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
        {formatStarted(session.startedAt)}
        {session.summary && <span className="text-emerald-500">· summarised</span>}
      </span>
    </button>
  );
}

function SessionDetail({
  session,
  onBack,
  onDelete,
}: {
  session: Session;
  onBack: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  // Reset the delete confirmation whenever the viewed session changes.
  useEffect(() => {
    setConfirming(false);
  }, [session.id]);

  function exportMarkdown() {
    const blob = new Blob([sessionToMarkdown(session)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sessionFilename(session);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <article className="flex flex-col gap-4 p-5">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 md:hidden"
      >
        ‹ All notes
      </button>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{session.title}</h2>
        <p className="text-xs text-zinc-500">
          {PLATFORM_LABELS[session.platform]} · {formatStarted(session.startedAt)} ·{' '}
          {formatDuration(session.startedAt, session.endedAt)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={exportMarkdown}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          Export as Markdown
        </button>
        {confirming ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Delete
          </button>
        )}
      </div>

      <section className="flex flex-col gap-1" aria-label="Summary">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Summary</h3>
        {session.summary ? (
          <div className="text-sm leading-relaxed text-zinc-200">{renderMarkdown(session.summary)}</div>
        ) : (
          <p className="text-sm text-zinc-500">Not summarised.</p>
        )}
      </section>

      <section className="flex flex-col gap-1" aria-label="Transcript">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Transcript</h3>
        {session.transcript.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{session.transcript}</p>
        ) : (
          <p className="text-sm text-zinc-500">No transcript recorded.</p>
        )}
      </section>
    </article>
  );
}
