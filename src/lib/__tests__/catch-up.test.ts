import { describe, expect, it } from 'vitest';

import { computeCatchUp, startDateAfterPause, startDateForResume } from '@/lib/catch-up';
import { programDayFor } from '@/lib/program-day';

// A 4-day-a-week plan for 4 weeks: days 1, 2, 4, 6 of each week.
const DAYS = [0, 7, 14, 21].flatMap(w => [1, 2, 4, 6].map(d => w + d));

describe('computeCatchUp', () => {
  it('offers to pick up after a week away', () => {
    const result = computeCatchUp({ programDays: DAYS, todayProgramDay: 16, lastCompletedProgramDay: 8, daysSinceLastActivity: 8 });
    expect(result).toEqual({ missedSessions: 4, resumeDay: 9, repeatWeekDay: 8 }); // days 9, 11, 13, 15
  });

  it('stays quiet for someone who trained recently', () => {
    expect(computeCatchUp({ programDays: DAYS, todayProgramDay: 16, lastCompletedProgramDay: 8, daysSinceLastActivity: 1 })).toBeNull();
  });

  it('stays quiet for a single missed session', () => {
    expect(computeCatchUp({ programDays: DAYS, todayProgramDay: 5, lastCompletedProgramDay: 2, daysSinceLastActivity: 3 })).toBeNull();
  });

  it('offers a fresh start to someone who never began', () => {
    const result = computeCatchUp({ programDays: DAYS, todayProgramDay: 10, lastCompletedProgramDay: 0, daysSinceLastActivity: null });
    expect(result).toMatchObject({ resumeDay: 1, repeatWeekDay: 1 });
  });
});

describe('start date arithmetic', () => {
  it('makes today the resume day', () => {
    const today = new Date(2026, 8, 22, 15);
    const start = startDateForResume(today, 9);
    expect(programDayFor(start, new Date(2026, 8, 22))).toBe(9);
  });

  it('pushes the plan back by the days paused', () => {
    const start = new Date(2026, 8, 1);
    const moved = startDateAfterPause(start, new Date(2026, 8, 10, 9), new Date(2026, 8, 17, 20));
    expect(moved).toEqual(new Date(2026, 8, 8));
  });
});
