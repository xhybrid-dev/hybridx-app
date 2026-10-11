// src/lib/schedule-move.ts
//
// What happens to a week when the athlete drags a session from one day to
// another on the Plan page. Pure, so the rules are tested rather than trusted.

import type { WorkoutDay, WorkoutSession } from '@/models/types';

/** Logged extra activity rather than schedule — shown, but never moved or rewritten. */
export const AD_HOC_PROGRAM_IDS = ['one-off-ai', 'custom-workout'];

/** One session on a day, as the athlete sees it. */
export interface ScheduleEntry {
  workout: WorkoutDay;
  /**
   * The saved session doc this came from. Absent when the day has never been
   * saved and the session is still the program's own default. A save sends it
   * so the doc itself changes day — keeping its id, notes and progress —
   * instead of its content being copied over whatever doc sat on the target.
   */
  sessionId?: string;
  /** Finished, or logged extra activity: it stays on its day. */
  locked?: boolean;
  /** Logged extra activity: never part of a save, so the schedule can't rewrite it. */
  adHoc?: boolean;
}

export interface MovableDay {
  dateKey: string;
  entries: ScheduleEntry[];
  isPast: boolean;
}

/** `workout` is the session's own workoutDetails, which callers have already checked is there. */
export function entryFromSession(session: WorkoutSession, workout: WorkoutDay): ScheduleEntry {
  const adHoc = AD_HOC_PROGRAM_IDS.includes(session.programId);
  return {
    workout,
    sessionId: session.id,
    locked: !!session.finishedAt || adHoc,
    adHoc,
  };
}

/** What a save sends for a day: its sessions in order, minus logged extra activity. */
export function entriesToSave(entries: ScheduleEntry[]): { workout: WorkoutDay; sessionId?: string }[] {
  return entries
    .filter(entry => !entry.adHoc)
    .map(({ workout, sessionId }) => (sessionId ? { workout, sessionId } : { workout }));
}

function isRestPlaceholder(entries: ScheduleEntry[]): boolean {
  if (entries.length !== 1 || entries[0].locked) return false;
  const title = entries[0].workout.title.toLowerCase();
  return title.includes('rest') || title.includes('recover');
}

/**
 * Moves one session and returns the new days, or `null` when the move isn't
 * allowed (unknown day, bad index, same day, a locked session, or a drop onto
 * a day already gone).
 *
 * - A day whose only content is a "Rest" placeholder counts as empty: the
 *   session replaces it.
 * - A one-for-one trade between two future days is a straight swap.
 * - A session moved out of the past (yesterday's, missed) never swaps: that
 *   would drop today's session onto a day already gone, where it could only
 *   ever show as missed. It joins the target day instead.
 * - A finished session never swaps out either: the moved one joins it.
 */
export function moveSession<T extends MovableDay>(
  days: T[],
  sourceDateKey: string,
  sourceIndex: number,
  targetDateKey: string,
): T[] | null {
  if (sourceDateKey === targetDateKey) return null;
  const source = days.find(day => day.dateKey === sourceDateKey);
  const target = days.find(day => day.dateKey === targetDateKey);
  if (!source || !target || target.isPast) return null;
  if (sourceIndex < 0 || sourceIndex >= source.entries.length) return null;

  const moved = source.entries[sourceIndex];
  if (moved.locked) return null;
  const remainingSource = source.entries.filter((_, index) => index !== sourceIndex);
  const targetContent = isRestPlaceholder(target.entries) ? [] : target.entries;

  const isSimpleSwap = !source.isPast
    && remainingSource.length === 0
    && targetContent.length === 1
    && !targetContent[0].locked;
  const newSource = isSimpleSwap ? [targetContent[0]] : remainingSource;
  const newTarget = isSimpleSwap ? [moved] : [...targetContent, moved];

  return days.map(day => {
    if (day.dateKey === sourceDateKey) return { ...day, entries: newSource };
    if (day.dateKey === targetDateKey) return { ...day, entries: newTarget };
    return day;
  });
}
