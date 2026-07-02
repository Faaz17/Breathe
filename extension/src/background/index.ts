import {
  type Ack,
  Message,
  PingReply,
  type RecordingState,
  type StopReason,
} from '../lib/messages';
import {
  appendTranscript,
  createSession,
  finalizeSession,
  getAllSessions,
  getSession,
  getSettings,
  pruneOldSessions,
  reopenSession,
  saveSummary,
  type Session,
} from '../lib/db';
import { diag, readDiag } from '../lib/diag';
import { detectMeeting, isMeetingUrl, type Platform } from '../lib/meeting';
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

// Resilience: Chrome/Meet can kill the capture mid-meeting (media-process
// death, offscreen OOM). The user pressed Start and never Stop, so resuming
// into the SAME session is still user-initiated — not background recording.
const AUTO_RESUME_ON_CAPTURE_LOSS = true;
const RESUME_MAX_ATTEMPTS = 2; // per unhealthy stretch; restored while capture is healthy
const RESUME_RETRY_DELAY_MS = 2_000;
// A Start shortly after a stop in the same meeting reopens the previous
// session instead of fragmenting one meeting across several history entries.
const REOPEN_WINDOW_MS = 10 * 60_000;
const WATCHDOG_ALARM = 'breathe:watchdog';
const WATCHDOG_PERIOD_MINUTES = 0.5; // Chrome's minimum alarm period
const HEARTBEAT_WRITE_INTERVAL_MS = 5_000;
const HEARTBEAT_STALE_MS = 60_000;
const PING_TIMEOUT_MS = 3_000;

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

async function getResumeAttempts(): Promise<number> {
  const { resumeAttempts } = await chrome.storage.session.get('resumeAttempts');
  return typeof resumeAttempts === 'number' ? resumeAttempts : 0;
}

/**
 * The meeting's own mute state, persisted so it survives offscreen-document
 * restarts (auto-resume) and SW sleeps. Without this, a resume would silently
 * re-enable a mic the user muted in the meeting — the offscreen doc resets its
 * copy on every restart, and the content script only re-sends on change.
 */
async function getStoredMicMuted(): Promise<boolean> {
  const { meetingMicMuted } = await chrome.storage.session.get('meetingMicMuted');
  return meetingMicMuted === true;
}

let lastHeartbeatWrite = 0;

/**
 * Offscreen liveness signal for the watchdog, stamped from the constant VU/
 * transcript message flow (throttled — VU arrives every 33 ms). A healthy
 * capture also restores the auto-resume budget, so only a persistently broken
 * one exhausts it.
 */
