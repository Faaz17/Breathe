import { useEffect, useRef } from 'react';

import type { SttState } from '../../lib/messages';

interface TranscriptProps {
  text: string;
  status: SttState | 'idle';
  progress: number;
  message: string;
  recording: boolean;
}

export function Transcript({ text, status, progress, message, recording }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest text in view. Appends only — no per-chunk animation, which
  // would induce nausea on long meetings (design_rules.md).
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {status !== 'ready' && recording && (
        <StatusLine status={status} progress={progress} message={message} />
      )}
      {status === 'ready' && recording && message && (
        <p role="status" className="text-xs break-words text-zinc-600">
          Transcribing · {message}
        </p>
      )}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Live transcript"
        className="max-h-64 min-h-24 overflow-y-auto rounded-lg bg-zinc-900 p-2 text-sm leading-relaxed text-zinc-200"
      >
        {text || <span className="text-zinc-500">{recording ? 'Listening…' : 'No transcript yet.'}</span>}
      </div>
    </div>
  );
}

function StatusLine({
  status,
  progress,
  message,
}: {
  status: SttState | 'idle';
  progress: number;
  message: string;
}) {
  if (status === 'error') {
    return (
      <p role="status" className="text-xs leading-relaxed text-amber-400">
        Transcription model failed to load.
        {message && <span className="mt-0.5 block break-words text-zinc-500">{message}</span>}
      </p>
    );
  }
  if (status === 'loading') {
    return (
      <p role="status" className="text-xs text-zinc-400">
        {progress >= 100
          ? 'Preparing transcription model…'
          : `Loading transcription model… ${progress}%`}
      </p>
    );
  }
  return (
    <p role="status" className="text-xs text-zinc-500">
      Preparing transcription…
    </p>
  );
}
