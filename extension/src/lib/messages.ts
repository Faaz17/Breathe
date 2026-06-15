import { z } from 'zod';

/**
 * All extension messages, parsed with safeParse at each onMessage boundary.
 *
 * Capture flow (MV3 service workers can't make a MediaStream):
 *   popup → SW (START_RECORDING) → SW mints a stream id → SW → offscreen
 *   (OFFSCREEN_START) → offscreen captures + plays back + analyses → offscreen
 *   → SW (VU_LEVEL) → SW → content script (VU) → panel meter.
 */
export const Message = z.discriminatedUnion('type', [
  // popup → service worker
  z.object({ type: z.literal('START_RECORDING'), tabId: z.number() }),
  z.object({ type: z.literal('GET_STATE'), tabId: z.number() }),
  // panel (content script) → service worker
  z.object({ type: z.literal('STOP_RECORDING') }),
  // service worker → offscreen document
  z.object({ type: z.literal('OFFSCREEN_START'), streamId: z.string(), tabId: z.number() }),
  z.object({ type: z.literal('OFFSCREEN_STOP') }),
  // offscreen document → service worker
  z.object({ type: z.literal('VU_LEVEL'), tabId: z.number(), level: z.number() }),
  // service worker → content script
  z.object({ type: z.literal('VU'), level: z.number() }),
  z.object({ type: z.literal('RECORDING'), recording: z.boolean() }),
]);
export type Message = z.infer<typeof Message>;

/** Response to GET_STATE (service worker → popup). */
export const RecordingState = z.object({ recording: z.boolean() });
export type RecordingState = z.infer<typeof RecordingState>;

/** Response to START_RECORDING (service worker → popup). */
export const Ack = z.object({ ok: z.boolean() });
export type Ack = z.infer<typeof Ack>;
