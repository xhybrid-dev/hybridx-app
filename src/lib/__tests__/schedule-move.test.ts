import { describe, expect, it } from 'vitest';

import { moveSession, type MovableDay } from '@/lib/schedule-move';
import type { WorkoutDay } from '@/models/types';

const w = (title: string) => ({ day: 1, title, programType: 'hyrox', exercises: [] }) as unknown as WorkoutDay;
const titles = (days: MovableDay[] | null, key: string) =>
  days?.find(day => day.dateKey === key)?.workouts.map(workout => workout.title);

describe('moveSession', () => {
  const week = (): MovableDay[] => [
    { dateKey: 'mon', workouts: [w('Engine Builder')], isPast: true },
    { dateKey: 'tue', workouts: [w('Threshold Run')], isPast: false },
    { dateKey: 'wed', workouts: [w('Strength A')], isPast: false },
    { dateKey: 'thu', workouts: [w('Rest')], isPast: false },
  ];

  it("moves yesterday's missed session to today without pushing today's back into the past", () => {
    const next = moveSession(week(), 'mon', 0, 'tue');

    expect(titles(next, 'tue')).toEqual(['Threshold Run', 'Engine Builder']);
    expect(titles(next, 'mon')).toEqual([]);
  });

  it('still swaps one-for-one between two days that are both ahead', () => {
    const next = moveSession(week(), 'tue', 0, 'wed');

    expect(titles(next, 'tue')).toEqual(['Strength A']);
    expect(titles(next, 'wed')).toEqual(['Threshold Run']);
  });

  it('replaces a rest placeholder rather than sitting beside it', () => {
    expect(titles(moveSession(week(), 'mon', 0, 'thu'), 'thu')).toEqual(['Engine Builder']);
  });

  it('never moves anything into the past', () => {
    expect(moveSession(week(), 'tue', 0, 'mon')).toBeNull();
  });

  it('ignores a drop on the same day or a session that is not there', () => {
    expect(moveSession(week(), 'tue', 0, 'tue')).toBeNull();
    expect(moveSession(week(), 'tue', 3, 'wed')).toBeNull();
    expect(moveSession(week(), 'fri', 0, 'wed')).toBeNull();
  });
});
