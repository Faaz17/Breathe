const SCRIPT_ID = 'breathe-content';

const MEETING_MATCHES = [
  '*://meet.google.com/*',
  '*://*.zoom.us/wc/*',
  '*://*.webex.com/*',
];

/**
 * Registers the self-contained content script (content.js, built by
 * vite.content.config.ts) as a CLASSIC content script. Classic content scripts
 * run in the isolated world and are exempt from the meeting page's strict CSP —
 * which blocks the dynamic-import loader crxjs would otherwise use.
 */
async function syncContentScript(): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // Not registered yet (first run) — nothing to remove.
  }

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: MEETING_MATCHES,
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: false,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  void syncContentScript();
});

chrome.runtime.onStartup.addListener(() => {
  void syncContentScript();
});
