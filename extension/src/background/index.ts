import { type Ack, Message, type RecordingState } from '../lib/messages';
import {
  appendTranscript,
  createSession,
  finalizeSession,
  getAllSessions,
  getSession,
  getSettings,
  pruneOldSessions,
  saveSummary,
  type Session,
} from '../lib/db';
import { detectMeeting, type Platform } from '../lib/meeting';
import { summarise } from '../lib/groq';

const GROQ_ORIGIN = 'https://api.groq.com/*';

const SCRIPT_ID = 'breathe-content';
const OFFSCREEN_URL = 'src/offscreen/index.html';

const MEETING_MATCHES = [
  '*://meet.google.com/*',
  '*://*.zoom.us/wc/*',
  '*://*.webex.com/*',
];

const PLATFORM_LABEL: Record<Platform, string> = {
  gmeet: 'Google Meet',
  zoom: 'Zoom',
  webex: 'Webex',
};

let recordingTabId: number | null = null;

/**
 * The active recording's session id is persisted in chrome.storage.session so it
 * survives the service worker sleeping mid-meeting — transcript chunks arrive as
 * messages that wake the worker, and it needs to know which session to append to.
 */
interface ActiveSession {
  tabId: number;
  sessionId: string;
}

async function getActiveSession(): Promise<ActiveSession | null> {
  const { active } = await chrome.storage.session.get('active');
  if (
    active &&
    typeof active === 'object' &&
    typeof (active as ActiveSession).tabId === 'number' &&
    typeof (active as ActiveSession).sessionId === 'string'
  ) {
    return active as ActiveSession;
  }
  return null;
}

async function setActiveSession(active: ActiveSession | null): Promise<void> {
  if (active) {
    await chrome.storage.session.set({ active });
  } else {
    await chrome.storage.session.remove('active');
  }
}

/**
 * Last session recorded per tab — unlike `active`, NOT cleared on stop, so a tab
 * can summarise its own just-finished session even after another tab records.
 */
async function setLastSessionForTab(tabId: number, sessionId: string): Promise<void> {
  const { lastByTab } = await chrome.storage.session.get('lastByTab');
  const map = lastByTab && typeof lastByTab === 'object' ? { ...lastByTab } : {};
  (map as Record<string, string>)[String(tabId)] = sessionId;
  await chrome.storage.session.set({ lastByTab: map });
}

async function getLastSessionForTab(tabId: number): Promise<string | null> {
  const { lastByTab } = await chrome.storage.session.get('lastByTab');
  const id =
    lastByTab && typeof lastByTab === 'object'
      ? (lastByTab as Record<string, string>)[String(tabId)]
      : undefined;
  return typeof id === 'string' ? id : null;
}

/**
 * Relay a message to a tab, swallowing the "Receiving end does not exist"
 * rejection that occurs when the panel was torn down (navigation, tab close,
 * SPA route change) — common for the long-latency summarise relay.
 */
function relayToTab(tabId: number, message: Message): void {
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Panel/tab is gone; any durable result is already in IndexedDB.
  });
}

// Guards against a double-click firing two concurrent (billable) Groq calls.
let summarising = false;

