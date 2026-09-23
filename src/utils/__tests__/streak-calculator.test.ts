import { describe, it, expect } from 'vitest';
import { calculateStreakData } from '../streak-calculator';
import type { WorkoutSession } from '@/models/types';

function makeSession(overrides: Partial<WorkoutSession> & { workoutDate: Date }): WorkoutSession {
  return {
    id: Math.random().toString(36),
    userId: 'user-1',
    programId: 'program-1',
    workoutTitle: 'Workout',
    programType: 'hyrox',
    startedAt: overrides.workoutDate,
    finishedAt: overrides.workoutDate,
    skipped: false,
    ...overrides,
  };
}

// Wednesday 23 September 2026, midday. Weeks start on Monday.
const NOW = new Date(2026, 8, 23, 12);
const on = (month: number, day: number) => new Date(2026, month - 1, day, 12);

/** Mon/Wed/Fri of the week starting on `monday` (a September date). */
const threeDayWeek = (monday: number) => [on(9, monday), on(9, monday + 2), on(9, monday + 4)].map(d => makeSession({ workoutDate: d }));

describe('calculateStreakData', () => {
  it('counts weeks that hit the target, so rest days never break it', () => {
    const sessions = [...threeDayWeek(7), ...threeDayWeek(14)];
    const streak = calculateStreakData(sessions, { weeklyTarget: 3, now: NOW });
    expect(streak.currentStreak).toBe(2);
    expect(streak.longestStreak).toBe(2);
  });

  it('does not break the streak while the current week is still in progress', () => {
    const sessions = [...threeDayWeek(7), ...threeDayWeek(14), makeSession({ workoutDate: on(9, 21) })];
    const streak = calculateStreakData(sessions, { weeklyTarget: 3, now: NOW });
    expect(streak.currentStreak).toBe(2);
    expect(streak.thisWeekWorkouts).toBe(1);
  });

  it('adds the current week once it is hit', () => {
    const sessions = [...threeDayWeek(14), ...threeDayWeek(21).slice(0, 2), makeSession({ workoutDate: on(9, 22) })];
    const streak = calculateStreakData(sessions, { weeklyTarget: 3, now: NOW });
    expect(streak.currentStreak).toBe(2);
  });

  it('breaks on a week that fell short', () => {
    const sessions = [...threeDayWeek(7), makeSession({ workoutDate: on(9, 15) }), ...threeDayWeek(21)];
    const streak = calculateStreakData(sessions, { weeklyTarget: 3, now: NOW });
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(1);
  });

  it('counts a two-session day as one training day toward the target', () => {
    const sessions = [
      makeSession({ workoutDate: on(9, 14), sessionIndex: 0, sessionCount: 2, workoutTitle: 'Easy Run' }),
      makeSession({ workoutDate: on(9, 14), sessionIndex: 1, sessionCount: 2, workoutTitle: 'Strength' }),
      makeSession({ workoutDate: on(9, 16) }),
    ];
    const streak = calculateStreakData(sessions, { weeklyTarget: 3, now: NOW });
    expect(streak.currentStreak).toBe(0);
    expect(streak.totalWorkouts).toBe(3);
  });

  it('ignores skipped sessions', () => {
    const sessions = [
      ...threeDayWeek(14).slice(0, 2),
      makeSession({ workoutDate: on(9, 18), skipped: true }),
    ];
    expect(calculateStreakData(sessions, { weeklyTarget: 3, now: NOW }).currentStreak).toBe(0);
  });

  it('remembers the longest run of weeks across a gap', () => {
    // Weeks of 24 Aug, 31 Aug and 7 Sep hit; 14 Sep missed; 21 Sep hit.
    const earlier = [on(8, 24), on(8, 26), on(8, 28), on(8, 31), on(9, 2), on(9, 4)].map(d => makeSession({ workoutDate: d }));
    const streak = calculateStreakData([...earlier, ...threeDayWeek(7), ...threeDayWeek(21)], { weeklyTarget: 3, now: NOW });
    expect(streak.longestStreak).toBe(3);
    expect(streak.currentStreak).toBe(1);
  });
});
