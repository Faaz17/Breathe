const STEPS = [
  {
    title: 'Open a meeting',
    body: 'Join a Google Meet, Zoom (web), or Webex (web) call in a tab. Breathe wakes up automatically on a meeting URL.',
  },
  {
    title: 'Click the toolbar icon → Start',
    body: 'Nothing records until you press Start. Breathe captures the tab’s audio (plus your mic, if you turn that on in settings) and transcribes it on your machine, live.',
  },
  {
    title: 'Summarise when you’re done',
    body: 'Press Stop, then Summarise to turn the transcript into Decisions, Action Items, and Open Questions. This is the only step that goes online.',
  },
];

const PRIVACY_POINTS = [
  'Transcripts are stored only in this browser (IndexedDB) — never uploaded.',
  'Transcription runs locally in your browser; audio never leaves your machine.',
  'The single outbound request is the Summarise call to Groq, and only when you click it.',
  'Recording is off by default and must be started per meeting.',
];

export function Welcome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 bg-zinc-950 px-6 py-14 font-sans text-zinc-50">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Breathe</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Private meeting notes, on your machine.</h1>
        <p className="text-base leading-relaxed text-zinc-400">
          Breathe transcribes your meetings locally and summarises them on demand — free, and
          without sending your conversations to anyone&rsquo;s servers.
        </p>
      </header>

      <section className="flex flex-col gap-4" aria-label="Getting started">
        <h2 className="text-lg font-semibold tracking-tight">Getting started</h2>
        <ol className="flex flex-col gap-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-400"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-zinc-100">{step.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
        aria-label="Your privacy"
      >
        <h2 className="text-lg font-semibold tracking-tight">Your privacy</h2>
        <ul className="flex flex-col gap-2">
          {PRIVACY_POINTS.map((point) => (
            <li key={point} className="flex gap-2 text-sm leading-relaxed text-zinc-300">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              {point}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-label="Optional setup">
        <h2 className="text-lg font-semibold tracking-tight">Optional: enable summaries</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          Summaries use Groq&rsquo;s free tier. Paste a free API key in settings to turn them on —
          transcription works without it.
        </p>
        <div>
          <button
            type="button"
            onClick={() => void chrome.runtime.openOptionsPage()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Add a Groq key
          </button>
        </div>
      </section>
    </main>
  );
}
