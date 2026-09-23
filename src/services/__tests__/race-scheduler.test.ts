import { describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';

import { alignPlanToRace } from '@/services/race-scheduler';
import { programDayFor } from '@/lib/program-day';

const TODAY = new Date(2026, 8, 22, 15);
const plan = (days: number) => Array.from({ length: days }, (_, i) => ({ day: i + 1, title: `Day ${i + 1}` }));

describe('alignPlanToRace', () => {
  it('starts a shorter plan later so its last day is race day', () => {
    const race = addDays(new Date(2026, 8, 22), 75); // race is program day 76 if we started today
    const { workouts, startDate } = alignPlanToRace(plan(70), race, TODAY);
    expect(workouts).toHaveLength(70);
    expect(programDayFor(startDate, race)).toBe(70);
  });

  it('trims the opening days of a plan that is too long', () => {
    const race = addDays(new Date(2026, 8, 22), 59);
    const { workouts, startDate } = alignPlanToRace(plan(70), race, TODAY);
    expect(programDayFor(startDate, race)).toBe(60);
    expect(workouts.at(-1)).toEqual({ day: 60, title: 'Day 70' });
    expect(workouts[0]).toEqual({ day: 1, title: 'Day 11' });
  });
});
