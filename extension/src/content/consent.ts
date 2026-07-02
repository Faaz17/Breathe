/**
 * Per-meeting consent banner state. The banner is shown once per meeting URL (not
 * per recording session) and "sticks" across SPA navigations within the same
 * meeting — so the key is the host + pathname only, dropping query/hash which
 * Gmeet mutates as the call progresses.
 *
 * Dismissal lives in chrome.storage.local (content scripts can read/write it),
 * keyed by the meeting so a returning participant isn't re-prompted.
 */
const KEY_PREFIX = 'consent-dismissed:';

function meetingKey(): string {
  const url = new URL(location.href);
  return `${KEY_PREFIX}${url.host}${url.pathname}`;
}

export async function isConsentDismissed(): Promise<boolean> {
  const key = meetingKey();
  const stored = await chrome.storage.local.get(key);
  return stored[key] === true;
}

export async function dismissConsent(): Promise<void> {
  await chrome.storage.local.set({ [meetingKey()]: true });
}
