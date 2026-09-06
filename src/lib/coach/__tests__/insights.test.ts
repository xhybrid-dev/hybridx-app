import { describe, expect, it } from 'vitest';
import { addDays, subDays } from 'date-fns';

import {
  computeAdherence,
  computeStreak,
  describeWorkout,
  findSkipPatterns,
  matchesExerciseName,
  sessionStatus,
  summariseJournalEntry,
  summariseSession,
} from '@/lib/coach/insights';
import type { JournalEntry, WorkoutDay, WorkoutSession } from '@/models/types';

// Thursday, so "this week" (Mon-start) has Mon–Wed behind it and Fri–Sun ahead.
const TODAY = new Date(2026, 8, 3, 12, 0, 0);

function session(overrides: Partial<WorkoutSession> & { workoutDate: Date }): WorkoutSession {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    userId: 'athlete-1',
    programId: 'program-1',
    workoutTitle: 'Engine Builder',
    programType: 'hyrox',
    startedAt: overrides.workoutDate,
    workoutDetails: { day: 1, title: 'Engine Builder', exercises: [], programType: 'hyrox' } as WorkoutDay,
    ...overrides,
  };
}

describe('sessionStatus', () => {
  it('treats a finished session as completed regardless of date', () => {
    expect(sessionStatus(session({ workoutDate: subDays(TODAY, 3), finishedAt: TODAY }), TODAY)).toBe(
      'completed',
    );
  });

  it('treats an unfinished past session as missed, not skipped', () => {
    expect(sessionStatus(session({ workoutDate: subDays(TODAY, 2) }), TODAY)).toBe('missed');
  });

  it('respects an explicit skip', () => {
    expect(sessionStatus(session({ workoutDate: subDays(TODAY, 2), skipped: true }), TODAY)).toBe(
      'skipped',
    );
  });

  it('separates today from the future', () => {
    expect(sessionStatus(session({ workoutDate: TODAY }), TODAY)).toBe('today');
    expect(sessionStatus(session({ workoutDate: addDays(TODAY, 1) }), TODAY)).toBe('upcoming');
  });
});

describe('describeWorkout', () => {
  it('renders exercises and runs together for a hybrid session', () => {
    const workout = {
      day: 4,
      title: 'Compromised Running',
      programType: 'hyrox',
      exercises: [{ name: 'Sled Push', details: '4x20m @ 100kg' }],
      runs: [
        {
          type: 'tempo',
          distance: 5,
          paceZone: 'threshold',
          description: 'tempo blocks',
          effortLevel: 7,
          noIntervals: 2,
        },
      ],
    } as unknown as WorkoutDay;

    const described = describeWorkout(workout);
    expect(described).toContain('Sled Push — 4x20m @ 100kg');
    expect(described).toContain('5km 2×tempo blocks (RPE 7)');
  });

  it('describes an empty day as rest', () => {
    expect(describeWorkout(null)).toBe('Rest day');
    expect(
      describeWorkout({ day: 2, title: 'Rest', exercises: [], programType: 'hyrox' } as WorkoutDay),
    ).toBe('Rest day');
  });

  it('truncates long sessions but says how much was left out', () => {
    const workout = {
      day: 1,
      title: 'Big One',
      programType: 'hyrox',
      exercises: Array.from({ length: 9 }, (_, index) => ({
        name: `Move ${index}`,
        details: '3x10',
      })),
    } as unknown as WorkoutDay;

    expect(describeWorkout(workout, 4)).toContain('(+5 more)');
  });
});

describe('summariseSession', () => {
  it('carries the athlete\'s notes and linked activity into the line', () => {
    const line = summariseSession(
      session({
        workoutDate: subDays(TODAY, 1),
        workoutTitle: 'Threshold Run',
        finishedAt: subDays(TODAY, 1),
        duration: '48m',
        notes: 'legs felt heavy from Tuesday',
        stravaActivity: { name: 'Evening Run', distance: 8000, moving_time: 2400 },
      }),
      { today: TODAY },
    );

    expect(line).toContain('Threshold Run');
    expect(line).toContain('completed (48m)');
    expect(line).toContain('legs felt heavy from Tuesday');
    expect(line).toContain('8.0km');
    expect(line).toContain('5:00/km');
  });

  it('flags work logged outside the plan', () => {
    const line = summariseSession(
      session({
        workoutDate: subDays(TODAY, 1),
        programId: 'custom-workout',
        finishedAt: subDays(TODAY, 1),
      }),
      { today: TODAY },
    );
    expect(line).toContain('logged outside the plan');
  });
});

