// src/lib/coach/daily-adjust.ts
//
// Pure decisions behind the nightly adjustment job (api/cron/daily-coach), kept
// apart from Firestore so they can be tested.
//
// The job previously replaced an athlete's whole plan with a single workout:
// `customProgram` is read by the app as the ENTIRE program, and the job wrote
// `[adjusted workout]` for anyone who didn't already have one. It also treated
// every rest day as a missed session. Both mistakes are guarded here.

import { subDays } from 'date-fns';
import { calendarDayKey, toCalendarDay } from '@/lib/program-day';
import { getWorkoutForDay } from '@/lib/workout-utils';
import type { WorkoutDay } from '@/models/types';

/** Only athletes seen this recently are adjusted — rewriting a lapsed athlete's plan every night helps nobody. */
export const ACTIVE_WITHIN_DAYS = 10;

export interface DaySessionLite {
  workoutDate: Date;
  finishedAt: Date | null;
  skipped: boolean;
  workoutDetails?: WorkoutDay | null;
}

export interface AthleteDays {
  /** Runtime-local midnight of the athlete's today. */
  today: Date;
  yesterday: Date;
  todayKey: string;
  yesterdayKey: string;
}

export function athleteDays(now: Date, timeZone?: string): AthleteDays {
  const today = toCalendarDay(now, timeZone);
  const yesterday = subDays(today, 1);
  return {
    today,
    yesterday,
    todayKey: calendarDayKey(today),
    yesterdayKey: calendarDayKey(yesterday),
  };
}

/** Sessions whose workoutDate falls on `dayKey` in the athlete's zone. */
export function sessionsOnDay(sessions: DaySessionLite[], dayKey: string, timeZone?: string): DaySessionLite[] {
  return sessions.filter(s => calendarDayKey(s.workoutDate, timeZone) === dayKey);
}

/**
 * The workouts that were actually due on a day: persisted session docs win
 * (the calendar lets athletes move sessions between days), otherwise the
 * program's own schedule.
 */
export function plannedFor(
  program: { workouts: WorkoutDay[] },
  startDate: Date,
  day: Date,
  daySessions: DaySessionLite[],
  timeZone?: string,
): WorkoutDay[] {
  const persisted = daySessions.map(s => s.workoutDetails).filter((w): w is WorkoutDay => !!w);
  if (persisted.length > 0) return persisted;
  return getWorkoutForDay(program, startDate, day, timeZone).sessions;
}

/**
 * Did the athlete miss a session they were actually due to do yesterday?
 * A rest day is not a miss, and neither is a day with any finished session.
 */
export function missedYesterday(args: {
  program: { workouts: WorkoutDay[] };
  startDate: Date;
  days: AthleteDays;
  recentSessions: DaySessionLite[];
  timeZone?: string;
}): boolean {
  const { program, startDate, days, recentSessions, timeZone } = args;
  const trainedYesterday = recentSessions.some(
    s =>
      !!s.finishedAt &&
      !s.skipped &&
      (calendarDayKey(s.workoutDate, timeZone) === days.yesterdayKey ||
        calendarDayKey(s.finishedAt, timeZone) === days.yesterdayKey),
  );
  if (trainedYesterday) return false;

  const yesterdaySessions = sessionsOnDay(recentSessions, days.yesterdayKey, timeZone);
  const planned = plannedFor(program, startDate, days.yesterday, yesterdaySessions, timeZone);
  return planned.length > 0;
}

/**
 * The athlete's program with one day's workout replaced.
 *
 * Always starts from the full plan — the athlete's existing customisation if
 * they have one, otherwise a clone of the base program — so the result is a
 * complete program, never a single workout standing in for all of it.
 */
export function withAdjustment(
  baseWorkouts: WorkoutDay[],
  customProgram: WorkoutDay[] | null | undefined,
  adjustment: { day: number; originalTitle: string; modifiedWorkout: WorkoutDay },
): WorkoutDay[] {
  const workouts = customProgram && customProgram.length > 0 ? [...customProgram] : [...baseWorkouts];
  const replacement = { ...adjustment.modifiedWorkout, day: adjustment.day } as WorkoutDay;

  let index = workouts.findIndex(w => w.day === adjustment.day && w.title === adjustment.originalTitle);
  if (index === -1) index = workouts.findIndex(w => w.day === adjustment.day);

  if (index === -1) workouts.push(replacement);
  else workouts[index] = replacement;
  return workouts;
}

/** Recently active: seen in the app within ACTIVE_WITHIN_DAYS. */
export function isRecentlyActive(lastSeenAt: Date | null | undefined, now: Date): boolean {
  if (!lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() <= ACTIVE_WITHIN_DAYS * 86_400_000;
}
