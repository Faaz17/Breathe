import { Fragment, type ReactNode, useEffect, useState } from 'react';

import type { SummaryError } from '../../lib/messages';

type SummaryState = 'idle' | 'loading' | 'done' | 'error';

interface SummaryViewProps {
  state: SummaryState;
  markdown: string;
  error: SummaryError | '';
  onOpenOptions: () => void;
}

export function SummaryView({ state, markdown, error, onOpenOptions }: SummaryViewProps) {
  if (state === 'idle') return null;
  if (state === 'loading') return <SummaryLoading />;
  if (state === 'error') return <SummaryErrorView error={error} onOpenOptions={onOpenOptions} />;

  return (
    <section className="flex flex-col gap-1 border-t border-zinc-800 pt-2" aria-label="Summary">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Summary</h2>
      <div className="max-h-64 overflow-y-auto text-sm leading-relaxed text-zinc-200">
        {renderMarkdown(markdown)}
      </div>
    </section>
  );
}

// Deterministic elapsed-seconds loading state (design_rules.md — no fake spinner).
function SummaryLoading() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <p role="status" className="border-t border-zinc-800 pt-2 text-sm text-zinc-400">
      Summarising… {seconds}s
    </p>
  );
}

const ERROR_COPY: Record<SummaryError, string> = {
  'no-key': 'Add your free Groq API key in settings to enable summaries.',
  permission: 'Breathe needs permission to reach Groq. Open settings to allow it.',
  empty: 'Nothing recorded yet to summarise.',
  auth: 'That Groq API key was rejected — check it in settings.',
  'rate-limit': 'Groq is rate-limiting right now. Try again in a moment.',
  network: 'Couldn’t reach Groq. Check your connection and try again.',
  'bad-response': 'Groq returned an unexpected response. Try again.',
};

function SummaryErrorView({
  error,
  onOpenOptions,
}: {
  error: SummaryError | '';
  onOpenOptions: () => void;
}) {
  const showSettings = error === 'no-key' || error === 'auth' || error === 'permission';
  return (
    <div className="flex flex-col items-start gap-2 border-t border-zinc-800 pt-2">
      <p role="alert" className="text-sm leading-relaxed text-amber-400">
        {error ? ERROR_COPY[error] : 'Summary failed. Try again.'}
      </p>
      {showSettings && (
        <button
          type="button"
          onClick={onOpenOptions}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Open settings
        </button>
      )}
    </div>
  );
}

// Minimal, XSS-safe Markdown → React for the structured summary (headings +
// bullets + **bold**). React escapes all text, so no dangerouslySetInnerHTML.
function renderInline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={index} className="font-semibold text-zinc-100">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function renderMarkdown(markdown: string): ReactNode {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-0.5 marker:text-zinc-600">
        {items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      flushBullets();
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="mt-2 text-sm font-semibold text-zinc-100">
          {renderInline(line.replace(/^#{1,6}\s+/, ''))}
        </h3>,
      );
    } else if (/^[-*]\s/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ''));
    } else if (line === '') {
      flushBullets();
    } else {
      flushBullets();
      blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
    }
  }
  flushBullets();

  return <div className="flex flex-col gap-1">{blocks}</div>;
}
