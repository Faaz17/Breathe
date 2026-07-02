import type { StopReason, SttState, SummaryError } from '../../lib/messages';
import type { NotifyResult } from '../notifyChat';
import { ConsentBanner } from './ConsentBanner';
import { Transcript } from './Transcript';
import { SummaryView } from './SummaryView';
import { VuMeter } from './VuMeter';

interface SidePanelProps {
  recording: boolean;
  stopReason: StopReason | '';
  transcript: string;
  sttState: SttState | 'idle';
  sttProgress: number;
  sttMessage: string;
  summaryState: 'idle' | 'loading' | 'done' | 'error';
  summaryMarkdown: string;
  summaryError: SummaryError | '';
  showConsent: boolean;
  notifyState: 'idle' | 'pending' | NotifyResult;
  onNotify: () => void;
  onDismissConsent: () => void;
  onStop: () => void;
  onCollapse: () => void;
  onSummarise: () => void;
  onOpenOptions: () => void;
}

export function SidePanel({
  recording,
  stopReason,
  transcript,
  sttState,
  sttProgress,
  sttMessage,
  summaryState,
  summaryMarkdown,
  summaryError,
  showConsent,
  notifyState,
  onNotify,
  onDismissConsent,
  onStop,
  onCollapse,
  onSummarise,
  onOpenOptions,
}: SidePanelProps) {
  // Only after Stop (per the design): summarising a still-growing transcript would
  // spend a Groq call on partial, immediately-stale notes.
  const canSummarise = !recording && transcript.trim() !== '' && summaryState !== 'loading';
  // Only unexpected stops warrant a notice — user stops and tab teardowns don't.
  const interrupted =
    !recording && (stopReason === 'capture-lost' || stopReason === 'error');
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

      {showConsent && (
        <ConsentBanner
          notifyState={notifyState}
          onNotify={onNotify}
          onDismiss={onDismissConsent}
        />
      )}

      {interrupted && (
        <p
          role="status"
          className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-400 ring-1 ring-amber-500/30"
        >
          Recording was interrupted — click the Breathe icon in the toolbar to
          start again. Your notes so far are saved and will continue in the
          same session.
        </p>
      )}

      {recording && (
        <>
          <VuMeter />
          <button
            type="button"
            onClick={onStop}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Stop
          </button>
        </>
      )}

      {recording || transcript ? (
        <Transcript
          text={transcript}
          status={sttState}
          progress={sttProgress}
          message={sttMessage}
          recording={recording}
        />
      ) : (
        <p className="text-sm leading-relaxed text-zinc-400">
          Click the Breathe toolbar icon to start recording. Nothing records
          until you do.
        </p>
      )}

      <SummaryView
        state={summaryState}
        markdown={summaryMarkdown}
        error={summaryError}
        onOpenOptions={onOpenOptions}
      />

      <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
        <button
          type="button"
          onClick={onSummarise}
          disabled={!canSummarise}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600"
        >
          {summaryState === 'loading' ? 'Summarising…' : 'Summarise'}
        </button>
        <span className="font-mono text-xs text-zinc-500">00:00:00</span>
      </div>
    </section>
  );
}
