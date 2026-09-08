import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subDays, addDays } from 'date-fns';

import type { Program, User, WorkoutDay } from '@/models/types';

const TODAY = new Date(2026, 8, 3, 9, 0, 0);

const sessionDocs: Array<Record<string, any>> = [];
const journalDocs: Array<Record<string, any>> = [];
const noteDocs: Array<Record<string, any>> = [];

function asSnapshot(rows: Array<Record<string, any>>) {
  return {
    docs: rows.map((row, index) => ({ id: `doc-${index}`, data: () => row })),
    empty: rows.length === 0,
  };
}

// A Firestore stand-in: every query builder method returns itself, and `get`
// resolves whichever collection was asked for.
function fakeQuery(rows: Array<Record<string, any>>) {
  const query: any = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => asSnapshot(rows),
  };
  return query;
}

const COLLECTIONS: Record<string, Array<Record<string, any>>> = {
  workoutSessions: sessionDocs,
  journalEntries: journalDocs,
  coachNotes: noteDocs,
};

vi.mock('@/lib/firebase-admin', () => ({
  getAdminDb: () => ({
    collection: (name: string) => fakeQuery(COLLECTIONS[name] ?? []),
  }),
}));

const user: User = {
  id: 'athlete-1',
  email: 'a@example.com',
  firstName: 'Sam',
  lastName: 'Doe',
  experience: 'intermediate',
  frequency: '4',
  goal: 'hybrid',
  programId: 'p1',
  startDate: subDays(TODAY, 16), // program day 17
  personalRecords: { backSquat: '140kg' },
  raceName: 'HYROX London',
  raceDate: addDays(TODAY, 40),
  completedWorkouts: 52,
};

function workout(day: number, title: string): WorkoutDay {
  return {
    day,
    title,
    programType: 'hyrox',
    exercises: [{ name: 'Sled Push', details: '4x20m @ 100kg' }],
  } as unknown as WorkoutDay;
}

const program: Program = {
  id: 'p1',
  name: 'Hyrox Fusion Balance',
  description: 'Balanced run and strength build.',
  programType: 'hyrox',
  workouts: Array.from({ length: 28 }, (_, index) => workout(index + 1, `Session ${index + 1}`)),
};

// Overridable so a single case can vary the athlete or the program without
// every other case inheriting it.
let userOverride: User | null = null;
let programOverride: Program | null = null;

vi.mock('@/services/user-service', () => ({
  getUser: async () => userOverride ?? user,
}));

vi.mock('@/services/program-service', () => ({
  getProgram: async () => programOverride ?? program,
}));

function toTimestamp(date: Date) {
  return { toDate: () => date };
}

