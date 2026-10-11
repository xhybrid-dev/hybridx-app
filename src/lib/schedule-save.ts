// src/lib/schedule-save.ts
//
// How a rearranged schedule lands on the session docs. Pure, so the rules are
// tested rather than trusted; saveScheduleChanges only reads the docs, runs
// this, and applies what comes back.

import type { WorkoutDay } from '@/models/types';

export interface DayToSave {
  dateKey: string;
  /** The day's sessions, in order. Empty = cleared. */
  entries: { workout: WorkoutDay; sessionId?: string }[];
}

/** A non-ad-hoc session doc already on one of the days being saved. */
export interface ExistingSessionDoc {
  id: string;
  dateKey: string;
  /** The workout's title, or null for a content-less "cleared day" marker. */
  title: string | null;
  finished: boolean;
  sessionIndex: number;
  sessionCount?: number;
}

export type ScheduleWrite =
  /** An existing doc stays (and changes day when `moved`); only its position is written. */
  | { type: 'keep'; id: string; dateKey: string; moved: boolean; sessionIndex: number; sessionCount: number }
  | { type: 'create'; dateKey: string; workout: WorkoutDay; sessionIndex: number; sessionCount: number }
  /** The day was cleared: a content-less doc keeps it from falling back to the program. */
  | { type: 'marker'; dateKey: string; id?: string }
  | { type: 'delete'; id: string };

type Slot = { doc: ExistingSessionDoc } | { workout: WorkoutDay };

/**
 * - A session that came from a doc moves as that doc. Its id, notes, results
 *   and Strava link go with it, and the workout page sees a new session rather
 *   than the old one with different content.
 * - A finished doc never changes day. One the page still showed as movable (it
 *   was finished elsewhere after the page loaded) stays where it was finished,
 *   and a finished doc the page didn't list at all is kept at the end of its day.
 * - A session with no usable doc takes an unclaimed doc on the same day with
 *   the same title, if there is one, before a new doc is made. A page that
 *   loaded before the dashboard seeded today's docs would otherwise duplicate them.
 * - Anything left unclaimed and unfinished on a saved day is deleted.
 */
export function planScheduleWrites(days: DayToSave[], existing: ExistingSessionDoc[]): ScheduleWrite[] {
  const byId = new Map(existing.map(doc => [doc.id, doc]));
  const claimed = new Set<string>();
  const slots: (Slot | null | undefined)[][] = days.map(day => day.entries.map(() => undefined));

  // Docs referenced by id are claimed first, across every day, so a doc moved
  // from Tuesday to Wednesday is never adopted by Tuesday on the title rule.
  days.forEach((day, dayIndex) => {
    day.entries.forEach((entry, entryIndex) => {
      const doc = entry.sessionId ? byId.get(entry.sessionId) : undefined;
      if (!doc || doc.title === null || claimed.has(doc.id)) return;
      if (doc.finished && doc.dateKey !== day.dateKey) {
        slots[dayIndex][entryIndex] = null;
        return;
      }
      claimed.add(doc.id);
      slots[dayIndex][entryIndex] = { doc };
    });
  });

  days.forEach((day, dayIndex) => {
    day.entries.forEach((entry, entryIndex) => {
      if (slots[dayIndex][entryIndex] !== undefined) return;
      const sameTitle = existing.find(doc =>
        doc.dateKey === day.dateKey && !claimed.has(doc.id) && doc.title === entry.workout.title);
      if (sameTitle) {
        claimed.add(sameTitle.id);
        slots[dayIndex][entryIndex] = { doc: sameTitle };
      } else {
        slots[dayIndex][entryIndex] = { workout: entry.workout };
      }
    });
  });

  const writes: ScheduleWrite[] = [];
  days.forEach((day, dayIndex) => {
    const onDay = existing.filter(doc => doc.dateKey === day.dateKey);
    const final: Slot[] = [
      ...slots[dayIndex].filter((slot): slot is Slot => !!slot),
      ...onDay.filter(doc => doc.finished && doc.title !== null && !claimed.has(doc.id)).map(doc => ({ doc })),
    ];

    const unclaimed = onDay.filter(doc => !doc.finished && !claimed.has(doc.id));
    if (final.length === 0) {
      const marker = unclaimed.find(doc => doc.title === null);
      if (marker) claimed.add(marker.id);
      writes.push({ type: 'marker', dateKey: day.dateKey, id: marker?.id });
    }

    final.forEach((slot, sessionIndex) => {
      const sessionCount = final.length;
      if ('workout' in slot) {
        writes.push({ type: 'create', dateKey: day.dateKey, workout: slot.workout, sessionIndex, sessionCount });
        return;
      }
      const { doc } = slot;
      const moved = doc.dateKey !== day.dateKey;
      if (!moved && doc.sessionIndex === sessionIndex && doc.sessionCount === sessionCount) return;
      writes.push({ type: 'keep', id: doc.id, dateKey: day.dateKey, moved, sessionIndex, sessionCount });
    });
  });

  // Last, so a doc claimed by a later day is never deleted by an earlier one.
  existing
    .filter(doc => !doc.finished && !claimed.has(doc.id))
    .forEach(doc => writes.push({ type: 'delete', id: doc.id }));

  return writes;
}
