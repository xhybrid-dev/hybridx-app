import { describe, expect, it } from 'vitest';

import { planScheduleWrites, type ExistingSessionDoc } from '@/lib/schedule-save';
import type { WorkoutDay } from '@/models/types';

const w = (title: string) => ({ day: 1, title, programType: 'hyrox', exercises: [] }) as unknown as WorkoutDay;
const doc = (id: string, dateKey: string, title: string | null, extra: Partial<ExistingSessionDoc> = {}): ExistingSessionDoc => ({
  id, dateKey, title, finished: false, sessionIndex: 0, sessionCount: title === null ? 0 : 1, ...extra,
});

describe('planScheduleWrites', () => {
  it('swaps two saved sessions by moving their docs, not by copying content between them', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [{ workout: w('Strength A'), sessionId: 'b' }] },
        { dateKey: 'wed', entries: [{ workout: w('Threshold Run'), sessionId: 'a' }] },
      ],
      [doc('a', 'tue', 'Threshold Run'), doc('b', 'wed', 'Strength A')],
    );

    expect(writes).toEqual([
      { type: 'keep', id: 'b', dateKey: 'tue', moved: true, sessionIndex: 0, sessionCount: 1 },
      { type: 'keep', id: 'a', dateKey: 'wed', moved: true, sessionIndex: 0, sessionCount: 1 },
    ]);
  });

  it('creates docs for program defaults the page never saw saved', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [{ workout: w('Strength A') }] },
        { dateKey: 'wed', entries: [{ workout: w('Threshold Run') }] },
      ],
      [],
    );

    expect(writes).toEqual([
      { type: 'create', dateKey: 'tue', workout: w('Strength A'), sessionIndex: 0, sessionCount: 1 },
      { type: 'create', dateKey: 'wed', workout: w('Threshold Run'), sessionIndex: 0, sessionCount: 1 },
    ]);
  });

  it('marks a day emptied by a move as cleared, reusing its old marker when it has one', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [] },
        { dateKey: 'wed', entries: [{ workout: w('Threshold Run'), sessionId: 'a' }] },
      ],
      [doc('a', 'tue', 'Threshold Run'), doc('m', 'wed', null)],
    );

    expect(writes).toEqual([
      { type: 'marker', dateKey: 'tue', id: undefined },
      { type: 'keep', id: 'a', dateKey: 'wed', moved: true, sessionIndex: 0, sessionCount: 1 },
      { type: 'delete', id: 'm' },
    ]);
  });

  it('replaces a rest placeholder doc on the target day', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [] },
        { dateKey: 'thu', entries: [{ workout: w('Threshold Run'), sessionId: 'a' }] },
      ],
      [doc('a', 'tue', 'Threshold Run'), doc('rest', 'thu', 'Rest')],
    );

    expect(writes).toContainEqual({ type: 'delete', id: 'rest' });
    expect(writes).toContainEqual({ type: 'keep', id: 'a', dateKey: 'thu', moved: true, sessionIndex: 0, sessionCount: 1 });
  });

  it('never moves a finished doc, even when a stale page asks it to', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [] },
        { dateKey: 'wed', entries: [{ workout: w('Threshold Run'), sessionId: 'a' }] },
      ],
      [doc('a', 'tue', 'Threshold Run', { finished: true })],
    );

    // Tuesday keeps its finished doc where it was (nothing to rewrite), Wednesday is cleared.
    expect(writes).toEqual([{ type: 'marker', dateKey: 'wed', id: undefined }]);
  });

  it('keeps a finished doc the page did not list, after the day’s other sessions', () => {
    const writes = planScheduleWrites(
      [{ dateKey: 'tue', entries: [{ workout: w('Strength A') }] }],
      [doc('done', 'tue', 'Morning Run', { finished: true })],
    );

    expect(writes).toEqual([
      { type: 'create', dateKey: 'tue', workout: w('Strength A'), sessionIndex: 0, sessionCount: 2 },
      { type: 'keep', id: 'done', dateKey: 'tue', moved: false, sessionIndex: 1, sessionCount: 2 },
    ]);
  });

  it('adopts a same-day doc with the same title instead of duplicating it', () => {
    // The page loaded before the dashboard seeded today's doc for this session.
    const writes = planScheduleWrites(
      [{ dateKey: 'tue', entries: [{ workout: w('Threshold Run') }, { workout: w('Strength A'), sessionId: 'b' }] }],
      [doc('seeded', 'tue', 'Threshold Run'), doc('b', 'wed', 'Strength A')],
    );

    expect(writes).toEqual([
      { type: 'keep', id: 'seeded', dateKey: 'tue', moved: false, sessionIndex: 0, sessionCount: 2 },
      { type: 'keep', id: 'b', dateKey: 'tue', moved: true, sessionIndex: 1, sessionCount: 2 },
    ]);
  });

  it('lets a later day claim a doc by id before an earlier day can adopt it by title', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [{ workout: w('Easy Run') }] },
        { dateKey: 'wed', entries: [{ workout: w('Easy Run'), sessionId: 'x' }] },
      ],
      [doc('x', 'tue', 'Easy Run')],
    );

    expect(writes).toEqual([
      { type: 'create', dateKey: 'tue', workout: w('Easy Run'), sessionIndex: 0, sessionCount: 1 },
      { type: 'keep', id: 'x', dateKey: 'wed', moved: true, sessionIndex: 0, sessionCount: 1 },
    ]);
  });

  it('ignores an id it did not read, rather than writing to someone else’s doc', () => {
    const writes = planScheduleWrites(
      [{ dateKey: 'tue', entries: [{ workout: w('Threshold Run'), sessionId: 'not-yours' }] }],
      [],
    );

    expect(writes).toEqual([
      { type: 'create', dateKey: 'tue', workout: w('Threshold Run'), sessionIndex: 0, sessionCount: 1 },
    ]);
  });

  it('turns a day cleared of content into a fresh marker and drops the old docs', () => {
    const writes = planScheduleWrites(
      [{ dateKey: 'tue', entries: [] }],
      [doc('a', 'tue', 'Threshold Run')],
    );

    expect(writes).toEqual([
      { type: 'marker', dateKey: 'tue', id: undefined },
      { type: 'delete', id: 'a' },
    ]);
  });

  it('writes nothing for a doc that stays put in the same slot', () => {
    const writes = planScheduleWrites(
      [
        { dateKey: 'tue', entries: [{ workout: w('Threshold Run'), sessionId: 'a' }, { workout: w('Strength A'), sessionId: 'b' }] },
        { dateKey: 'wed', entries: [] },
      ],
      [doc('a', 'tue', 'Threshold Run', { sessionCount: 2 }), doc('b', 'wed', 'Strength A')],
    );

    expect(writes).toEqual([
      { type: 'keep', id: 'b', dateKey: 'tue', moved: true, sessionIndex: 1, sessionCount: 2 },
      { type: 'marker', dateKey: 'wed', id: undefined },
    ]);
  });
});
