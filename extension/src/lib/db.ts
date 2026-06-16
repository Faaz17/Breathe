import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';

import type { Platform } from './meeting';

/**
 * IndexedDB is the only place transcripts live (privacy by default — see
 * CLAUDE.md). Two stores: `sessions` (one row per meeting) and `settings`
 * (a singleton row). The service worker owns all writes.
 */

export const Session = z.object({
  id: z.string(),
  platform: z.enum(['gmeet', 'zoom', 'webex']),
  meetingUrl: z.string(),
  title: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  transcript: z.string(),
  summary: z.string().nullable(),
  consentNoticeSent: z.boolean(),
});
export type Session = z.infer<typeof Session>;

export const Settings = z.object({
  groqApiKey: z.string(),
  model: z.string(),
  retentionDays: z.number(),
  autoSummariseOnStop: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  groqApiKey: '',
  model: 'llama-3.1-8b-instant',
  retentionDays: 30,
  autoSummariseOnStop: false,
};

const DB_NAME = 'breathe';
const DB_VERSION = 1;
const SETTINGS_KEY = 'app';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface BreatheDB extends DBSchema {
  sessions: {
    key: string;
    value: Session;
    indexes: { 'by-startedAt': number };
  };
  settings: {
    key: string;
    value: Settings;
  };
}

let dbPromise: Promise<IDBPDatabase<BreatheDB>> | null = null;

function getDb(): Promise<IDBPDatabase<BreatheDB>> {
  dbPromise ??= openDB<BreatheDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Migrations for future versions branch on oldVersion here.
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('by-startedAt', 'startedAt');
      db.createObjectStore('settings');
    },
  });
  return dbPromise;
}

interface NewSessionInput {
  platform: Platform;
  meetingUrl: string;
  title: string;
  startedAt: number;
}

export async function createSession(input: NewSessionInput): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    platform: input.platform,
    meetingUrl: input.meetingUrl,
    title: input.title,
    startedAt: input.startedAt,
    endedAt: null,
    transcript: '',
    summary: null,
    consentNoticeSent: false,
  };
  const db = await getDb();
  await db.put('sessions', session);
  return session;
}

/**
 * Appends a transcript chunk to a session in a single read-modify-write
 * transaction so concurrent chunks can't clobber each other. Joins with a
 * space unless the running transcript is empty.
 */
export async function appendTranscript(id: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const db = await getDb();
  const tx = db.transaction('sessions', 'readwrite');
  const session = await tx.store.get(id);
  if (session) {
    session.transcript = session.transcript
      ? `${session.transcript} ${trimmed}`
      : trimmed;
    await tx.store.put(session);
  }
  await tx.done;
}

export async function saveSummary(id: string, summary: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('sessions', 'readwrite');
  const session = await tx.store.get(id);
  if (session) {
    session.summary = summary;
    await tx.store.put(session);
  }
  await tx.done;
}

export async function finalizeSession(id: string, endedAt: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('sessions', 'readwrite');
  const session = await tx.store.get(id);
  if (session) {
    session.endedAt = endedAt;
    await tx.store.put(session);
  }
  await tx.done;
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = await getDb();
  return db.get('sessions', id);
}

/** All sessions, most recent first. */
export async function getAllSessions(): Promise<Session[]> {
  const db = await getDb();
  const sessions = await db.getAllFromIndex('sessions', 'by-startedAt');
  return sessions.reverse();
}

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const stored = await db.get('settings', SETTINGS_KEY);
  const parsed = Settings.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  const db = await getDb();
  await db.put('settings', next, SETTINGS_KEY);
  return next;
}

/** Deletes sessions whose start is older than `retentionDays`. Runs on startup. */
export async function pruneOldSessions(retentionDays: number, now: number): Promise<number> {
  const cutoff = now - retentionDays * MS_PER_DAY;
  const db = await getDb();
  const tx = db.transaction('sessions', 'readwrite');
  let deleted = 0;
  for await (const cursor of tx.store.index('by-startedAt').iterate()) {
    if (cursor.value.startedAt >= cutoff) break; // index is ascending; rest are newer
    await cursor.delete();
    deleted += 1;
  }
  await tx.done;
  return deleted;
}
