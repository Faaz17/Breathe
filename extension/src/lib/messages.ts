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
  z.object({ type: z.literal('GET_STATE'), tabId: z.number() }),
  // panel (content script) → service worker
  z.object({ type: z.literal('STOP_RECORDING') }),
  z.object({ type: z.literal('SUMMARISE'), sessionId: z.string().optional() }),
  z.object({ type: z.literal('OPEN_OPTIONS') }),
  // service worker → offscreen document
  z.object({ type: z.literal('OFFSCREEN_START'), streamId: z.string(), tabId: z.number() }),
  z.object({ type: z.literal('OFFSCREEN_STOP') }),
  // offscreen document → service worker
  z.object({ type: z.literal('VU_LEVEL'), tabId: z.number(), level: z.number() }),
  z.object({ type: z.literal('TRANSCRIPT_CHUNK'), tabId: z.number(), text: z.string() }),
  z.object({
    type: z.literal('TRANSCRIBE_STATUS'),
    tabId: z.number(),
    state: SttState,
    progress: z.number().optional(),
    message: z.string().optional(),
  }),
  // service worker → content script
  z.object({ type: z.literal('VU'), level: z.number() }),
  z.object({ type: z.literal('RECORDING'), recording: z.boolean() }),
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

/** Response to GET_STATE (service worker → popup). */
export const RecordingState = z.object({ recording: z.boolean() });
export type RecordingState = z.infer<typeof RecordingState>;

/** Response to START_RECORDING (service worker → popup). */
export const Ack = z.object({ ok: z.boolean() });
export type Ack = z.infer<typeof Ack>;
