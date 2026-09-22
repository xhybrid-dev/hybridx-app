import { describe, expect, it } from 'vitest';

import { planPostpone } from '@/lib/postpone';

const day = (n: number, ...workouts: string[]) => ({ date: new Date(2026, 8, 21 + n), workouts });

describe('planPostpone', () => {
  it('moves today onto a free tomorrow', () => {
    const plan = planPostpone([day(0, 'Engine'), day(1), day(2, 'Strength')]);
    expect(plan?.changes.map(c => c.workouts)).toEqual([[], ['Engine']]);
    expect(plan?.bumpedTo).toBeNull();
  });

  it("bumps tomorrow's session to the next rest day", () => {
    const plan = planPostpone([day(0, 'Engine'), day(1, 'Strength'), day(2, 'Run'), day(3), day(4, 'Hybrid')]);
    expect(plan?.changes.map(c => c.workouts)).toEqual([[], ['Engine'], ['Strength']]);
    expect(plan?.bumpedTo).toEqual(day(3).date);
  });

  it('stacks the two only when the week has no rest day', () => {
    const plan = planPostpone([day(0, 'Engine'), day(1, 'Strength'), day(2, 'Run')]);
    expect(plan?.changes.map(c => c.workouts)).toEqual([[], ['Engine', 'Strength']]);
  });

  it('does nothing on a rest day', () => {
    expect(planPostpone([day(0), day(1, 'Strength')])).toBeNull();
  });
});