function stampHeartbeat(): void {
  const now = Date.now();
  if (now - lastHeartbeatWrite < HEARTBEAT_WRITE_INTERVAL_MS) return;
  lastHeartbeatWrite = now;
  void chrome.storage.session
    .set({ heartbeatAt: now, resumeAttempts: 0 })
    .catch(() => {
      /* liveness stamp is best-effort */
    });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Same meeting = same host + path; Meet mutates query/hash mid-call. */
function sameMeeting(a: string, b: string): boolean {
  try {
    const urlA = new URL(a);
    const urlB = new URL(b);
    return (
      urlA.hostname === urlB.hostname &&
      urlA.pathname.replace(/\/+$/, '') === urlB.pathname.replace(/\/+$/, '')
    );
  } catch {
    return false;
  }
}

/** A recent, same-meeting session this tab can keep appending to. */
async function findReopenableSession(
  tabId: number,
  meetingUrl: string,
): Promise<Session | null> {
  if (!meetingUrl) return null;
  const lastId = await getLastSessionForTab(tabId);
  if (!lastId) return null;
  const session = await getSession(lastId);
  if (!session || session.endedAt === null) return null;
  if (Date.now() - session.endedAt > REOPEN_WINDOW_MS) return null;
  return sameMeeting(session.meetingUrl, meetingUrl) ? session : null;
}

async function startRecording(tabId: number): Promise<void> {
  // Mint a single-use stream id for the meeting tab; consumed by the offscreen doc.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const tab = await chrome.tabs.get(tabId);
  const meeting = tab.url ? detectMeeting(new URL(tab.url)) : null;
  const platform: Platform = meeting?.platform ?? 'gmeet';
  const meetingUrl = meeting?.meetingUrl ?? tab.url ?? '';
  const startedAt = Date.now();

  const reused = await findReopenableSession(tabId, meetingUrl);
  if (reused) await reopenSession(reused.id);
  const session =
    reused ??
    (await createSession({
      platform,
      meetingUrl,
      title: defaultTitle(platform, startedAt),
      startedAt,
    }));

  await ensureOffscreen();
  const start: Message = {
    type: 'OFFSCREEN_START',
    streamId,
    tabId,
    micMuted: await getStoredMicMuted(),
  };
  await chrome.runtime.sendMessage(start);

  recordingTabId = tabId;
  await setActiveSession({ tabId, sessionId: session.id });
  await setLastSessionForTab(tabId, session.id);
  await chrome.storage.session.set({ resumeAttempts: 0 });
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  relayToTab(tabId, { type: 'RECORDING', recording: true });
  // A reopened session's earlier text was cleared from the panel by the fresh
  // RECORDING:true — re-seed it so the meeting reads as one continuous note.
  if (reused && reused.transcript) {
    relayToTab(tabId, { type: 'TRANSCRIPT', text: reused.transcript });
  }
  diag('sw', 'start', { tabId, sessionId: session.id, reused: reused !== null });
}

async function stopRecording(tabId: number, reason: StopReason): Promise<void> {
  // Best-effort teardown: the offscreen document may already be gone (crash,
  // capture loss). A failed send must never block finalizing the session —
  // that wedge left Stop permanently broken.
  const stop: Message = { type: 'OFFSCREEN_STOP' };
  await chrome.runtime.sendMessage(stop).catch(() => {
    /* offscreen already gone */
  });
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
    /* already closed */
  }
  await chrome.alarms.clear(WATCHDOG_ALARM);

  const active = await getActiveSession();
  if (active) await finalizeSession(active.sessionId, Date.now());
  await setActiveSession(null);
  await chrome.storage.session.remove('meetingMicMuted');

  recordingTabId = null;
  relayToTab(tabId, { type: 'RECORDING', recording: false, reason });
  diag('sw', 'stop', { tabId, reason });
}

/** One silent re-capture attempt into the active session. True on success. */
async function resumeCapture(tabId: number): Promise<boolean> {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreen();
    const start: Message = {
      type: 'OFFSCREEN_START',
      streamId,
      tabId,
      // Re-apply the persisted meeting-mute state: the restarted offscreen doc
      // starts fresh and would otherwise transcribe a still-muted user.
      micMuted: await getStoredMicMuted(),
    };
    await chrome.runtime.sendMessage(start);
    recordingTabId = tabId;
    relayToTab(tabId, { type: 'RECORDING', recording: true });
    diag('sw', 'resume-ok', { tabId });
    return true;
  } catch (error) {
    diag('sw', 'resume-attempt-failed', { message: String(error) });
    return false;
  }
}

// In-flight guard: the track-ended message and the watchdog can both report
// the same loss; only one recovery may run at a time.
let handlingCaptureLoss = false;

/**
 * Capture died out from under a live session (Chrome ended the stream, the
 * offscreen document crashed). Try to silently resume into the SAME session.
 * If Chrome refuses (some navigations invalidate the capture grant until the
 * next toolbar click), stop honestly with 'capture-lost' so the panel tells
 * the user how to resume — never a phantom "Recording" over dead audio.
 */
