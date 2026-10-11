import { describe, expect, it } from 'vitest';

import { getScheduledWorkoutsForDay } from '@/lib/workout-utils';
import type { WorkoutDay, WorkoutSession } from '@/models/types';

const w = (day: number, title: string) => ({ day, title, programType: 'hyrox', exercises: [] }) as unknown as WorkoutDay;
const program = { workouts: [w(1, 'Threshold Run'), w(2, 'Strength A')] };
const start = new Date(2026, 9, 5);
const session = (date: Date, extra: Partial<WorkoutSession>) =>
  ({ id: 's', userId: 'u', programId: 'prog', workoutDate: date, workoutTitle: 'x', programType: 'hyrox', startedAt: date, ...extra }) as WorkoutSession;

describe('getScheduledWorkoutsForDay', () => {
  const tuesday = new Date(2026, 9, 6);

  it("falls back to the program's default when nothing is saved for the day", () => {
    expect(getScheduledWorkoutsForDay(program, start, tuesday, []).map(x => x.title)).toEqual(['Strength A']);
  });

  it('shows a session moved onto the day instead of the default', () => {
    const moved = session(tuesday, { workoutDetails: w(1, 'Threshold Run') as WorkoutSession['workoutDetails'] });
    expect(getScheduledWorkoutsForDay(program, start, tuesday, [moved]).map(x => x.title)).toEqual(['Threshold Run']);
  });

  it('shows nothing on a day the athlete cleared', () => {
    const marker = session(tuesday, { workoutDetails: undefined, sessionCount: 0 });
    expect(getScheduledWorkoutsForDay(program, start, tuesday, [marker])).toEqual([]);
  });

  it('does not let a one-off workout hide the plan for the day', () => {
    const oneOff = session(tuesday, { programId: 'one-off-ai', workoutDetails: w(0, 'AI Workout') as WorkoutSession['workoutDetails'] });
    expect(getScheduledWorkoutsForDay(program, start, tuesday, [oneOff]).map(x => x.title)).toEqual(['Strength A']);
  });
});
