// src/services/coach-notes.ts
//
// What the coach remembers about an athlete between conversations.
//
// A coach who is told "I'm away the week of the 12th" and then, on the 13th,
// asks why the session was missed is not a coach — it is a form. These are the
// durable facts the coach picks up from talking to the athlete: that they are
// travelling, that work is brutal this month, that the knee is still grumbling,
// that they promised to get three sessions in this week. They are read back
// into everything the coach says — the chat, the dashboard greeting, the daily
// tip, the journal response, the nightly adjustment job — so the athlete only
// ever has to say it once.
//
// Notes expire. "Away 12–19 Sep" is worth knowing on the 14th and misleading in
// October, so every note carries an expiry and the read path is the thing that
// enforces it.
//
// Admin SDK only.

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';

export const COACH_NOTES_COLLECTION = 'coachNotes';

export type CoachNoteCategory =
  /** Travel, holiday, a heavy work week — when they can't train as planned. */
  | 'availability'
  /** Injury, niggle, illness, missing equipment — what limits the work. */
  | 'constraint'
  /** A race, a target, what they're chasing. */
  | 'goal'
  /** How they like to train and be coached; what they enjoy or dread. */
  | 'preference'
  /** Life around the training: work, sleep, family, stress. */
  | 'context'
  /** Something the athlete said they would do. */
  | 'commitment';

export const COACH_NOTE_CATEGORIES: CoachNoteCategory[] = [
  'availability',
  'constraint',
  'goal',
  'preference',
  'context',
  'commitment',
];

/**
 * How long a note stays relevant when the athlete didn't give it an end date.
 *
 * Availability and commitments are short-lived by nature — a busy week is a
 * week. Goals and preferences don't rot, so they don't expire; they get
 * superseded instead, when the athlete says something that replaces them.
 */
const DEFAULT_TTL_DAYS: Record<CoachNoteCategory, number | null> = {
  availability: 30,
  constraint: 45,
  context: 45,
  commitment: 21,
  goal: null,
  preference: null,
};

/** Active notes kept per athlete. Oldest beyond this are retired, not deleted. */
const MAX_ACTIVE_NOTES = 24;

export interface CoachNote {
  id: string;
  userId: string;
  category: CoachNoteCategory;
  /** One sentence, in the third person: "Away in Spain 12–19 Sep." */
  content: string;
  source: 'chat' | 'journal' | 'manual';
  status: 'active' | 'resolved';
  createdAt: Date;
  updatedAt: Date;
  /** When this stops being true. Null means it doesn't expire on its own. */
  expiresAt: Date | null;
}

function toDate(value: any): Date {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value ?? Date.now());
}

function fromFirestore(doc: FirebaseFirestore.DocumentSnapshot): CoachNote {
  const data = doc.data() as Record<string, any>;
  return {
    id: doc.id,
    userId: data.userId,
    category: (COACH_NOTE_CATEGORIES as string[]).includes(data.category)
      ? data.category
      : 'context',
    content: String(data.content ?? ''),
    source: data.source ?? 'chat',
    status: data.status === 'resolved' ? 'resolved' : 'active',
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    expiresAt: data.expiresAt ? toDate(data.expiresAt) : null,
  };
}

/** The expiry a note gets when the athlete didn't name an end date themselves. */
export function defaultExpiry(category: CoachNoteCategory, from: Date): Date | null {
  const days = DEFAULT_TTL_DAYS[category];
  if (days === null) return null;
  const expires = new Date(from);
  expires.setDate(expires.getDate() + days);
  return expires;
}

/**
 * Everything the coach currently knows, newest first, with expired notes left
 * out. Expiry is applied on read rather than by a sweeper so a note is never
 * quoted back at an athlete a day after it stopped being true.
 */
