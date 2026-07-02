/**
 * "Notify chat" — Breathe posts a short disclosure into the meeting chat itself,
 * so participants know notes are being taken. On Google Meet it drives the chat
 * DOM directly; everywhere else (and whenever the Meet markup has shifted out from
 * under us) it falls back to copying the message so the user can paste it.
 *
 * The Meet path is best-effort by nature: Google reshuffles its chat markup, so the
 * selectors here are deliberately loose and any failure degrades to the clipboard
 * fallback rather than throwing.
 */
export const DISCLOSURE_MESSAGE =
  "Heads-up — I'm using Breathe to take AI-assisted notes on this call. " +
  'It transcribes locally in my browser; the audio is never recorded or uploaded.';

export type NotifyResult = 'sent' | 'copied' | 'failed';

const CHAT_OPEN_TIMEOUT_MS = 3000;
const SEND_ENABLE_TIMEOUT_MS = 1000;
const SEND_CONFIRM_TIMEOUT_MS = 1000;
const POLL_INTERVAL_MS = 100;

/** Resolves with the first element matching `selector`, or null after `timeoutMs`. */
function waitForElement<T extends Element>(selector: string, timeoutMs: number): Promise<T | null> {
  const existing = document.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const found = document.querySelector<T>(selector);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, POLL_INTERVAL_MS);
  });
}

/**
 * Sets the value of a React/Angular-controlled field via the native setter so the
 * framework's change tracking actually sees it, then fires `input` to wake it.
 */
function setControlledValue(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives the Google Meet chat panel: open it, type the message, send. Returns true
 * only when the send is *confirmed* — Meet clears the input after a successful send,
 * so we poll for that. If we can't confirm, the typed text is cleared and we report
 * failure so the caller falls back to the clipboard rather than claiming success.
 */
async function postToGoogleMeet(message: string): Promise<boolean> {
  const inputSelector = 'textarea[aria-label*="Send a message" i]';

  let input = document.querySelector<HTMLTextAreaElement>(inputSelector);
  if (!input) {
    const chatToggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="Chat with everyone" i], button[aria-label*="chat" i]',
    );
    chatToggle?.click();
    input = await waitForElement<HTMLTextAreaElement>(inputSelector, CHAT_OPEN_TIMEOUT_MS);
  }
  if (!input) return false;

  input.focus();
  setControlledValue(input, message);

  // The send button only enables after Meet processes the input event.
  const sendSelector = 'button[aria-label*="Send a message" i]';
  const enableDeadline = Date.now() + SEND_ENABLE_TIMEOUT_MS;
  let sendButton = document.querySelector<HTMLButtonElement>(sendSelector);
  while ((!sendButton || sendButton.disabled) && Date.now() < enableDeadline) {
    await delay(POLL_INTERVAL_MS);
    sendButton = document.querySelector<HTMLButtonElement>(sendSelector);
  }

  if (sendButton && !sendButton.disabled) {
    sendButton.click();
  } else {
    // No usable send button — try Enter, which Meet also accepts.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
    );
  }

  // Confirm: Meet empties the input once the message is actually sent. If it never
  // clears, the send didn't take — wipe our text so we don't strand an unsent line.
  const confirmDeadline = Date.now() + SEND_CONFIRM_TIMEOUT_MS;
  while (Date.now() < confirmDeadline) {
    if (input.value === '') return true;
    await delay(POLL_INTERVAL_MS);
  }
  setControlledValue(input, '');
  return false;
}

/** Copies the disclosure to the clipboard so the user can paste it manually. */
async function copyToClipboard(message: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(message);
    return true;
  } catch {
    return false;
  }
}

/**
 * Posts the disclosure into the meeting chat. Returns 'sent' when Breathe placed it
 * directly, 'copied' when it fell back to the clipboard, or 'failed' if even that
 * was blocked.
 */
export async function notifyChat(): Promise<NotifyResult> {
  if (location.host === 'meet.google.com') {
    try {
      if (await postToGoogleMeet(DISCLOSURE_MESSAGE)) return 'sent';
    } catch {
      // Meet markup shifted; fall through to the clipboard.
    }
  }
  return (await copyToClipboard(DISCLOSURE_MESSAGE)) ? 'copied' : 'failed';
}
