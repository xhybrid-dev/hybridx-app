import { describe, expect, it } from 'vitest';

import {
  formatResult,
  lastResult,
  parseTime,
  personalBests,
  progressLines,
  resultKey,
} from '@/lib/exercise-results';
import type { ExerciseResult, WorkoutSession } from '@/models/types';

function session(id: string, day: number, results: ExerciseResult[], extra: Partial<WorkoutSession> = {}): WorkoutSession {
  const date = new Date(2026, 8, day);
  return {
    id,
    userId: 'a',
    programId: 'p',
    workoutDate: date,
    workoutTitle: 'Session',
    programType: 'hyrox',
    startedAt: date,
    finishedAt: date,
    results: Object.fromEntries(results.map(r => [resultKey(r.name), r])),
    ...extra,
  };
}

describe('parseTime', () => {
  it('reads mm:ss, h:mm:ss and bare minutes', () => {
    expect(parseTime('3:45')).toBe(225);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('4')).toBe(240);
    expect(parseTime('abc')).toBeUndefined();
  });
});

describe('formatResult', () => {
  it('reads like a training log', () => {
    expect(formatResult({ name: 'x', load: 100, reps: 8 })).toBe('100kg × 8');
    expect(formatResult({ name: 'x', distance: 1000, timeSeconds: 225 })).toBe('1.00km 3:45');
    expect(formatResult({ name: 'x', reps: 100 })).toBe('100 reps');
  });
});

describe('history', () => {
  const sessions = [
    session('s1', 1, [{ name: 'Sled Push', load: 100, reps: 4 }]),
    session('s2', 8, [{ name: 'sled push', load: 110, reps: 4 }]),
    session('s3', 15, [{ name: 'Sled Push', load: 110, reps: 6 }, { name: '1km Run', distance: 1000, timeSeconds: 250 }]),
    session('s4', 22, [{ name: '1km Run', distance: 1000, timeSeconds: 240 }]),
    session('skip', 23, [{ name: 'Sled Push', load: 200 }], { skipped: true }),
  ];

  it('finds last time regardless of capitalisation, ignoring skips', () => {
    expect(lastResult(sessions, 'SLED PUSH')?.load).toBe(110);
    expect(lastResult(sessions, 'Sled Push', 's3')?.reps).toBe(4);
  });

  it('spots heavier loads, more reps at a best load, and faster times', () => {
    expect(personalBests(sessions[1], sessions).map(b => b.label)).toEqual(['110kg (was 100kg)']);
    expect(personalBests(sessions[2], sessions).map(b => b.label)).toEqual(['110kg × 6 (was × 4)']);
    expect(personalBests(sessions[3], sessions).map(b => b.label)).toEqual(['4:00 (was 4:10)']);
  });

  it('treats a first result as a baseline, not a record', () => {
    expect(personalBests(sessions[0], sessions)).toEqual([]);
  });

  it('builds progress lines with improvement in the right direction', () => {
    const lines = progressLines(sessions);
    const sled = lines.find(l => l.name === 'Sled Push')!;
    const run = lines.find(l => l.name === '1km Run')!;
    expect(sled).toMatchObject({ metric: 'load', first: 100, latest: 110, improvement: 10 });
    expect(run).toMatchObject({ metric: 'time', first: 250, latest: 240, improvement: 10 });
  });
});
