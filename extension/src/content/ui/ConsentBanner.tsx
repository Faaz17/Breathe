import type { NotifyResult } from '../notifyChat';

interface ConsentBannerProps {
  notifyState: 'idle' | 'pending' | NotifyResult;
  onNotify: () => void;
  onDismiss: () => void;
}

function NotifyNote({ state }: { state: ConsentBannerProps['notifyState'] }) {
  if (state === 'sent') {
    return <span className="text-emerald-300">Posted a heads-up in the meeting chat.</span>;
  }
  if (state === 'copied') {
    return <span className="text-emerald-300">Disclosure copied — paste it into the chat.</span>;
  }
  if (state === 'failed') {
    return <span className="text-amber-200">Couldn&rsquo;t post or copy — share it manually.</span>;
  }
  return null;
}

/**
 * First-run consent notice, shown once per meeting URL. Amber (not red) per the
 * design rules: this is an informational prompt, not an error. Offers a one-click
 * way to disclose note-taking to the room, and a dismiss that sticks for this call.
 */
export function ConsentBanner({ notifyState, onNotify, onDismiss }: ConsentBannerProps) {
  const note = <NotifyNote state={notifyState} />;
  return (
    <section
      aria-label="Recording notice"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-100"
    >
      <p>
        Breathe transcribes this meeting&rsquo;s audio — and, if you&rsquo;ve enabled it, your
        microphone — locally for note-taking. Please make sure participants are informed if
        your local laws require it.
      </p>
      {note && <p>{note}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNotify}
          disabled={notifyState === 'pending'}
          className="rounded-md bg-amber-500 px-2.5 py-1 font-medium text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-60"
        >
          {notifyState === 'pending' ? 'Notifying…' : 'Notify chat'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2.5 py-1 font-medium text-amber-200 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Got it
        </button>
      </div>
    </section>
  );
}
