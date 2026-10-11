import { describe, expect, it } from 'vitest';

import { entriesToSave, entryFromSession, moveSession, type MovableDay, type ScheduleEntry } from '@/lib/schedule-move';
import type { WorkoutDay, WorkoutSession } from '@/models/types';

const w = (title: string) => ({ day: 1, title, programType: 'hyrox', exercises: [] }) as unknown as WorkoutDay;
const e = (title: string, extra: Partial<ScheduleEntry> = {}): ScheduleEntry => ({ workout: w(title), ...extra });
const titles = (days: MovableDay[] | null, key: string) =>
  days?.find(day => day.dateKey === key)?.entries.map(entry => entry.workout.title);

describe('moveSession', () => {
  const week = (): MovableDay[] => [
    { dateKey: 'mon', entries: [e('Engine Builder')], isPast: true },
    { dateKey: 'tue', entries: [e('Threshold Run')], isPast: false },
    { dateKey: 'wed', entries: [e('Strength A')], isPast: false },
    { dateKey: 'thu', entries: [e('Rest')], isPast: false },
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

  it('carries the session doc id with the moved session', () => {
    const days = week();
    days[1].entries = [e('Threshold Run', { sessionId: 'doc-tue' })];

    const next = moveSession(days, 'tue', 0, 'wed');

    expect(next?.find(day => day.dateKey === 'wed')?.entries[0].sessionId).toBe('doc-tue');
  });

  it('refuses to move a finished session', () => {
    const days = week();
    days[1].entries = [e('Threshold Run', { locked: true })];

    expect(moveSession(days, 'tue', 0, 'wed')).toBeNull();
  });

  it("joins today's finished session instead of swapping it onto another day", () => {
    const days = week();
    days[1].entries = [e('Threshold Run', { locked: true })];

    const next = moveSession(days, 'wed', 0, 'tue');

    expect(titles(next, 'tue')).toEqual(['Threshold Run', 'Strength A']);
    expect(titles(next, 'wed')).toEqual([]);
  });
});

describe('entriesToSave', () => {
  it('leaves logged extra activity out of a save and keeps doc ids on the rest', () => {
    expect(entriesToSave([
      e('AI Workout', { sessionId: 'one-off', locked: true, adHoc: true }),
      e('Threshold Run', { sessionId: 'doc-1' }),
      e('Strength A'),
    ])).toEqual([
      { workout: w('Threshold Run'), sessionId: 'doc-1' },
      { workout: w('Strength A') },
    ]);
  });
});

describe('entryFromSession', () => {
  const session = (extra: Partial<WorkoutSession>) => ({ id: 's1', programId: 'prog', ...extra }) as WorkoutSession;

  it('locks finished sessions and ad-hoc ones, but not an open program session', () => {
    expect(entryFromSession(session({}), w('A'))).toMatchObject({ sessionId: 's1', locked: false, adHoc: false });
    expect(entryFromSession(session({ finishedAt: new Date() }), w('A'))).toMatchObject({ locked: true, adHoc: false });
    expect(entryFromSession(session({ programId: 'one-off-ai' }), w('A'))).toMatchObject({ locked: true, adHoc: true });
  });
});
