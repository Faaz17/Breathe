import type { Platform } from './meeting';
import type { Session } from './db';

/**
 * Serialises a session to a self-contained Markdown document for export, and
 * builds a dated filename. Pure (no DOM / chrome APIs) so it's trivially testable
 * and reusable from any surface.
 */

export const PLATFORM_LABELS: Record<Platform, string> = {
  gmeet: 'Google Meet',
  zoom: 'Zoom',
  webex: 'Webex',
};

export function formatStarted(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "14m 32s" / "1h 04m" — or an em dash when the session never ended cleanly. */
export function formatDuration(startedAt: number, endedAt: number | null): string {
  if (endedAt === null || endedAt < startedAt) return '—';
  const totalSeconds = Math.round((endedAt - startedAt) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function sessionToMarkdown(session: Session): string {
  const summary = session.summary?.trim() || '_Not summarised._';
  const transcript = session.transcript.trim() || '_No transcript recorded._';

  return [
    `# ${session.title}`,
    '',
    `- **Platform:** ${PLATFORM_LABELS[session.platform]}`,
    `- **Started:** ${formatStarted(session.startedAt)}`,
    `- **Duration:** ${formatDuration(session.startedAt, session.endedAt)}`,
    `- **Meeting:** ${session.meetingUrl || '—'}`,
    '',
    '## Summary',
    '',
    summary,
    '',
    '## Transcript',
    '',
    transcript,
    '',
    '---',
    `_Exported from Breathe on ${formatStarted(Date.now())}._`,
    '',
  ].join('\n');
}

/** `breathe-2026-06-18-google-meet.md` — date stamp from the session start. */
export function sessionFilename(session: Session): string {
  const date = new Date(session.startedAt);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return `breathe-${stamp}-${session.platform}.md`;
}
