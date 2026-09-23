import { describe, expect, it } from 'vitest';

import {
  calendarDayKey,
  normaliseTimeZone,
  programDayFor,
  toCalendarDay,
} from '@/lib/program-day';
import { getWorkoutForDay } from '@/lib/workout-utils';
import type { Program, WorkoutDay } from '@/models/types';

const UK = 'Europe/London';

// The two kinds of value that get stored, for a UK athlete in September (BST):
//
//   a DAY MARKER  — workoutDate, written as their local midnight.
//   an INSTANT    — startDate, written as `new Date()` when they picked the
//                   program. Typically mid-afternoon.
//
// Read in UTC the marker falls back a day and the instant does not, which is
// why no single offset-guessing rule fixes both.
const TODAYS_SESSION_MARKER = new Date('2026-09-07T23:00:00.000Z'); // Tue 8 Sept, UK
const START_INSTANT = new Date('2026-06-02T13:37:00.000Z'); // Tue 2 June, 14:37 BST

describe('calendarDayKey', () => {
  it('reads a local-midnight day marker as the day the athlete means', () => {
    expect(calendarDayKey(TODAYS_SESSION_MARKER, UK)).toBe('2026-09-08');
  });

  it('reads a mid-afternoon instant as that same afternoon, not the next day', () => {
    // Rounding to the nearest midnight would call this 3 June and start the
    // program a day late.
    expect(calendarDayKey(START_INSTANT, UK)).toBe('2026-06-02');
  });

  it('works either side of UTC', () => {
    const evening = new Date('2026-09-08T23:30:00.000Z');
    expect(calendarDayKey(evening, 'Europe/London')).toBe('2026-09-09'); // +1, past midnight
    expect(calendarDayKey(evening, 'America/New_York')).toBe('2026-09-08'); // -4, still evening
    expect(calendarDayKey(evening, 'Asia/Kolkata')).toBe('2026-09-09'); // +5:30
    expect(calendarDayKey(evening, 'Pacific/Auckland')).toBe('2026-09-09'); // +12/+13
  });
});

describe('normaliseTimeZone', () => {
  it('accepts a real zone and rejects anything else', () => {
    expect(normaliseTimeZone('Europe/London')).toBe('Europe/London');
    expect(normaliseTimeZone('Not/AZone')).toBeUndefined();
    expect(normaliseTimeZone('')).toBeUndefined();
    expect(normaliseTimeZone(null)).toBeUndefined();
    expect(normaliseTimeZone('x'.repeat(200))).toBeUndefined();
  });
});

describe('toCalendarDay', () => {
  it('pins a marker to midnight of the athlete\'s day, in the runtime\'s zone', () => {
    const pinned = toCalendarDay(TODAYS_SESSION_MARKER, UK);
    // Local fields, because date-fns comparisons downstream read local fields.
    expect(pinned.getFullYear()).toBe(2026);
    expect(pinned.getMonth()).toBe(8);
    expect(pinned.getDate()).toBe(8);
    expect(pinned.getHours()).toBe(0);
  });
});

describe('programDayFor', () => {
  // The target is the calendar day being asked about, resolved by the caller.
  const day = (instant: string) => toCalendarDay(new Date(instant), UK);

  it('counts the start date itself as day 1, from a mid-afternoon instant', () => {
    expect(programDayFor(START_INSTANT, day('2026-06-02T08:00:00Z'), UK)).toBe(1);
    // Late evening UTC is already tomorrow in the UK, and is counted as such.
    expect(programDayFor(START_INSTANT, day('2026-06-02T23:30:00Z'), UK)).toBe(2);
  });

  it('is negative before the program starts', () => {
    expect(programDayFor(START_INSTANT, day('2026-05-30T12:00:00Z'), UK)).toBeLessThan(1);
  });

  it('does not re-zone a target the caller already resolved', () => {
    // The contract: startDate carries the zone, the target does not. Applying
    // the zone to both double-converts and lands a day out whenever the code
    // runs somewhere other than where the athlete is — which is always, on the
    // server. This assertion holds in any runtime zone.
    const today = toCalendarDay(new Date('2026-09-08T09:00:00Z'), UK);
    expect(programDayFor(START_INSTANT, today, UK)).toBe(99);
  });
});

describe('getWorkoutForDay', () => {
  const workout = (day: number, title: string): WorkoutDay =>
    ({ day, title, programType: 'hyrox', exercises: [{ name: 'Sled Push', details: '4x20m' }] } as unknown as WorkoutDay);

  // Day 99 is a double — a run and a gym session. Day 100 has no entry: rest.
  const program: Program = {
    id: 'p1',
    name: 'Hyrox Fusion Balance',
    description: '',
    programType: 'hyrox',
    workouts: [workout(98, 'Easy Run'), workout(99, 'Threshold Run'), workout(99, 'Lower Body')],
  };

  // Tue 8 September for the athlete — day 99, having started on 2 June. The
  // caller resolves the day; getWorkoutForDay reads it runtime-locally.
  const nowInstant = toCalendarDay(new Date('2026-09-08T09:00:00.000Z'), UK);

  it('finds the double session scheduled for today, not the rest day after it', () => {
    // The reported bug: resolved on the server without a zone, this came back
    // as day 100 and the athlete was told they had a rest day.
    const { day, sessions } = getWorkoutForDay(program, START_INSTANT, nowInstant, UK);

    expect(day).toBe(99);
    expect(sessions.map(s => s.title)).toEqual(['Threshold Run', 'Lower Body']);
  });

  it('gives the same answer wherever the code happens to be running', () => {
    // The point of passing a zone: the server (UTC) and the athlete's browser
    // must agree, and this is the assertion that holds them together.
    const day = getWorkoutForDay(program, START_INSTANT, nowInstant, UK).day;
    expect(day).toBe(99);
  });

  it('reports a genuine rest day as one', () => {
    const tomorrow = toCalendarDay(new Date('2026-09-09T09:00:00.000Z'), UK);
    const { day, sessions } = getWorkoutForDay(program, START_INSTANT, tomorrow, UK);
    expect(day).toBe(100);
    expect(sessions).toHaveLength(0);
  });

  it('still works with no zone, for browser callers in the athlete\'s own zone', () => {
    // Local dates, as a browser would pass them.
    const localStart = new Date(2026, 5, 2, 14, 37);
    const localToday = new Date(2026, 8, 8, 10, 0);
    expect(getWorkoutForDay(program, localStart, localToday).day).toBe(99);
  });
});
