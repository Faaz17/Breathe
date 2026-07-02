import { z } from 'zod';

/**
 * All extension messages, parsed with safeParse at each onMessage boundary.
 *
 * Capture flow (MV3 service workers can't make a MediaStream):
 *   popup → SW (START_RECORDING) → SW mints a stream id → SW → offscreen
 *   (OFFSCREEN_START) → offscreen captures + plays back + analyses → offscreen
 *   → SW (VU_LEVEL) → SW → content script (VU) → panel meter.
 */
/** State of the in-browser Whisper transcriber, surfaced to the panel. */
export const SttState = z.enum(['loading', 'ready', 'error']);
export type SttState = z.infer<typeof SttState>;

/**
 * Why a recording stopped. Only `capture-lost`/`error` surface a notice in the
 * panel — the others are either user-initiated or leave no panel to notify.
 */
export const StopReason = z.enum([
  'user', // explicit Stop click (panel or popup)
  'tab-closed', // meeting tab was closed
  'navigated', // meeting tab left the meeting URL
  'capture-lost', // Chrome ended the capture and auto-resume failed
  'error', // unexpected internal failure
]);
export type StopReason = z.infer<typeof StopReason>;

/** Why a Groq summarise attempt failed (drives the panel's message + CTA). */
export const SummaryError = z.enum([
  'no-key', // user hasn't set an API key
  'permission', // host permission for api.groq.com not granted
  'empty', // nothing recorded to summarise
  'auth', // 401 — bad/expired key
  'rate-limit', // 429 after one retry
  'network', // fetch failed / non-OK
  'bad-response', // unexpected response shape
]);
export type SummaryError = z.infer<typeof SummaryError>;

export const Message = z.discriminatedUnion('type', [
  // popup → service worker
  z.object({ type: z.literal('START_RECORDING'), tabId: z.number() }),
  // popup sends its tabId; the content script omits it (the SW uses sender.tab.id)
  z.object({ type: z.literal('GET_STATE'), tabId: z.number().optional() }),
  // panel (content script) → service worker
  z.object({ type: z.literal('STOP_RECORDING') }),
  z.object({ type: z.literal('SUMMARISE'), sessionId: z.string().optional() }),
  z.object({ type: z.literal('OPEN_OPTIONS') }),
  // The meeting page's own mute state (read from its mute button by the
  // content script). Breathe's mic capture is an independent OS stream, so
  // without this it would keep transcribing the user while they're muted
  // in the meeting — a privacy hole, not a feature.
  z.object({ type: z.literal('MEETING_MIC_STATE'), muted: z.boolean() }),
  // service worker → offscreen document. micMuted seeds the meeting-mute state
  // on (re)start — the SW persists it, so an auto-resume can't silently
  // re-enable a mic the user muted in the meeting.
  z.object({
    type: z.literal('OFFSCREEN_START'),
    streamId: z.string(),
    tabId: z.number(),
    micMuted: z.boolean().optional(),
  }),
  z.object({ type: z.literal('OFFSCREEN_STOP') }),
  // Health check: the offscreen doc replies with PingReply via sendResponse.
  z.object({ type: z.literal('OFFSCREEN_PING') }),
  // Mirror the meeting's mute state onto Breathe's mic capture track.
  z.object({ type: z.literal('OFFSCREEN_MIC_STATE'), muted: z.boolean() }),
  // offscreen document → service worker
  z.object({ type: z.literal('VU_LEVEL'), tabId: z.number(), level: z.number() }),
  z.object({ type: z.literal('TRANSCRIPT_CHUNK'), tabId: z.number(), text: z.string() }),
  // Chrome ended the capture stream out from under us (tab teardown, media
  // process death) — the SW decides whether to auto-resume or stop cleanly.
  z.object({
    type: z.literal('CAPTURE_LOST'),
    tabId: z.number(),
    detail: z.enum(['track-ended', 'stream-inactive', 'no-track']),
  }),
  // Offscreen diagnostics, written to the ring buffer by the SW (single writer).
  z.object({
    type: z.literal('DIAG'),
    event: z.string(),
    detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
  z.object({
    type: z.literal('TRANSCRIBE_STATUS'),
    tabId: z.number(),
    state: SttState,
    progress: z.number().optional(),
    message: z.string().optional(),
  }),
  // service worker → content script
  z.object({ type: z.literal('VU'), level: z.number() }),
  z.object({
    type: z.literal('RECORDING'),
    recording: z.boolean(),
    // Present on stops so the panel can tell a user Stop from an unexpected one.
    reason: StopReason.optional(),
  }),
  z.object({ type: z.literal('TRANSCRIPT'), text: z.string() }),
  z.object({
    type: z.literal('STT_STATUS'),
    state: SttState,
    progress: z.number().optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('SUMMARY_STATUS'),
    state: z.enum(['loading', 'done', 'error']),
    markdown: z.string().optional(),
    error: SummaryError.optional(),
  }),
]);
export type Message = z.infer<typeof Message>;

/**
 * Response to GET_STATE (service worker → popup/panel). transcript/summary are
 * the tab's active-or-last session, letting a remounted panel rehydrate after
 * a mid-meeting reload instead of showing a blank, dead-looking state.
 */
export const RecordingState = z.object({
  recording: z.boolean(),
  transcript: z.string().optional(),
  summary: z.string().optional(),
});
export type RecordingState = z.infer<typeof RecordingState>;

/** Response to OFFSCREEN_PING (offscreen → service worker). */
export const PingReply = z.object({ capturing: z.boolean() });
export type PingReply = z.infer<typeof PingReply>;

/** Response to START_RECORDING (service worker → popup). */
export const Ack = z.object({ ok: z.boolean() });
export type Ack = z.infer<typeof Ack>;
