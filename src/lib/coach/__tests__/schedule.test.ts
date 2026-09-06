import { describe, expect, it } from 'vitest';
import { addDays, subDays } from 'date-fns';

import { buildSchedule } from '@/services/coach-context';
import type { Program, WorkoutDay, WorkoutSession } from '@/models/types';

const TODAY = new Date(2026, 8, 3, 12, 0, 0);
const START = subDays(TODAY, 2); // program day 3 is today

function workout(day: number, title: string): WorkoutDay {
  return {
    day,
    title,
    programType: 'hyrox',
    exercises: [{ name: 'Sled Push', details: '4x20m' }],
  } as unknown as WorkoutDay;
}

const program: Program = {
  id: 'p1',
  name: 'Fusion Balance',
  description: 'Balanced run/strength',
  programType: 'hyrox',
  workouts: [workout(1, 'Strength'), workout(3, 'Engine Builder'), workout(4, 'Long Run')],
};

function session(overrides: Partial<WorkoutSession> & { workoutDate: Date }): WorkoutSession {
  return {
    id: Math.random().toString(36).slice(2),
    userId: 'athlete-1',
    programId: 'p1',
    workoutTitle: 'Engine Builder',
    programType: 'hyrox',
    startedAt: overrides.workoutDate,
    workoutDetails: workout(3, 'Engine Builder'),
    ...overrides,
  };
}

describe('buildSchedule', () => {
  it('falls back to the program on days with no session doc', () => {
    const days = buildSchedule(TODAY, addDays(TODAY, 1), [], program, START, TODAY);

    expect(days).toHaveLength(2);
    expect(days[0].programDay).toBe(3);
    expect(days[0].sessions[0].title).toBe('Engine Builder');
    expect(days[0].sessions[0].status).toBe('planned');
    expect(days[1].sessions[0].title).toBe('Long Run');
  });

  it('lets a saved session override the program schedule for that day', () => {
    const days = buildSchedule(
      TODAY,
      TODAY,
      [
        session({
          workoutDate: TODAY,
          workoutTitle: 'Deload Engine Builder',
          workoutDetails: workout(3, 'Deload Engine Builder'),
          notes: 'shortened it, calf tight',
          finishedAt: TODAY,
        }),
      ],
      program,
      START,
      TODAY,
    );

    expect(days[0].sessions).toHaveLength(1);
    expect(days[0].sessions[0].title).toBe('Deload Engine Builder');
    expect(days[0].sessions[0].status).toBe('completed');
    expect(days[0].sessions[0].notes).toBe('shortened it, calf tight');
  });

  it('treats a cleared day as rest rather than reviving the program default', () => {
    const days = buildSchedule(
      TODAY,
      TODAY,
      [session({ workoutDate: TODAY, workoutTitle: 'Rest', workoutDetails: undefined })],
      program,
      START,
      TODAY,
    );

    expect(days[0].sessions).toHaveLength(0);
  });

  it('orders multiple sessions on one day by their session index', () => {
    const days = buildSchedule(
      TODAY,
      TODAY,
      [
        session({ workoutDate: TODAY, workoutTitle: 'Evening Run', sessionIndex: 1 }),
        session({ workoutDate: TODAY, workoutTitle: 'Morning Strength', sessionIndex: 0 }),
      ],
      program,
      START,
      TODAY,
    );

    expect(days[0].sessions.map(s => s.title)).toEqual(['Morning Strength', 'Evening Run']);
  });

  it('still returns days when the athlete has no program', () => {
    const days = buildSchedule(TODAY, addDays(TODAY, 2), [], null, undefined, TODAY);
    expect(days).toHaveLength(3);
    expect(days.every(day => day.sessions.length === 0)).toBe(true);
  });
});