function defaultTitle(platform: Platform, startedAt: number): string {
  const when = new Date(startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${PLATFORM_LABEL[platform]} — ${when}`;
}

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

  const tab = await chrome.tabs.get(tabId);
  const meeting = tab.url ? detectMeeting(new URL(tab.url)) : null;
  const platform: Platform = meeting?.platform ?? 'gmeet';
  const startedAt = Date.now();
  const session = await createSession({
    platform,
    meetingUrl: meeting?.meetingUrl ?? tab.url ?? '',
    title: defaultTitle(platform, startedAt),
    startedAt,
  });

  await ensureOffscreen();
  const start: Message = { type: 'OFFSCREEN_START', streamId, tabId };
  await chrome.runtime.sendMessage(start);

  recordingTabId = tabId;
  await setActiveSession({ tabId, sessionId: session.id });
  await setLastSessionForTab(tabId, session.id);
  relayToTab(tabId, { type: 'RECORDING', recording: true });
}

async function stopRecording(tabId: number): Promise<void> {
  const stop: Message = { type: 'OFFSCREEN_STOP' };
  await chrome.runtime.sendMessage(stop);
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();

  const active = await getActiveSession();
  if (active) await finalizeSession(active.sessionId, Date.now());
  await setActiveSession(null);

  recordingTabId = null;
  relayToTab(tabId, { type: 'RECORDING', recording: false });
}

async function pruneOnStartup(): Promise<void> {
  const settings = await getSettings();
  await pruneOldSessions(settings.retentionDays, Date.now());
}

/**
 * Resolve which session a tab's Summarise targets: an explicit id wins, else the
 * tab's own last recorded session, else the most recent *finished* session as a
 * safety net. Never the global-newest (wrong tab) or an in-progress one.
 */
async function resolveSummariseTarget(
  tabId: number,
  sessionId: string | undefined,
): Promise<Session | undefined> {
  if (sessionId) return getSession(sessionId);
  const lastId = await getLastSessionForTab(tabId);
  if (lastId) return getSession(lastId);
  return (await getAllSessions()).find((session) => session.endedAt !== null);
}

/**
 * Summarise a session via Groq (the only outbound call). Saves the markdown to the
 * session and relays it to the panel; surfaces typed errors so the panel can show
 * a CTA. Loading is only emitted once the checks pass (no loading→error flash), and
 * an in-flight guard drops concurrent clicks.
 */
async function handleSummarise(tabId: number, sessionId: string | undefined): Promise<void> {
  const send = (state: 'loading' | 'done' | 'error', extra: Partial<Message> = {}) =>
    relayToTab(tabId, { type: 'SUMMARY_STATUS', state, ...extra } as Message);

  if (summarising) return;
  summarising = true; // set synchronously before any await so a double-click can't slip past
  try {
    if (!(await chrome.permissions.contains({ origins: [GROQ_ORIGIN] }))) {
      send('error', { error: 'permission' });
      return;
    }

    const session = await resolveSummariseTarget(tabId, sessionId);
    if (!session || !session.transcript.trim()) {
      send('error', { error: 'empty' });
      return;
    }

    send('loading'); // only after the gates pass — no loading→error flash
    const settings = await getSettings();
    const result = await summarise(session.transcript, settings.groqApiKey, settings.model);
    if (result.ok) {
      await saveSummary(session.id, result.markdown);
      send('done', { markdown: result.markdown });
    } else {
      send('error', { error: result.error });
    }
  } finally {
    summarising = false;
  }
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
      const senderTabId = sender.tab?.id;
      const stopTab = senderTabId ?? recordingTabId;
      const finish = (tabId: number) =>
        stopRecording(tabId).catch((error: unknown) => {
          console.error('Breathe: could not stop recording', error);
        });
      if (stopTab !== null && stopTab !== undefined) {
        void finish(stopTab);
      } else {
        // Service worker slept and lost recordingTabId; recover it from storage.
        void getActiveSession().then((active) => {
          if (active) void finish(active.tabId);
        });
      }
      return;
    }

    case 'GET_STATE': {
      // The persisted active session is authoritative — recordingTabId is lost
      // when the service worker sleeps mid-meeting.
      void getActiveSession().then((active) => {
        const state: RecordingState = { recording: active?.tabId === message.tabId };
        sendResponse(state);
      });
      return true; // async sendResponse
    }

    case 'VU_LEVEL':
      relayToTab(message.tabId, { type: 'VU', level: message.level });
      return;

    case 'TRANSCRIPT_CHUNK': {
      const { tabId, text } = message;
      void getActiveSession().then((active) => {
        if (active) void appendTranscript(active.sessionId, text);
      });
      relayToTab(tabId, { type: 'TRANSCRIPT', text });
      return;
    }

    case 'TRANSCRIBE_STATUS':
      relayToTab(message.tabId, {
        type: 'STT_STATUS',
        state: message.state,
        progress: message.progress,
        message: message.message,
      });
      return;

    case 'SUMMARISE': {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        handleSummarise(tabId, message.sessionId).catch((error: unknown) => {
          console.error('Breathe: summarise failed', error);
          relayToTab(tabId, { type: 'SUMMARY_STATUS', state: 'error', error: 'network' });
        });
      }
      return;
    }

    case 'OPEN_OPTIONS':
      void chrome.runtime.openOptionsPage();
      return;
  }
});

/** Stops recording if the given tab is the one being recorded (storage is authoritative). */
async function stopIfRecording(tabId: number): Promise<void> {
  const active = await getActiveSession();
  if (active?.tabId === tabId || recordingTabId === tabId) {
    await stopRecording(tabId).catch(() => {
      // tab already gone or navigated; transcript chunks were persisted as they arrived
    });
  }
}

// If the meeting tab closes while recording, tear capture down.
chrome.tabs.onRemoved.addListener((tabId) => {
  void stopIfRecording(tabId);
});

// A full reload or navigation of the meeting tab ends the session cleanly — the
// captured stream is gone, and the partial transcript is already saved. (SPA
// route changes inside the meeting use the History API and don't fire 'loading'.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') void stopIfRecording(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  void syncContentScript();
  void pruneOnStartup();
});

chrome.runtime.onStartup.addListener(() => {
  void syncContentScript();
  void pruneOnStartup();
});
