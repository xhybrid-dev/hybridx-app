// src/lib/catch-up.ts
//
// The program day is simply calendar days since the start date, so an athlete
// who misses a week comes back a week further on, facing a row of "missed"
// sessions. These helpers work out when that has happened and how to move the
// start date so they can pick up where they left off instead.

import { addDays, differenceInCalendarDays, startOfDay, subDays } from 'date-fns';

/** Days since the last finished session before we offer to catch up. */
export const AWAY_THRESHOLD_DAYS = 3;

export interface CatchUp {
  /** Scheduled sessions between the last one done and today. */
  missedSessions: number;
  /** Program day to resume at when picking up where they left off. */
  resumeDay: number;
  /** Program day to resume at when repeating the last week they trained. */
  repeatWeekDay: number;
}

export function computeCatchUp(args: {
  programDays: number[];
  todayProgramDay: number;
  /** Program day of the last finished session, 0 if they never trained. */
  lastCompletedProgramDay: number;
  daysSinceLastActivity: number | null;
}): CatchUp | null {
  const { programDays, todayProgramDay, lastCompletedProgramDay, daysSinceLastActivity } = args;
  if (todayProgramDay <= 1) return null;
  if (daysSinceLastActivity !== null && daysSinceLastActivity < AWAY_THRESHOLD_DAYS) return null;

  const cycleLength = Math.max(0, ...programDays);
  const last = Math.min(Math.max(lastCompletedProgramDay, 0), cycleLength);
  const missedDays = new Set(programDays.filter(day => day > last && day < todayProgramDay));
  if (missedDays.size < 2) return null; // one miss is a normal week, not a gap

  const resumeDay = last + 1;
  const repeatWeekDay = last > 0 ? Math.floor((last - 1) / 7) * 7 + 1 : 1;
  return { missedSessions: missedDays.size, resumeDay, repeatWeekDay };
}

/** The start date that makes `today` program day `resumeDay`. */
export function startDateForResume(today: Date, resumeDay: number): Date {
  return subDays(startOfDay(today), Math.max(1, resumeDay) - 1);
}

/** The start date after a pause: pushed forward by the days the plan was paused. */
export function startDateAfterPause(startDate: Date, pausedAt: Date, resumedAt: Date): Date {
  const pausedDays = Math.max(0, differenceInCalendarDays(startOfDay(resumedAt), startOfDay(pausedAt)));
  return addDays(startDate, pausedDays);
}
