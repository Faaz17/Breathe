import { Message } from '../lib/messages';
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
      capture.setRecording(parsed.data.recording);
      return;
  }
});

watchSpaNavigation(sync);

window.addEventListener('pagehide', () => {
  panel?.unmount();
  panel = null;
});

sync();