export async function getActiveNotes(userId: string, now = new Date()): Promise<CoachNote[]> {
  try {
    const snapshot = await getAdminDb()
      .collection(COACH_NOTES_COLLECTION)
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .limit(60)
      .get();

    return snapshot.docs
      .map(fromFirestore)
      .filter(note => !note.expiresAt || note.expiresAt >= now)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, MAX_ACTIVE_NOTES);
  } catch (error) {
    // The coach losing its memory is a degraded answer, not a failed one.
    logger.error(
      '[coach-notes] Read failed:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

/** Renders notes for a prompt. Returns null when there's nothing to say. */
export function formatNotesForPrompt(notes: CoachNote[], now = new Date()): string | null {
  if (notes.length === 0) return null;

  return notes
    .map(note => {
      const until = note.expiresAt
        ? ` (through ${note.expiresAt.toISOString().slice(0, 10)})`
        : '';
      const age = Math.max(0, Math.round((now.getTime() - note.updatedAt.getTime()) / 86_400_000));
      const when = age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
      return `- [${note.category}] ${note.content}${until} — noted ${when}`;
    })
    .join('\n');
}

export interface CoachNoteWrite {
  /** Present for an update or a resolve; absent when adding. */
  id?: string;
  action: 'add' | 'update' | 'resolve';
  category?: CoachNoteCategory;
  content?: string;
  /** ISO date (YYYY-MM-DD) the note stops being true, if the athlete said. */
  expiresAt?: string | null;
}

/**
 * Applies a batch of note changes.
 *
 * Updates and resolves are checked against the note's owner first: the writes
 * come from a model reading a conversation, so a hallucinated id must not be
 * able to touch another athlete's memory.
 */
export async function applyNoteWrites(
  userId: string,
  writes: CoachNoteWrite[],
  options: { source?: CoachNote['source']; now?: Date } = {},
): Promise<{ added: number; updated: number; resolved: number }> {
  const now = options.now ?? new Date();
  const source = options.source ?? 'chat';
  const db = getAdminDb();
  const collection = db.collection(COACH_NOTES_COLLECTION);
  const batch = db.batch();
  const counts = { added: 0, updated: 0, resolved: 0 };

  // Resolve ownership up front — one read per referenced note, and never a
  // blind write to an id the model produced.
  const referencedIds = [...new Set(writes.map(write => write.id).filter(Boolean) as string[])];
  const owned = new Set<string>();
  if (referencedIds.length > 0) {
    const docs = await db.getAll(...referencedIds.map(id => collection.doc(id)));
    for (const doc of docs) {
      if (doc.exists && doc.data()?.userId === userId) owned.add(doc.id);
    }
  }

  const parseExpiry = (value: string | null | undefined, category: CoachNoteCategory) => {
    if (value === null) return null;
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return defaultExpiry(category, now);
  };

  for (const write of writes) {
    if (write.action === 'resolve') {
      if (!write.id || !owned.has(write.id)) continue;
      batch.update(collection.doc(write.id), {
        status: 'resolved',
        updatedAt: Timestamp.fromDate(now),
      });
      counts.resolved++;
      continue;
    }

    const content = write.content?.trim();
    if (!content) continue;
    const category = write.category ?? 'context';

    if (write.action === 'update' && write.id && owned.has(write.id)) {
      const expiresAt = parseExpiry(write.expiresAt, category);
      batch.update(collection.doc(write.id), {
        category,
        content,
        expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
        updatedAt: Timestamp.fromDate(now),
        status: 'active',
      });
      counts.updated++;
      continue;
    }

    // Falling through to here covers an `update` whose id we couldn't verify —
    // a hallucinated id, or one belonging to someone else. The content is still
    // a true thing about *this* athlete, and losing it is worse than carrying a
    // near-duplicate the next extraction pass can merge, so it lands as a new
    // note under the right owner rather than being dropped.
    const expiresAt = parseExpiry(write.expiresAt, category);
    batch.set(collection.doc(), {
      userId,
      category,
      content,
      source,
      status: 'active',
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
    });
    counts.added++;
  }

  if (counts.added + counts.updated + counts.resolved === 0) return counts;

  await batch.commit();
  await retireOverflow(userId, now);
  return counts;
}

/**
 * Keeps the active set bounded. The oldest notes are marked resolved rather
 * than deleted, so nothing the athlete told the coach is ever destroyed.
 */
async function retireOverflow(userId: string, now: Date): Promise<void> {
  try {
    const snapshot = await getAdminDb()
      .collection(COACH_NOTES_COLLECTION)
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .limit(80)
      .get();

    const active = snapshot.docs
      .map(fromFirestore)
      .filter(note => !note.expiresAt || note.expiresAt >= now)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (active.length <= MAX_ACTIVE_NOTES) return;

    const db = getAdminDb();
    const batch = db.batch();
    for (const note of active.slice(MAX_ACTIVE_NOTES)) {
      batch.update(db.collection(COACH_NOTES_COLLECTION).doc(note.id), {
        status: 'resolved',
        updatedAt: Timestamp.fromDate(now),
      });
    }
    await batch.commit();
  } catch (error) {
    logger.error(
      '[coach-notes] Retiring overflow failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Marks a note resolved on the athlete's own instruction (they can dismiss one). */
export async function resolveNote(userId: string, noteId: string): Promise<boolean> {
  const ref = getAdminDb().collection(COACH_NOTES_COLLECTION).doc(noteId);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== userId) return false;
  await ref.update({ status: 'resolved', updatedAt: Timestamp.fromDate(new Date()) });
  return true;
}
