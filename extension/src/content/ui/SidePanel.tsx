interface SidePanelProps {
  recording: boolean;
  onToggleRecording: () => void;
  onCollapse: () => void;
}

export function SidePanel({
  recording,
  onToggleRecording,
  onCollapse,
}: SidePanelProps) {
  return (
    <section
      aria-label="Breathe meeting notes"
      className="breathe-animate-in m-3 flex w-80 flex-col gap-3 rounded-2xl bg-zinc-950 p-3 font-sans text-zinc-50 shadow-2xl ring-1 ring-zinc-800"
    >
      <header className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold tracking-tight">Breathe</span>
        <div className="flex-1" />
        {recording && (
          <span
            role="status"
            aria-label="Recording"
            className="flex items-center gap-1 text-xs text-emerald-400"
          >
            <span
              className="h-2 w-2 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            Recording
          </span>
        )}
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse panel"
          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
            <line
              x1="3"
              y1="8"
              x2="13"
              y2="8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <button
        type="button"
        onClick={onToggleRecording}
        className={
          recording
            ? 'w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400'
            : 'w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300'
        }
      >
        {recording ? 'Stop' : 'Start recording'}
      </button>

      <p className="text-xs leading-relaxed text-zinc-500">
        {recording
          ? 'Audio capture & live transcript arrive in Phase 2.'
          : 'Press Start to begin. Nothing records until you do.'}
      </p>

      <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
        <button
          type="button"
          disabled
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-zinc-600 disabled:cursor-not-allowed"
        >
          Summarise
        </button>
        <span className="font-mono text-xs text-zinc-500">00:00:00</span>
      </div>
    </section>
  );
}
