// src/lib/schedule-move.ts
//
// What happens to a week when the athlete drags a session from one day to
// another on the Plan page. Pure, so the rules are tested rather than trusted.

import type { WorkoutDay } from '@/models/types';

export interface MovableDay {
  dateKey: string;
  workouts: WorkoutDay[];
  isPast: boolean;
}

function isRestPlaceholder(workouts: WorkoutDay[]): boolean {
  if (workouts.length !== 1) return false;
  const title = workouts[0].title.toLowerCase();
  return title.includes('rest') || title.includes('recover');
}

/**
 * Moves one session and returns the new days, or `null` when the move isn't
 * allowed (unknown day, bad index, same day, or a drop onto a day already gone).
 *
 * - A day whose only content is a "Rest" placeholder counts as empty: the
 *   session replaces it.
 * - A one-for-one trade between two future days is a straight swap.
 * - A session moved out of the past (yesterday's, missed) never swaps: that
 *   would drop today's session onto a day already gone, where it could only
 *   ever show as missed. It joins the target day instead.
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
  if (sourceIndex < 0 || sourceIndex >= source.workouts.length) return null;

  const moved = source.workouts[sourceIndex];
  const remainingSource = source.workouts.filter((_, index) => index !== sourceIndex);
  const targetContent = isRestPlaceholder(target.workouts) ? [] : target.workouts;

  const isSimpleSwap = !source.isPast && remainingSource.length === 0 && targetContent.length === 1;
  const newSource = isSimpleSwap ? [targetContent[0]] : remainingSource;
  const newTarget = isSimpleSwap ? [moved] : [...targetContent, moved];

  return days.map(day => {
    if (day.dateKey === sourceDateKey) return { ...day, workouts: newSource };
    if (day.dateKey === targetDateKey) return { ...day, workouts: newTarget };
    return day;
  });
}
