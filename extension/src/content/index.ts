import { Message, RecordingState } from '../lib/messages';
import { detectMeeting } from '../lib/meeting';
import { capture } from './capture';
import { mountPanel, type PanelHandle } from './mount';

let panel: PanelHandle | null = null;

/** Mount the panel when on a meeting URL, unmount when we leave one. Idempotent. */
function sync(): void {
  const meeting = detectMeeting(new URL(location.href));
  if (meeting && !panel) {
    panel = mountPanel();
  } else if (!meeting && panel) {
    panel.unmount();
    panel = null;
  }
}

/**
 * Meeting pages (Gmeet especially) are SPAs that navigate via the History API
 * without a full reload, so a one-shot check at document_idle isn't enough.
 */
function watchSpaNavigation(onChange: () => void): void {
  const wrap =
    (original: History['pushState']): History['pushState'] =>
    function (this: History, ...args) {
      const result = original.apply(this, args);
      onChange();
      return result;
    };

  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener('popstate', onChange);
}

// The service worker relays the live level and recording flag from the offscreen
// document; the panel renders them.
chrome.runtime.onMessage.addListener((raw) => {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return;

  switch (parsed.data.type) {
    case 'VU':
      capture.setLevel(parsed.data.level);
      return;
    case 'RECORDING':
      capture.setRecording(parsed.data.recording, parsed.data.reason ?? '');
      return;
    case 'TRANSCRIPT':
      capture.appendTranscript(parsed.data.text);
      return;
    case 'STT_STATUS':
      capture.setSttStatus(parsed.data.state, parsed.data.progress, parsed.data.message);
      return;
    case 'SUMMARY_STATUS':
      capture.setSummaryStatus(
        parsed.data.state,
        parsed.data.markdown ?? '',
        parsed.data.error ?? '',
      );
      return;
  }
});

/**
 * A freshly (re)mounted panel knows nothing — if this tab is mid-recording
 * (Meet reloaded the page) or just finished a session, pull the state from the
 * service worker so the panel shows the live transcript and Summarise works.
 */
function hydrateFromBackground(): void {
  const message: Message = { type: 'GET_STATE' };
  chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      const parsed = RecordingState.safeParse(raw);
      if (!parsed.success) return;
      capture.hydrate(
        parsed.data.recording,
        parsed.data.transcript ?? '',
        parsed.data.summary ?? '',
      );
    })
    .catch(() => {
      // Service worker unavailable; live messages will catch the panel up.
    });
}

watchSpaNavigation(sync);

window.addEventListener('pagehide', () => {
  panel?.unmount();
  panel = null;
});

sync();
hydrateFromBackground();