async function handleCaptureLost(tabId: number, detail: string): Promise<void> {
  if (handlingCaptureLoss) return;
  handlingCaptureLoss = true;
  try {
    const active = await getActiveSession();
    if (active?.tabId !== tabId) return; // stale event; nothing to resume
    diag('sw', 'capture-lost', { tabId, detail });

    if (!AUTO_RESUME_ON_CAPTURE_LOSS) {
      await stopRecording(tabId, 'capture-lost');
      return;
    }

    const attempts = await getResumeAttempts();
    if (attempts >= RESUME_MAX_ATTEMPTS) {
      diag('sw', 'resume-budget-exhausted', { attempts });
      await stopRecording(tabId, 'capture-lost');
      return;
    }
    await chrome.storage.session.set({ resumeAttempts: attempts + 1 });

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !isMeetingUrl(tab.url)) {
      await stopRecording(tabId, tab ? 'navigated' : 'tab-closed');
      return;
    }

    if (await resumeCapture(tabId)) return;
    await delay(RESUME_RETRY_DELAY_MS);
    if (await resumeCapture(tabId)) return;

    diag('sw', 'resume-failed-final', { tabId });
    await stopRecording(tabId, 'capture-lost');
  } finally {
    handlingCaptureLoss = false;
  }
}

/** Health probe: true when the offscreen document answers and is capturing. */
async function pingOffscreen(): Promise<boolean> {
  try {
    const ping: Message = { type: 'OFFSCREEN_PING' };
    const reply: unknown = await Promise.race([
      chrome.runtime.sendMessage(ping),
      delay(PING_TIMEOUT_MS),
    ]);
    const parsed = PingReply.safeParse(reply);
    return parsed.success && parsed.data.capturing;
  } catch {
    return false;
  }
}

// Watchdog: catches the failure mode where the offscreen document dies outright
// (renderer OOM under the Whisper model) and nothing is left to send a message.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WATCHDOG_ALARM) return;
  void (async () => {
    const active = await getActiveSession();
    if (!active) {
      await chrome.alarms.clear(WATCHDOG_ALARM);
      return;
    }
    if (!(await chrome.offscreen.hasDocument())) {
      diag('sw', 'watchdog-offscreen-gone');
      await handleCaptureLost(active.tabId, 'watchdog-no-document');
      return;
    }
    const { heartbeatAt } = await chrome.storage.session.get('heartbeatAt');
    const fresh =
      typeof heartbeatAt === 'number' && Date.now() - heartbeatAt < HEARTBEAT_STALE_MS;
    if (fresh) return;
    if (await pingOffscreen()) {
      diag('sw', 'watchdog-stale-but-alive');
      return;
    }
    diag('sw', 'watchdog-offscreen-dead');
    await handleCaptureLost(active.tabId, 'watchdog-unresponsive');
  })();
});

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

/**
 * After an explicit Stop, optionally fire one Groq summarise for the just-finished
 * session — but only when the user opted in AND it's actually configured (API key +
 * host permission). Stays silent otherwise; summarising is never forced on a user
 * who hasn't set it up, and tab-teardown stops (onRemoved/onUpdated) never reach here.
 */
