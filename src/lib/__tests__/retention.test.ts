import { describe, expect, it } from 'vitest';

import { computeRetention } from '@/lib/retention';

const DAY = 86_400_000;
const now = new Date('2026-09-22T12:00:00.000Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe('computeRetention', () => {
  const signups = [
    { userId: 'a', signedUpAt: ago(20) },
    { userId: 'b', signedUpAt: ago(20) },
    { userId: 'c', signedUpAt: ago(1) }, // too new to judge activation
  ];
  const workouts = [
    { userId: 'a', finishedAt: ago(19) }, // within 72h, week 0
    { userId: 'a', finishedAt: ago(10) }, // week 1
    { userId: 'b', finishedAt: ago(5) }, // week 2 only
  ];
  const report = computeRetention(signups, workouts, now, 4);

  it('counts activation only among signups old enough to judge', () => {
    expect(report.activation).toEqual({ signups: 2, activated: 1, rate: 50 });
  });

  it('reports each elapsed week of a cohort, and leaves future weeks empty', () => {
    const cohort = report.cohorts.find(c => c.size === 2)!;
    expect(cohort.retained).toEqual([50, 50, null, null]);
  });
});
