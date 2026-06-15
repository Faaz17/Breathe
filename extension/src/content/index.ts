import { detectMeeting } from '../lib/meeting';
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

watchSpaNavigation(sync);

window.addEventListener('pagehide', () => {
  panel?.unmount();
  panel = null;
});

sync();
