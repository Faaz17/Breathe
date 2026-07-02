import { Message } from '../lib/messages';
import { detectMeeting } from '../lib/meeting';

/**
 * Watches the meeting page's OWN mute button and reports its state while
 * recording. Breathe's mic capture is an independent OS-level stream — the
 * meeting's mute button doesn't touch it — so without this relay Breathe
 * would keep transcribing the user while they believe they're muted.
 *
 * Like notifyChat, this reads the host page's DOM and is inherently
 * best-effort: platforms A/B-test their markup. Detection failing degrades to
 * "assume live" (current behaviour), never to dropping real speech, and is
 * flagged once in the diag log. The resolved control is cached so the steady
 * state is one attribute read per tick, not a full-document query.
 */

const POLL_INTERVAL_MS = 1_000;

// Google Symbols icon ligatures inside Meet's mic button ("mic" / "mic_off").
// Locale-independent — the aria-label text is translated, the ligature isn't.
const GMEET_MIC_ICON = /\bmic(?:_off)?\b/;
// Host/room controls that also start with mute/unmute ("Mute all",
// "Unmute everyone", "Mute notifications") — never the user's own mic.
const GENERIC_EXCLUDE = /\ball\b|everyone|notification/;

let cachedControl: HTMLElement | null = null;

/** Google Meet: toolbar controls carry data-is-muted; pick the mic one. */
function findGmeetControl(): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('[data-is-muted]')) {
    const label = (
      element.getAttribute('aria-label') ??
      element.getAttribute('data-tooltip') ??
      ''
    ).toLowerCase();
    if (label.includes('microphone')) return element;
    if (GMEET_MIC_ICON.test(element.textContent ?? '')) return element;
  }
  // Fallback on the English button text ("Turn on microphone" ⇒ muted).
  return (
    document.querySelector<HTMLElement>('[aria-label*="turn on microphone" i]') ??
    document.querySelector<HTMLElement>('[aria-label*="turn off microphone" i]')
  );
}

/** Zoom Web / Webex: the user's own control is labelled "Mute…"/"Unmute…". */
function findGenericControl(): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>(
    'button[aria-label], [role="button"][aria-label]',
  );
  for (const button of buttons) {
    const label = (button.getAttribute('aria-label') ?? '').trim().toLowerCase();
    if (!label.startsWith('mute') && !label.startsWith('unmute')) continue;
    if (GENERIC_EXCLUDE.test(label)) continue;
    return button;
  }
  return null;
}

function findControl(): HTMLElement | null {
  const meeting = detectMeeting(new URL(location.href));
  if (!meeting) return null;
  return meeting.platform === 'gmeet' ? findGmeetControl() : findGenericControl();
}

/** Muted state of a resolved control, or null when it no longer reads as one. */
function readControl(control: HTMLElement): boolean | null {
  const isMuted = control.getAttribute('data-is-muted');
  if (isMuted !== null) return isMuted === 'true';
  const label = (control.getAttribute('aria-label') ?? '').trim().toLowerCase();
  if (label.includes('turn on microphone')) return true;
  if (label.includes('turn off microphone')) return false;
  if (label.startsWith('unmute')) return true;
  if (label.startsWith('mute')) return false;
  return null;
}

function readMeetingMicMuted(): boolean | null {
  if (cachedControl?.isConnected) {
    const muted = readControl(cachedControl);
    if (muted !== null) return muted;
  }
  cachedControl = findControl();
  return cachedControl ? readControl(cachedControl) : null;
}

let timerId: ReturnType<typeof setInterval> | null = null;
let lastSent: boolean | null = null;
let reportedUnknown = false;

function send(message: Message): void {
  try {
    void chrome.runtime.sendMessage(message).catch(() => {
      // Service worker between wakes; the next change will retry.
    });
  } catch {
    // Extension context invalidated (Breathe was reloaded while this tab
    // stayed open). The orphaned script can never reach anyone again —
    // stop polling for good instead of throwing every second.
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
  }
}

/** Start/stop the poll with the recording state. Idempotent. */
export function watchMeetingMicState(recording: boolean): void {
  if (recording && timerId === null) {
    lastSent = null; // always report the current state at the start of a session
    reportedUnknown = false;
    const tick = (): void => {
      const reading = readMeetingMicMuted();
      if (reading === null) {
        // Unknown (markup changed / not found) ⇒ assume live so real speech
        // is never silently dropped — but leave a trace, once, for debugging.
        if (!reportedUnknown) {
          reportedUnknown = true;
          send({ type: 'DIAG', event: 'mic-detect-unknown' });
        }
      } else {
        reportedUnknown = false;
      }
      const muted = reading ?? false;
      if (muted === lastSent) return;
      lastSent = muted;
      send({ type: 'MEETING_MIC_STATE', muted });
    };
    tick();
    timerId = setInterval(tick, POLL_INTERVAL_MS);
  } else if (!recording && timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}
