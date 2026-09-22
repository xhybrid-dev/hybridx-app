import { describe, expect, it } from 'vitest';

import { decideReminder, isReminderDue, localClock } from '@/lib/reminders';

describe('localClock', () => {
  it("reads the athlete's own wall clock", () => {
    const now = new Date('2026-09-22T06:05:00.000Z');
    expect(localClock(now, 'Europe/London')).toEqual({ dateKey: '2026-09-22', hour: 7, minute: 5 });
    expect(localClock(now, 'America/New_York')).toEqual({ dateKey: '2026-09-22', hour: 2, minute: 5 });
  });
});

describe('isReminderDue', () => {
  it('matches the quarter-hour of the chosen time', () => {
    expect(isReminderDue({ dateKey: 'x', hour: 7, minute: 5 }, { hour: 7, minute: 0 })).toBe(true);
    expect(isReminderDue({ dateKey: 'x', hour: 7, minute: 20 }, { hour: 7, minute: 0 })).toBe(false);
    expect(isReminderDue({ dateKey: 'x', hour: 18, minute: 30 }, { hour: 18, minute: 30 })).toBe(true);
  });
});

describe('decideReminder', () => {
  const workout = { title: 'Engine Builder', exercises: 'Row, SkiErg' };

  it('reminds an active athlete on a training day', () => {
    expect(decideReminder({ todaysWorkout: workout, commitmentTitle: null, daysSinceSeen: 0 })).toMatchObject({ kind: 'workout' });
  });

  it('stays quiet on a rest day', () => {
    expect(decideReminder({ todaysWorkout: null, commitmentTitle: null, daysSinceSeen: 1 })).toEqual({ kind: 'none' });
  });

  it('holds them to a "do it tomorrow" commitment', () => {
    expect(decideReminder({ todaysWorkout: null, commitmentTitle: 'Engine Builder', daysSinceSeen: 1 })).toMatchObject({ kind: 'commitment' });
  });

  it('nudges a lapsed athlete a few times, then stops', () => {
    const on = (days: number) => decideReminder({ todaysWorkout: workout, commitmentTitle: null, daysSinceSeen: days }).kind;
    expect([2, 3, 4, 5, 6, 10, 11, 30].map(on)).toEqual(['reengage', 'none', 'none', 'reengage', 'none', 'reengage', 'none', 'none']);
  });
});