describe('buildCoachContext', () => {
  beforeEach(() => {
    sessionDocs.length = 0;
    journalDocs.length = 0;
    noteDocs.length = 0;
    userOverride = null;
    programOverride = null;
  });

  it('briefs the coach on what was done, missed and said', async () => {
    sessionDocs.push(
      {
        userId: 'athlete-1',
        programId: 'p1',
        workoutDate: toTimestamp(subDays(TODAY, 2)),
        startedAt: toTimestamp(subDays(TODAY, 2)),
        finishedAt: toTimestamp(subDays(TODAY, 2)),
        workoutTitle: 'Engine Builder',
        programType: 'hyrox',
        notes: 'sled felt slow, calf tight',
        workoutDetails: workout(15, 'Engine Builder'),
      },
      {
        userId: 'athlete-1',
        programId: 'p1',
        workoutDate: toTimestamp(subDays(TODAY, 1)),
        startedAt: toTimestamp(subDays(TODAY, 1)),
        workoutTitle: 'Threshold Run',
        programType: 'running',
        workoutDetails: workout(16, 'Threshold Run'),
      },
    );

    journalDocs.push({
      userId: 'athlete-1',
      date: toTimestamp(subDays(TODAY, 1)),
      content: 'Calf still grumbling after Tuesday.',
      mood: 'tired',
      tags: ['injury'],
      createdAt: toTimestamp(subDays(TODAY, 1)),
      updatedAt: toTimestamp(subDays(TODAY, 1)),
    });

    const { buildCoachContext } = await import('@/services/coach-context');
    const context = await buildCoachContext('athlete-1', TODAY, { fresh: true });

    expect(context.briefing).toContain('Sam');
    expect(context.briefing).toContain('Hyrox Fusion Balance');
    expect(context.briefing).toContain('day 17 of 28');
    expect(context.briefing).toContain('HYROX London');
    expect(context.briefing).toContain('backSquat 140kg');
    // What actually happened, including the missed run and the athlete's words.
    expect(context.briefing).toContain('Engine Builder [completed]');
    expect(context.briefing).toContain('Threshold Run [missed]');
    expect(context.briefing).toContain('sled felt slow, calf tight');
    expect(context.briefing).toContain('Calf still grumbling after Tuesday.');
    // Today and the days ahead come from the program when nothing is saved.
    expect(context.briefing).toContain('Today and the week ahead');
    expect(context.briefing).toContain('Session 17');
    expect(context.briefing).toContain('52 sessions completed all-time');
    expect(context.briefing).toContain('Strava is not connected');
  });

  it('opens with what the athlete has already told the coach', async () => {
    noteDocs.push(
      {
        userId: 'athlete-1',
        category: 'availability',
        content: 'Away in Spain 12–19 September.',
        status: 'active',
        source: 'chat',
        createdAt: toTimestamp(subDays(TODAY, 2)),
        updatedAt: toTimestamp(subDays(TODAY, 2)),
        expiresAt: toTimestamp(addDays(TODAY, 12)),
      },
      {
        // Expired: it was true in July and must not be quoted back in September.
        userId: 'athlete-1',
        category: 'constraint',
        content: 'Left hamstring tight after the June race.',
        status: 'active',
        source: 'chat',
        createdAt: toTimestamp(subDays(TODAY, 80)),
        updatedAt: toTimestamp(subDays(TODAY, 80)),
        expiresAt: toTimestamp(subDays(TODAY, 10)),
      },
    );

    const { buildCoachContext } = await import('@/services/coach-context');
    const context = await buildCoachContext('athlete-1', TODAY, { fresh: true });

    expect(context.briefing).toContain('What you already know about them');
    expect(context.briefing).toContain('Away in Spain 12–19 September.');
    expect(context.briefing).not.toContain('Left hamstring tight');
    // And the athlete can see what's being held about them.
    expect(context.snapshot.notes.map(note => note.content)).toEqual([
      'Away in Spain 12–19 September.',
    ]);
  });

  it('leaves the section out entirely when nothing has been said yet', async () => {
    const { buildCoachContext } = await import('@/services/coach-context');
    const context = await buildCoachContext('athlete-1', TODAY, { fresh: true });

    expect(context.briefing).not.toContain('What you already know about them');
    expect(context.snapshot.notes).toEqual([]);
  });

  it('reuses a briefing across a rapid exchange, and drops it when told to', async () => {
    sessionDocs.push({
      userId: 'athlete-1',
      programId: 'p1',
      workoutDate: toTimestamp(subDays(TODAY, 2)),
      startedAt: toTimestamp(subDays(TODAY, 2)),
      finishedAt: toTimestamp(subDays(TODAY, 2)),
      workoutTitle: 'Engine Builder',
      programType: 'hyrox',
      notes: 'first version',
      workoutDetails: workout(15, 'Engine Builder'),
    });

    const { buildCoachContext, invalidateCoachContext } = await import('@/services/coach-context');
    const first = await buildCoachContext('athlete-1', TODAY, { fresh: true });
    expect(first.briefing).toContain('first version');

    // The underlying data changes, but a second message moments later should
    // not pay to read it all again.
    sessionDocs[0].notes = 'second version';
    const cached = await buildCoachContext('athlete-1', TODAY);
    expect(cached.briefing).toContain('first version');

    // Until something the coach must notice is written.
    invalidateCoachContext('athlete-1');
    const rebuilt = await buildCoachContext('athlete-1', TODAY);
    expect(rebuilt.briefing).toContain('second version');
  });

  it("reads today's double session as today's, not as one missed yesterday", async () => {
    // The reported bug, end to end. A UK browser writes day markers as LOCAL
    // midnight, so a session for Tue 8 Sept is stored as 2026-09-07T23:00:00Z.
    // Read in UTC without re-pinning, that is yesterday — and the program day
    // came out one ahead, landing on the rest day after the double.
    const ukLocalMidnight = (iso: string) => toTimestamp(new Date(iso));

    const doubleDayUser = {
      ...user,
      // Written as `new Date()` when they picked the program: 14:37 BST.
      startDate: new Date('2026-06-02T13:37:00.000Z'), // Tue 2 June, UK
    };
    userOverride = doubleDayUser;

    programOverride = {
      ...program,
      workouts: [
        workout(98, 'Easy Run'),
        workout(99, 'Threshold Run'),
        workout(99, 'Lower Body'),
        // Day 100 is a rest day: no entry at all.
      ],
    };

    sessionDocs.push(
      {
        userId: 'athlete-1',
        programId: 'p1',
        workoutDate: ukLocalMidnight('2026-09-07T23:00:00.000Z'), // Tue 8 Sept
        startedAt: ukLocalMidnight('2026-09-07T23:00:00.000Z'),
        workoutTitle: 'Threshold Run',
        programType: 'running',
        sessionIndex: 0,
        workoutDetails: workout(99, 'Threshold Run'),
      },
      {
        userId: 'athlete-1',
        programId: 'p1',
        workoutDate: ukLocalMidnight('2026-09-07T23:00:00.000Z'),
        startedAt: ukLocalMidnight('2026-09-07T23:00:00.000Z'),
        workoutTitle: 'Lower Body',
        programType: 'hyrox',
        sessionIndex: 1,
        workoutDetails: workout(99, 'Lower Body'),
      },
    );

    const { buildCoachContext } = await import('@/services/coach-context');
    const context = await buildCoachContext(
      'athlete-1',
      new Date('2026-09-08T09:00:00.000Z'),
      { fresh: true, timeZone: 'Europe/London' },
    );

    // Both sessions are today's, and open — not missed, and not a rest day.
    expect(context.snapshot.todaysSessions).toEqual(['Threshold Run', 'Lower Body']);
    expect(context.snapshot.programDay).toBe(99);
    expect(context.briefing).toContain('Threshold Run [today]');
    expect(context.briefing).toContain('Lower Body [today]');
    expect(context.briefing).not.toContain('Threshold Run [missed]');
  });

  it('summarises where the athlete is for the UI, with prompts that fit', async () => {
    const { buildCoachContext } = await import('@/services/coach-context');
    const { snapshot } = await buildCoachContext('athlete-1', TODAY, { fresh: true });

    expect(snapshot.athleteFirstName).toBe('Sam');
    expect(snapshot.programName).toBe('Hyrox Fusion Balance');
    expect(snapshot.programDay).toBe(17);
    expect(snapshot.programWeek).toBe(3);
    expect(snapshot.todaysSessions).toEqual(['Session 17']);
    expect(snapshot.daysToRace).toBe(40);
    expect(snapshot.hasStrava).toBe(false);
    expect(snapshot.suggestedPrompts.length).toBeGreaterThan(0);
    expect(snapshot.suggestedPrompts.some(p => p.includes('HYROX London'))).toBe(true);
  });
});