describe('computeAdherence', () => {
  it('scores completed against scheduled and ignores days still to come', () => {
    const sessions = [
      // This week: Mon done, Tue missed, today open, Friday upcoming.
      session({ workoutDate: subDays(TODAY, 3), finishedAt: subDays(TODAY, 3) }),
      session({ workoutDate: subDays(TODAY, 2) }),
      session({ workoutDate: TODAY }),
      session({ workoutDate: addDays(TODAY, 1) }),
    ];

    const report = computeAdherence(sessions, TODAY, 4);
    const thisWeek = report.weeks[report.weeks.length - 1];

    expect(thisWeek.label).toBe('This week');
    expect(thisWeek.scheduled).toBe(2);
    expect(thisWeek.completed).toBe(1);
    expect(thisWeek.missed).toBe(1);
    expect(report.completionRate).toBe(50);
  });

  it('counts one-off logged work as extra rather than as plan adherence', () => {
    const sessions = [
      session({ workoutDate: subDays(TODAY, 3), finishedAt: subDays(TODAY, 3) }),
      session({
        workoutDate: subDays(TODAY, 2),
        programId: 'one-off-ai',
        finishedAt: subDays(TODAY, 2),
      }),
    ];

    const report = computeAdherence(sessions, TODAY, 4);
    const thisWeek = report.weeks[report.weeks.length - 1];

    expect(thisWeek.scheduled).toBe(1);
    expect(thisWeek.extra).toBe(1);
    expect(report.completionRate).toBe(100);
    expect(report.completed).toBe(2);
  });

  it('does not hold cleared rest days against the athlete', () => {
    const sessions = [
      session({ workoutDate: subDays(TODAY, 2), workoutDetails: undefined, workoutTitle: 'Rest' }),
    ];
    const report = computeAdherence(sessions, TODAY, 4);
    expect(report.scheduled).toBe(0);
    expect(report.missed).toBe(0);
  });

  it('buckets four weeks, oldest first', () => {
    const report = computeAdherence([], TODAY, 4);
    expect(report.weeks).toHaveLength(4);
    expect(report.weeks[0].label).toBe('3 weeks ago');
    expect(report.weeks[3].label).toBe('This week');
  });
});

describe('computeStreak', () => {
  it('counts consecutive weeks with at least one session', () => {
    const sessions = [
      session({ workoutDate: subDays(TODAY, 1), finishedAt: subDays(TODAY, 1) }),
      session({ workoutDate: subDays(TODAY, 8), finishedAt: subDays(TODAY, 8) }),
      session({ workoutDate: subDays(TODAY, 15), finishedAt: subDays(TODAY, 15) }),
      // Gap, then an older week that shouldn't extend the streak.
      session({ workoutDate: subDays(TODAY, 36), finishedAt: subDays(TODAY, 36) }),
    ];

    const streak = computeStreak(sessions, TODAY);
    expect(streak.activeWeeks).toBe(3);
    expect(streak.daysSinceLastSession).toBe(1);
    expect(streak.totalCompleted).toBe(4);
  });

  it('reports no streak when nothing has been completed', () => {
    const streak = computeStreak([session({ workoutDate: subDays(TODAY, 2) })], TODAY);
    expect(streak.activeWeeks).toBe(0);
    expect(streak.daysSinceLastSession).toBeNull();
  });
});

describe('findSkipPatterns', () => {
  it('surfaces a repeatedly dropped weekday but ignores a one-off', () => {
    const sessions = [
      // Three Tuesdays missed.
      session({ workoutDate: subDays(TODAY, 2), workoutTitle: 'Interval Run' }),
      session({ workoutDate: subDays(TODAY, 9), workoutTitle: 'Interval Run' }),
      session({ workoutDate: subDays(TODAY, 16), workoutTitle: 'Interval Run' }),
      // One missed Monday.
      session({ workoutDate: subDays(TODAY, 3), workoutTitle: 'Strength' }),
      session({ workoutDate: subDays(TODAY, 10), finishedAt: subDays(TODAY, 10), workoutTitle: 'Strength' }),
    ];

    const patterns = findSkipPatterns(sessions, TODAY);
    expect(patterns.byWeekday[0].label).toBe('Tuesday');
    expect(patterns.byWeekday[0].missed).toBe(3);
    expect(patterns.byWeekday.some(p => p.label === 'Monday')).toBe(false);
    expect(patterns.byWorkout[0].label).toBe('Interval Run');
  });
});

describe('matchesExerciseName', () => {
  it('matches loosely enough for how athletes actually type', () => {
    expect(matchesExerciseName('Sled Push (Heavy)', 'sled push')).toBe(true);
    expect(matchesExerciseName('Wall Ball', 'wall balls')).toBe(true);
    expect(matchesExerciseName('Back Squat', 'squat')).toBe(true);
    expect(matchesExerciseName('Farmers Carry', 'sled')).toBe(false);
  });
});

describe('summariseJournalEntry', () => {
  it('keeps the mood, tags and the athlete\'s own words', () => {
    const entry: JournalEntry = {
      id: 'j1',
      userId: 'athlete-1',
      date: subDays(TODAY, 1),
      content: 'Knee was sore on the lunges again.',
      mood: 'tired',
      tags: ['injury'],
      createdAt: TODAY,
      updatedAt: TODAY,
    };

    const line = summariseJournalEntry(entry);
    expect(line).toContain('mood: tired');
    expect(line).toContain('injury');
    expect(line).toContain('Knee was sore on the lunges again.');
  });

  it('truncates a long entry', () => {
    const entry: JournalEntry = {
      id: 'j2',
      userId: 'athlete-1',
      date: TODAY,
      content: 'x'.repeat(500),
      createdAt: TODAY,
      updatedAt: TODAY,
    };
    expect(summariseJournalEntry(entry, 100)).toContain('…');
  });
});
