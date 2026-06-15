export type Platform = 'gmeet' | 'zoom' | 'webex';

export interface MeetingInfo {
  platform: Platform;
  meetingUrl: string;
}

// A Google Meet meeting code is three letter groups: e.g. /abc-defg-hij.
// This excludes the landing page, /new, /landing, /_meet/*, lookup links, etc.
const GMEET_CODE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/;

// Webex web-app meeting paths vary by tenant; this is a best-effort match.
const WEBEX_MEETING_PATH = /\/(?:meet|wc|webappng|meeting)\b/i;

/**
 * Returns the meeting context for a URL, or null if it isn't a real meeting.
 *
 * Gmeet detection is verified. Zoom/Webex are best-effort heuristics —
 * verify against a live meeting before relying on them.
 */
export function detectMeeting(url: URL): MeetingInfo | null {
  const { hostname, pathname } = url;

  if (hostname === 'meet.google.com' && GMEET_CODE.test(pathname)) {
    return { platform: 'gmeet', meetingUrl: url.href };
  }

  if (hostname.endsWith('.zoom.us') && pathname.startsWith('/wc/')) {
    return { platform: 'zoom', meetingUrl: url.href };
  }

  if (hostname.endsWith('.webex.com') && WEBEX_MEETING_PATH.test(pathname)) {
    return { platform: 'webex', meetingUrl: url.href };
  }

  return null;
}
