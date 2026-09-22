import { describe, expect, it } from 'vitest';

import { condensePlan, maxTrainingDaysPerWeek } from '@/lib/plan-condense';

const ex = [{ name: 'Sled push', details: '4x20m' }];
const run = [{ type: 'easy', distance: 5 }];

function w(day: number, title: string, kind: 'ex' | 'run' | 'none' = 'ex') {
  return {
    day,
    title,
    exercises: kind === 'ex' ? ex : [],
    runs: kind === 'run' ? run : [],
  };
}

/** A 5-day week, repeated for 12 weeks — the shape that used to collapse to one week. */
function twelveWeeks() {
  const plan = [];
  for (let week = 0; week < 12; week++) {
    const d = week * 7;
    plan.push(
      w(d + 1, 'Strength A'),
      w(d + 2, 'Easy recovery run', 'run'),
      w(d + 3, 'Threshold intervals', 'run'),
      w(d + 4, 'Mobility flow'),
      w(d + 5, 'Strength B'),
      w(d + 6, 'Long run', 'run'),
      w(d + 7, 'Rest', 'none'),
    );
  }
  return plan;
}

describe('condensePlan', () => {
  it('keeps every week of a long plan', () => {
    const result = condensePlan(twelveWeeks(), '3');
    expect(Math.max(...result.map(r => r.day))).toBe(84);
    expect(maxTrainingDaysPerWeek(result)).toBe(3);
  });

  it('drops the easiest days first and keeps the key sessions in place', () => {
    const week1 = condensePlan(twelveWeeks(), '3').filter(r => r.day <= 7);
    const training = week1.filter(r => r.title !== 'Rest').map(r => `${r.day}:${r.title}`);
    // Long run and intervals win on priority; the two strength days tie, so the earlier stays.
    expect(training).toEqual(['1:Strength A', '3:Threshold intervals', '6:Long run']);
  });

  it('keeps rest entries untouched', () => {
    const result = condensePlan(twelveWeeks(), '4');
    expect(result.filter(r => r.title === 'Rest')).toHaveLength(12);
  });

  it('treats a two-session day as one training day', () => {
    const plan = [w(1, 'Run', 'run'), w(1, 'Strength'), w(2, 'Strength'), w(4, 'Strength'), w(6, 'Long run', 'run')];
    const result = condensePlan(plan, '3');
    expect(result.filter(r => r.day === 1)).toHaveLength(2);
    expect(new Set(result.map(r => r.day)).size).toBe(3);
  });

  it('leaves a plan that already fits alone', () => {
    const plan = [w(1, 'A'), w(3, 'B'), w(5, 'C')];
    expect(condensePlan(plan, '3')).toEqual(plan);
    expect(condensePlan(twelveWeeks(), '5+')).toHaveLength(84);
  });
});
