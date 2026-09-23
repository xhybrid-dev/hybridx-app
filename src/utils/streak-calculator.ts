// src/utils/streak-calculator.ts
//
// The streak counts consecutive WEEKS in which the athlete hit their weekly
// training target, not consecutive days. A daily streak reset on every rest
// day, so an athlete following a 3–5 day plan exactly could never get past a
// few days, and "keep the streak alive" nudged people to skip recovery.
import { WorkoutSession } from '@/models/types';
import { startOfWeek, subDays, subWeeks, format } from 'date-fns';

export interface StreakData {
  /** Consecutive weeks meeting the weekly target (the current week counts once met, and never breaks it while in progress). */
  currentStreak: number;
  longestStreak: number;
  totalWorkouts: number;
  /** Training days so far this week (Monday start). */
  thisWeekWorkouts: number;
  thisMonthWorkouts: number;
  /** Training days a week that count as a week "hit". */
  weeklyTarget: number;
}

export const DEFAULT_WEEKLY_TARGET = 3;

const weekKey = (date: Date) => format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

export function calculateStreakData(
  sessions: WorkoutSession[],
  options: { weeklyTarget?: number; now?: Date } = {},
): StreakData {
  const weeklyTarget = Math.max(1, Math.round(options.weeklyTarget ?? DEFAULT_WEEKLY_TARGET));
  const now = options.now ?? new Date();
  const completed = sessions.filter(s => s.finishedAt && !s.skipped);

  // A day with several finished sub-workouts (Run + Strength) is one training day.
  const daysByWeek = new Map<string, Set<string>>();
  for (const session of completed) {
    const week = weekKey(session.workoutDate);
    const days = daysByWeek.get(week) ?? new Set<string>();
    days.add(dayKey(session.workoutDate));
    daysByWeek.set(week, days);
  }
  const hit = (week: string) => (daysByWeek.get(week)?.size ?? 0) >= weeklyTarget;

  const thisWeek = weekKey(now);
  let currentStreak = hit(thisWeek) ? 1 : 0;
  for (let back = 1; ; back++) {
    if (!hit(weekKey(subWeeks(now, back)))) break;
    currentStreak++;
  }

  let longestStreak = 0;
  const hitWeeks = [...daysByWeek.keys()].filter(hit).sort();
  let run = 0;
  let previous: string | null = null;
  for (const week of hitWeeks) {
    const expected = previous ? weekKey(subDays(new Date(`${week}T12:00:00`), 7)) : null;
    run = previous && expected === previous ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = week;
  }

  const oneMonthAgo = subDays(now, 30);
  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    totalWorkouts: completed.length,
    thisWeekWorkouts: daysByWeek.get(thisWeek)?.size ?? 0,
    thisMonthWorkouts: completed.filter(s => s.workoutDate >= oneMonthAgo).length,
    weeklyTarget,
  };
}
