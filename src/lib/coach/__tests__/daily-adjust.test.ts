import { describe, expect, it } from 'vitest';

import {
  athleteDays,
  isRecentlyActive,
  missedYesterday,
  withAdjustment,
  type DaySessionLite,
} from '@/lib/coach/daily-adjust';
import type { WorkoutDay } from '@/models/types';

const UK = 'Europe/London';

function workout(day: number, title: string): WorkoutDay {
  return { day, title, programType: 'hyrox', exercises: [{ name: 'Wall balls', details: '3x20' }] } as WorkoutDay;
}

// Day 2 is a rest day: the program simply has no entry for it.
const BASE = [workout(1, 'Engine'), workout(3, 'Strength'), workout(4, 'Hybrid'), workout(5, 'Long run')];
const START = new Date('2026-09-01T12:00:00.000Z'); // Tue 1 Sept, UK afternoon

/** A session dated to the athlete's local midnight, as the browser stores it. */
function ukMarker(isoDate: string): Date {
  // BST: local midnight is 23:00 UTC the evening before.
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return new Date(d.getTime() - 3_600_000);
}

function check(now: Date, recentSessions: DaySessionLite[] = []) {
  return missedYesterday({
    program: { workouts: BASE },
    startDate: START,
    days: athleteDays(now, UK),
    recentSessions,
    timeZone: UK,
  });
}

describe('missedYesterday', () => {
  const FRIDAY_6AM = new Date('2026-09-04T05:00:00.000Z'); // day 4; yesterday was day 3 (Strength)

  it('flags a scheduled session with nothing logged', () => {
    expect(check(FRIDAY_6AM)).toBe(true);
  });

  it('does not treat a rest day as a miss', () => {
    const THURSDAY_6AM = new Date('2026-09-03T05:00:00.000Z'); // yesterday was day 2, a rest day
    expect(check(THURSDAY_6AM)).toBe(false);
  });

  it('does not flag an athlete who finished yesterday', () => {
    const done: DaySessionLite = {
      workoutDate: ukMarker('2026-09-03'),
      finishedAt: new Date('2026-09-03T17:30:00.000Z'),
      skipped: false,
      workoutDetails: BASE[1],
    };
    expect(check(FRIDAY_6AM, [done])).toBe(false);
  });

  it('counts an explicit skip as a miss', () => {
    const skipped: DaySessionLite = {
      workoutDate: ukMarker('2026-09-03'),
      finishedAt: new Date('2026-09-03T17:30:00.000Z'),
      skipped: true,
      workoutDetails: BASE[1],
    };
    expect(check(FRIDAY_6AM, [skipped])).toBe(true);
  });

  it('honours a session the athlete moved onto a rest day', () => {
    const THURSDAY_6AM = new Date('2026-09-03T05:00:00.000Z');
    const moved: DaySessionLite = {
      workoutDate: ukMarker('2026-09-02'),
      finishedAt: null,
      skipped: false,
      workoutDetails: BASE[1],
    };
    expect(check(THURSDAY_6AM, [moved])).toBe(true);
  });
});

describe('withAdjustment', () => {
  const eased = workout(4, 'Hybrid (eased)');

  it('clones the full base plan when the athlete has no customisation', () => {
    const result = withAdjustment(BASE, null, { day: 4, originalTitle: 'Hybrid', modifiedWorkout: eased });
    expect(result).toHaveLength(BASE.length);
    expect(result.find(w => w.day === 4)?.title).toBe('Hybrid (eased)');
    expect(result.find(w => w.day === 5)?.title).toBe('Long run');
  });

  it('treats an empty customProgram like none at all', () => {
    const result = withAdjustment(BASE, [], { day: 4, originalTitle: 'Hybrid', modifiedWorkout: eased });
    expect(result).toHaveLength(BASE.length);
  });

  it('builds on an existing customisation rather than the base plan', () => {
    const custom = [workout(1, 'Custom A'), workout(4, 'Custom B')];
    const result = withAdjustment(BASE, custom, { day: 4, originalTitle: 'Custom B', modifiedWorkout: eased });
    expect(result.map(w => w.title)).toEqual(['Custom A', 'Hybrid (eased)']);
  });

  it('replaces only the matching session on a two-session day', () => {
    const twoSessions = [...BASE, workout(4, 'Easy run')];
    const easedRun = workout(4, 'Easy run (shorter)');
    const result = withAdjustment(twoSessions, null, { day: 4, originalTitle: 'Easy run', modifiedWorkout: easedRun });
    expect(result.filter(w => w.day === 4).map(w => w.title)).toEqual(['Hybrid', 'Easy run (shorter)']);
  });

  it('does not mutate its inputs', () => {
    const base = [...BASE];
    withAdjustment(base, null, { day: 4, originalTitle: 'Hybrid', modifiedWorkout: eased });
    expect(base).toEqual(BASE);
  });
});

describe('isRecentlyActive', () => {
  const now = new Date('2026-09-22T06:00:00.000Z');
  it('accepts someone seen this week', () => {
    expect(isRecentlyActive(new Date('2026-09-18T06:00:00.000Z'), now)).toBe(true);
  });
  it('rejects someone gone a fortnight, or never seen', () => {
    expect(isRecentlyActive(new Date('2026-09-05T06:00:00.000Z'), now)).toBe(false);
    expect(isRecentlyActive(undefined, now)).toBe(false);
  });
});