async function autoSummariseIfEnabled(tabId: number): Promise<void> {
  const settings = await getSettings();
  if (!settings.autoSummariseOnStop || !settings.groqApiKey.trim()) return;
  if (!(await chrome.permissions.contains({ origins: [GROQ_ORIGIN] }))) return;
  await handleSummarise(tabId, undefined);
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
          diag('sw', 'start-failed', { message: String(error) });
          const ack: Ack = { ok: false };
          sendResponse(ack);
        });
      return true; // async sendResponse

    case 'STOP_RECORDING': {
      const senderTabId = sender.tab?.id;
      const stopTab = senderTabId ?? recordingTabId;
      const finish = (tabId: number) =>
        stopRecording(tabId, 'user')
          .then(() => autoSummariseIfEnabled(tabId))
          .catch((error: unknown) => {
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
      // when the service worker sleeps mid-meeting. The tab's active-or-last
      // session transcript rides along so a remounted panel can rehydrate.
      const tabId = sender.tab?.id ?? message.tabId;
      void (async () => {
        if (tabId === undefined) {
          const state: RecordingState = { recording: false };
          sendResponse(state);
          return;
        }
        const active = await getActiveSession();
        let recording = false;
        let sessionId: string | null;
        if (active && active.tabId === tabId) {
          recording = true;
          sessionId = active.sessionId;
        } else {
          sessionId = await getLastSessionForTab(tabId);
        }
        const session = sessionId ? await getSession(sessionId) : undefined;
        const state: RecordingState = {
          recording,
          transcript: session?.transcript ?? '',
          summary: session?.summary ?? undefined,
        };
        sendResponse(state);
      })();
      return true; // async sendResponse
    }

    case 'VU_LEVEL':
      stampHeartbeat();
      relayToTab(message.tabId, { type: 'VU', level: message.level });
      return;

    case 'TRANSCRIPT_CHUNK': {
      const { tabId, text } = message;
      stampHeartbeat();
      void getActiveSession().then(async (active) => {
        if (!active) return;
        try {
          await appendTranscript(active.sessionId, text);
        } catch {
          try {
            await appendTranscript(active.sessionId, text); // once more — transient IDB failures
          } catch (error) {
            diag('sw', 'append-failed', { message: String(error) });
          }
        }
      });
      relayToTab(tabId, { type: 'TRANSCRIPT', text });
      return;
    }

    case 'CAPTURE_LOST':
      void handleCaptureLost(message.tabId, message.detail);
      return;

    case 'MEETING_MIC_STATE': {
      // Only the recorded tab's mute state matters; forward it to the
      // offscreen document so the mic track mirrors the meeting's mute.
      const senderTab = sender.tab?.id;
      if (senderTab === undefined) return;
      void getActiveSession().then((active) => {
        if (active?.tabId !== senderTab) return;
        diag('sw', 'meeting-mic-state', { muted: message.muted });
        // Persist first: OFFSCREEN_START re-applies this after any restart.
        void chrome.storage.session.set({ meetingMicMuted: message.muted });
        const forward: Message = { type: 'OFFSCREEN_MIC_STATE', muted: message.muted };
        void chrome.runtime.sendMessage(forward).catch(() => {
          // Offscreen document not up yet; OFFSCREEN_START carries the state.
        });
      });
      return;
    }

    case 'DIAG':
      diag('off', message.event, message.detail);
      return;

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
async function stopIfRecording(tabId: number, reason: StopReason): Promise<void> {
  const active = await getActiveSession();
  if (active?.tabId === tabId || recordingTabId === tabId) {
    await stopRecording(tabId, reason).catch(() => {
      // tab already gone or navigated; transcript chunks were persisted as they arrived
    });
  }
}

// If the meeting tab closes while recording, tear capture down.
chrome.tabs.onRemoved.addListener((tabId) => {
  void stopIfRecording(tabId, 'tab-closed');
});

// Only a real departure from the meeting ends the session. Meet fires 'loading'
// for mid-call reloads/reconnects too, but tab capture is bound to the TAB and
// survives navigation — stopping on every 'loading' killed healthy sessions
// minutes into a call (the "stops after 5–10 minutes" bug). Genuine capture
// loss is reported by the offscreen document (track 'ended') and the watchdog.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && changeInfo.url === undefined) return;
  void (async () => {
    const active = await getActiveSession();
    if (active?.tabId !== tabId) return;
    // URLs are only visible on permitted meeting hosts, so an invisible URL
    // reliably means the tab left the meeting.
    const url = changeInfo.url ?? tab.url;
    diag('sw', 'tab-updated', { tabId, status: changeInfo.status ?? '', url: url ?? '' });
    if (!isMeetingUrl(url)) await stopIfRecording(tabId, 'navigated');
  })();
});

chrome.runtime.onInstalled.addListener((details) => {
  void syncContentScript();
  void pruneOnStartup();
  // First install only — not on updates or browser restarts — open the onboarding
  // page so a new user knows what Breathe does and how to enable summaries.
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/index.html') });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void syncContentScript();
  void pruneOnStartup();
});

// Dev: run breatheDiag() in the SW console (chrome://extensions → "service
// worker") to dump the persistent diagnostics ring buffer as a table.
Object.assign(globalThis, {
  breatheDiag: async (): Promise<void> => {
    const entries = await readDiag();
    console.table(
      entries.map(({ t, ...rest }) => ({
        time: new Date(t).toLocaleTimeString(),
        ...rest,
      })),
    );
  },
});
