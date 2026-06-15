import { type Ack, Message, type RecordingState } from '../lib/messages';

const SCRIPT_ID = 'breathe-content';
const OFFSCREEN_URL = 'src/offscreen/index.html';

const MEETING_MATCHES = [
  '*://meet.google.com/*',
  '*://*.zoom.us/wc/*',
  '*://*.webex.com/*',
];

let recordingTabId: number | null = null;

/**
 * Registers the self-contained content script (content.js) as a CLASSIC content
 * script — runs in the isolated world, exempt from the meeting page's strict CSP
 * that blocks the dynamic-import loader crxjs would otherwise use.
 */
async function syncContentScript(): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // Not registered yet (first run).
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

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Analyse the captured meeting audio and play it back audibly.',
  });
}

async function startRecording(tabId: number): Promise<void> {
  // Mint a single-use stream id for the meeting tab; consumed by the offscreen doc.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const start: Message = { type: 'OFFSCREEN_START', streamId, tabId };
  await chrome.runtime.sendMessage(start);

  recordingTabId = tabId;
  const recording: Message = { type: 'RECORDING', recording: true };
  void chrome.tabs.sendMessage(tabId, recording);
}

async function stopRecording(tabId: number): Promise<void> {
  const stop: Message = { type: 'OFFSCREEN_STOP' };
  await chrome.runtime.sendMessage(stop);
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();

  recordingTabId = null;
  const recording: Message = { type: 'RECORDING', recording: false };
  void chrome.tabs.sendMessage(tabId, recording);
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) return;
  const message = parsed.data;

  switch (message.type) {
    case 'START_RECORDING':
      startRecording(message.tabId)
        .then(() => {
          const ack: Ack = { ok: true };
          sendResponse(ack);
        })
        .catch((error: unknown) => {
          console.error('Breathe: could not start recording', error);
          const ack: Ack = { ok: false };
          sendResponse(ack);
        });
      return true; // async sendResponse

    case 'STOP_RECORDING': {
      const tabId = sender.tab?.id ?? recordingTabId;
      if (tabId !== null && tabId !== undefined) {
        stopRecording(tabId).catch((error: unknown) => {
          console.error('Breathe: could not stop recording', error);
        });
      }
      return;
    }

    case 'GET_STATE': {
      const state: RecordingState = { recording: recordingTabId === message.tabId };
      sendResponse(state);
      return;
    }

    case 'VU_LEVEL': {
      const vu: Message = { type: 'VU', level: message.level };
      void chrome.tabs.sendMessage(message.tabId, vu);
      return;
    }
  }
});

// If the meeting tab closes while recording, tear capture down.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingTabId === tabId) {
    void stopRecording(tabId).catch(() => {
      // tab already gone; nothing to notify
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void syncContentScript();
});

chrome.runtime.onStartup.addListener(() => {
  void syncContentScript();
});
