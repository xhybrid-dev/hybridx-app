// src/services/coach-context.ts
//
// Assembles everything the Edge Coach knows about an athlete before a
// conversation starts, and exposes the same reads as building blocks for the
// chat's tools (src/ai/coach-tools.ts).
//
// The old assistant fetched the athlete's entire session list on the *client*
// and posted it to the model as one JSON blob, which meant the coach could see
// a lot but understand very little: no notion of what was actually completed,
// what was missed, what is coming up, or how the athlete has been feeling. This
// module does that work server-side and hands the model prose it can reason
// about — a briefing — while leaving the deeper digging (a specific week, a
// specific movement, the Strava activity behind a session) to tools it can call
// when a question actually needs them.
//
// Admin SDK only — never import this from a client component.

import { Timestamp } from 'firebase-admin/firestore';
import { addDays, differenceInCalendarDays, format, startOfDay, subDays } from 'date-fns';

import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { getUser } from '@/services/user-service';
import { getProgram } from '@/services/program-service';
import { getWorkoutForDay } from '@/lib/workout-utils';
import { computeTrainingSummary, formatTrainingSummaryForAI } from '@/services/training-load-service';
import { getValidStravaToken } from '@/lib/strava-token';
import { fetchRecentActivities } from '@/lib/strava-api';
import type { StravaActivity } from '@/services/strava-service';
import type {
  JournalEntry,
  Program,
  User,
  WorkoutDay,
  WorkoutSession,
} from '@/models/types';
import { formatNotesForPrompt, getActiveNotes, type CoachNote } from '@/services/coach-notes';
import {
  computeAdherence,
  computeStreak,
  describeWorkout,
  findSkipPatterns,
  sessionStatus,
  summariseJournalEntry,
  summariseSession,
} from '@/lib/coach/insights';

// ── Firestore reads ───────────────────────────────────────────────────────────

function sessionFromFirestore(doc: FirebaseFirestore.DocumentSnapshot): WorkoutSession {
  const data = doc.data() as Record<string, any>;
  const toDate = (value: any): Date | undefined =>
    value?.toDate ? value.toDate() : value instanceof Date ? value : undefined;

  return {
    id: doc.id,
    userId: data.userId,
    programId: data.programId,
    workoutDate: toDate(data.workoutDate) ?? new Date(),
    workoutTitle: data.workoutTitle || 'Workout',
    programType: data.programType || 'hyrox',
    startedAt: toDate(data.startedAt) ?? new Date(),
    finishedAt: toDate(data.finishedAt),
    notes: data.notes || '',
    duration: data.duration,
    sessionIndex: data.sessionIndex,
    sessionCount: data.sessionCount,
    extendedExercises: data.extendedExercises || [],
    skipped: data.skipped || false,
    workoutDetails: data.workoutDetails ?? undefined,
    exerciseChecklist: data.exerciseChecklist || {},
    timerRecord: data.timerRecord,
    stravaId: data.stravaId,
    uploadedToStrava: data.uploadedToStrava,
    stravaActivity: data.stravaActivity,
  };
}

/** Session docs for a date range, inclusive, oldest first. */
export async function getSessionsInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<WorkoutSession[]> {
  const snapshot = await getAdminDb()
    .collection('workoutSessions')
    .where('userId', '==', userId)
    .where('workoutDate', '>=', Timestamp.fromDate(startOfDay(from)))
    .where('workoutDate', '<=', Timestamp.fromDate(startOfDay(to)))
    .orderBy('workoutDate', 'asc')
    .get();

  return snapshot.docs.map(sessionFromFirestore);
}

export async function getRecentJournalEntries(userId: string, limit = 8): Promise<JournalEntry[]> {
  const collection = getAdminDb().collection('journalEntries').where('userId', '==', userId);

  // Ordering server-side matters here: an athlete with a long journal would
  // otherwise get an arbitrary slice sorted after the fact, and the coach would
  // quote something from months ago as if it were this week. Needs the
  // userId+date index (firestore.indexes.json) — until that is deployed, fall
  // back to the unordered read rather than losing the journal entirely.
  let snapshot: FirebaseFirestore.QuerySnapshot;
  try {
    snapshot = await collection.orderBy('date', 'desc').limit(limit).get();
  } catch (error) {
    logger.warn(
      '[coach-context] Ordered journal query failed (index missing?), falling back:',
      error instanceof Error ? error.message : String(error),
    );
    snapshot = await collection.limit(60).get();
  }

  const toDate = (value: any): Date =>
    value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);

  return snapshot.docs
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        date: toDate(data.date),
        content: data.content || '',
        mood: data.mood ?? undefined,
        tags: data.tags || [],
        aiInterpretation: data.aiInterpretation,
        aiCoachResponse: data.aiCoachResponse,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      } as JournalEntry;
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, limit);
}

// One conversation turn can want Strava three times over — the briefing, the
// load tool, the activities tool — and each fetch is two round trips against a
// rate-limited API. Always pull the full 60-day window once and serve the
// narrower asks from it. Five minutes matches the cache the training-summary
// endpoint already advertises, so this is no staler than the dashboard.
const STRAVA_WINDOW_DAYS = 60;
const STRAVA_CACHE_TTL_MS = 5 * 60_000;
const stravaCache = new Map<string, { activities: StravaActivity[]; expiresAt: number }>();

/** Raw Strava activities, newest first. Returns [] when Strava isn't connected. */
export async function getStravaActivities(userId: string, days = STRAVA_WINDOW_DAYS): Promise<StravaActivity[]> {
  const now = Date.now();
  const cached = stravaCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return filterToWindow(cached.activities, days, now);
  }

  const user = await getUser(userId);
  if (!user?.strava?.accessToken) return [];

  try {
    const accessToken = await getValidStravaToken(userId);
    const { activities } = await fetchRecentActivities(accessToken, {
      days: STRAVA_WINDOW_DAYS,
      perPage: 100,
      maxPages: 2,
    });
    const sorted = [...activities].sort(
      (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
    );

    // Prune opportunistically so a long-lived instance doesn't hold every
    // athlete who used the coach today.
    for (const [key, entry] of stravaCache) {
      if (entry.expiresAt <= now) stravaCache.delete(key);
    }
    stravaCache.set(userId, { activities: sorted, expiresAt: now + STRAVA_CACHE_TTL_MS });

    return filterToWindow(sorted, days, now);
  } catch (error) {
    // Strava being unavailable must never take the coach down with it.
    logger.warn(
      '[coach-context] Strava fetch failed:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

function filterToWindow(activities: StravaActivity[], days: number, now: number): StravaActivity[] {
  if (days >= STRAVA_WINDOW_DAYS) return activities;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return activities.filter(activity => new Date(activity.start_date).getTime() >= cutoff);
}

/** ATL/CTL/TSB summary text, or null when there's no Strava data to compute from. */
export async function getTrainingLoadText(userId: string): Promise<string | null> {
  const activities = await getStravaActivities(userId, 60);
  if (activities.length === 0) return null;
  return formatTrainingSummaryForAI(computeTrainingSummary(activities));
}

/**
 * The athlete's active program with their personal customisations applied.
 * `customProgram` is what /api/ai/apply-adjustments writes, so reading it here
 * is what makes the coach aware of plan changes it previously made.
 */
export async function getEffectiveProgram(user: User): Promise<Program | null> {
  if (!user.programId) return null;
  const program = await getProgram(user.programId);
  if (!program) return null;
  if (user.customProgram && user.customProgram.length > 0) {
    return { ...program, workouts: user.customProgram };
  }
  return program;
}

// ── Schedule assembly ─────────────────────────────────────────────────────────

export interface ScheduledDay {
  date: Date;
  /** Day number within the program cycle, or null when off-program. */
  programDay: number | null;
  sessions: Array<{
    title: string;
    detail: string;
    status: ReturnType<typeof sessionStatus> | 'planned';
    notes?: string;
    /** Present when the day's content came from a saved session doc. */
    session?: WorkoutSession;
  }>;
}

/**
 * What the athlete's calendar actually shows for each day in a range.
 *
 * Session docs win over the program's default schedule: they carry completions,
 * notes, drag-and-drop rearrangements and applied AI adjustments. Only days with
 * no doc at all fall back to the program, which is exactly how the calendar and
 * dashboard resolve a day (see getOrCreateProgramSessionsForDay).
 */
export function buildSchedule(
  from: Date,
  to: Date,
  sessions: WorkoutSession[],
  program: Program | null,
  startDate: Date | undefined,
  today: Date,
): ScheduledDay[] {
  const byDate = new Map<string, WorkoutSession[]>();
  for (const session of sessions) {
    const key = format(session.workoutDate, 'yyyy-MM-dd');
    byDate.set(key, [...(byDate.get(key) ?? []), session]);
  }

  const days: ScheduledDay[] = [];
  const dayCount = differenceInCalendarDays(startOfDay(to), startOfDay(from));

  for (let offset = 0; offset <= dayCount; offset++) {
    const date = startOfDay(addDays(from, offset));
    const key = format(date, 'yyyy-MM-dd');
    const docs = (byDate.get(key) ?? []).sort(
      (a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0),
    );

    const programDay = program && startDate
      ? getWorkoutForDay(program, startDate, date).day
      : null;

    if (docs.length > 0) {
      days.push({
        date,
        programDay,
        sessions: docs
          // A doc with no workoutDetails is a "day cleared" marker, not a session.
          .filter(doc => doc.workoutDetails || doc.finishedAt)
          .map(doc => ({
            title: doc.workoutTitle,
            detail: describeWorkout(doc.workoutDetails),
            status: sessionStatus(doc, today),
            notes: doc.notes?.trim() || undefined,
            session: doc,
          })),
      });
      continue;
    }

    if (!program || !startDate) {
      days.push({ date, programDay, sessions: [] });
      continue;
    }

    const { sessions: planned } = getWorkoutForDay(program, startDate, date);
    days.push({
      date,
      programDay,
      sessions: planned.map((workout: WorkoutDay) => ({
        title: workout.title,
        detail: describeWorkout(workout),
        status: 'planned' as const,
      })),
    });
  }

  return days;
}

function renderSchedule(days: ScheduledDay[], today: Date): string {
  return days
    .map(day => {
      const isToday = differenceInCalendarDays(day.date, today) === 0;
      const label = `${format(day.date, 'EEE d MMM')}${isToday ? ' (today)' : ''}`;
      if (day.sessions.length === 0) return `- ${label}: rest`;
      return day.sessions
        .map(session => {
          const notes = session.notes ? ` | notes: "${session.notes}"` : '';
          return `- ${label}: ${session.title} [${session.status}] — ${session.detail}${notes}`;
        })
        .join('\n');
    })
    .join('\n');
}

// ── The briefing ──────────────────────────────────────────────────────────────

/** A remembered note, flattened for the client. */
export interface CoachSnapshotNote {
  id: string;
  category: CoachNote['category'];
  content: string;
}

export interface CoachSnapshot {
  athleteFirstName: string;
  programName: string | null;
  /** 1-based week within the program cycle. */
  programWeek: number | null;
  programDay: number | null;
  programLength: number | null;
  todaysSessions: string[];
  completionRate: number;
  activeWeeks: number;
  daysSinceLastSession: number | null;
  fatigueLabel: string | null;
  raceName: string | null;
  daysToRace: number | null;
  hasStrava: boolean;
  hasProgram: boolean;
  /** What the coach is currently remembering, shown back to the athlete. */
  notes: CoachSnapshotNote[];
  /** Openers the UI offers, chosen from what's actually going on. */
  suggestedPrompts: string[];
}

export interface CoachContext {
  user: User | null;
  briefing: string;
  snapshot: CoachSnapshot;
}

const NO_ATHLETE_SNAPSHOT: CoachSnapshot = {
  athleteFirstName: 'Athlete',
  programName: null,
  programWeek: null,
  programDay: null,
  programLength: null,
  todaysSessions: [],
  completionRate: 0,
  activeWeeks: 0,
  daysSinceLastSession: null,
  fatigueLabel: null,
  raceName: null,
  daysToRace: null,
  hasStrava: false,
  hasProgram: false,
  notes: [],
  suggestedPrompts: [
    'How should I start training for HYROX?',
    'What should I focus on first?',
  ],
};

/**
 * Builds the full coaching briefing for an athlete.
 *
 * Everything here is bounded — 28 days back, 10 days forward, 8 journal entries
 * — so the prompt stays a readable page rather than a dump. Anything outside
 * that window is a tool call away.
 */
export async function buildCoachContext(userId: string, now = new Date()): Promise<CoachContext> {
  const today = startOfDay(now);

  const user = await getUser(userId);
  if (!user) {
    return {
      user: null,
      briefing: 'No athlete profile found. Ask the athlete to finish setting up their account.',
      snapshot: NO_ATHLETE_SNAPSHOT,
    };
  }

  const historyStart = subDays(today, 28);
  const scheduleEnd = addDays(today, 10);

  const [program, sessions, journal, trainingLoad, notes] = await Promise.all([
    getEffectiveProgram(user),
    getSessionsInRange(userId, historyStart, scheduleEnd),
    getRecentJournalEntries(userId, 8),
    getTrainingLoadText(userId).catch(() => null),
    getActiveNotes(userId, now),
  ]);

  const schedule = buildSchedule(historyStart, scheduleEnd, sessions, program, user.startDate, today);
  const past = schedule.filter(day => differenceInCalendarDays(day.date, today) < 0);
  const upcoming = schedule.filter(day => differenceInCalendarDays(day.date, today) >= 0);
  const last10Days = past.slice(-10);

  const adherence = computeAdherence(sessions, today, 4);
  const streak = computeStreak(sessions, today);
  const patterns = findSkipPatterns(sessions, today);

  // The session window is four weeks, so a longer lay-off looks like "no
  // sessions ever" from here. `lastWorkoutAt` and `completedWorkouts` are
  // maintained server-side over the athlete's whole history, which is what an
  // athlete returning after two months should actually be met with.
  const daysSinceLastSession =
    streak.daysSinceLastSession ??
    (user.lastWorkoutAt ? differenceInCalendarDays(today, user.lastWorkoutAt) : null);

  const completedWithNotes = sessions
    .filter(s => s.finishedAt && (s.notes?.trim() || s.stravaActivity || s.timerRecord))
    .sort((a, b) => b.workoutDate.getTime() - a.workoutDate.getTime())
    .slice(0, 8);

  const cycleLength = program?.workouts.length
    ? Math.max(...program.workouts.map(w => w.day))
    : null;
  const programDay = program && user.startDate
    ? getWorkoutForDay(program, user.startDate, today).day
    : null;
  const programWeek = programDay && programDay > 0 ? Math.ceil(programDay / 7) : null;

  const todaysDay = upcoming[0];
  const todaysSessions = todaysDay?.sessions.map(s => s.title) ?? [];

  const daysToRace = user.raceDate ? differenceInCalendarDays(user.raceDate, today) : null;
  const fatigueLabel = trainingLoad?.match(/Fatigue Status: (.+)/)?.[1]?.trim() ?? null;

  const rememberedNotes = formatNotesForPrompt(notes, now);

  const briefing = [
    rememberedNotes
      ? [
          '## What you already know about them',
          '(Told to you in earlier conversations. Treat these as current and let them colour your',
          'reading of everything below — a missed week that you already know was a holiday is not a',
          'missed week. If something here has clearly moved on, say so rather than repeating it.)',
          rememberedNotes,
          '',
        ].join('\n')
      : null,
    '## Athlete',
    [
      `- Name: ${user.firstName || 'Athlete'}`,
      `- Experience: ${user.experience ?? 'unknown'} | Goal: ${user.goal ?? 'unknown'} | Target frequency: ${user.frequency ?? '?'} days/week`,
      `- Units: ${user.unitSystem === 'imperial' ? 'imperial (miles/lb)' : 'metric (km/kg)'}`,
      user.raceName || user.raceDate
        ? `- Target race: ${user.raceName ?? 'race'}${user.raceDate ? ` on ${format(user.raceDate, 'd MMM yyyy')} (${daysToRace} days away)` : ''}`
        : '- Target race: none set',
      formatPersonalRecords(user),
      formatBenchmarkPaces(user),
      user.runningProfile?.injuryHistory?.length
        ? `- Injury history: ${user.runningProfile.injuryHistory.join(', ')}`
        : null,
    ].filter(Boolean).join('\n'),
    '',
    '## Program',
    program
      ? [
          `- ${program.name} (${program.programType})${user.customProgram?.length ? ' — personalised: previous coach adjustments have been applied' : ''}`,
          `- ${program.description ?? ''}`.trim(),
          programDay && cycleLength
            ? `- Currently day ${programDay} of ${cycleLength} (week ${programWeek} of ${Math.ceil(cycleLength / 7)}), started ${user.startDate ? format(user.startDate, 'd MMM yyyy') : 'unknown'}`
            : '- Program start date not set',
        ].join('\n')
      : '- No active program. The athlete is training without a plan from us.',
    '',
    '## Today and the week ahead',
    renderSchedule(upcoming, today),
    '',
    '## Last 10 days',
    last10Days.length > 0 ? renderSchedule(last10Days, today) : '- No scheduled days on record.',
    '',
    '## Consistency (last 4 weeks)',
    adherence.weeks
      .map(week =>
        `- ${week.label}: ${week.completed}/${week.scheduled} planned sessions completed` +
        `${week.missed ? `, ${week.missed} missed` : ''}` +
        `${week.skipped ? `, ${week.skipped} skipped` : ''}` +
        `${week.extra ? `, ${week.extra} extra logged` : ''}`,
      )
      .join('\n'),
    `- Completion rate: ${adherence.completionRate}% | Average ${adherence.averageSessionsPerWeek} sessions/week`,
    `- Consecutive weeks with at least one session: ${streak.activeWeeks} (of the last 4)` +
      `${user.completedWorkouts ? ` | ${user.completedWorkouts} sessions completed all-time` : ''}`,
    streak.daysSinceLastSession !== null
      ? `- Last completed session: ${streak.lastSessionTitle} (${streak.daysSinceLastSession} days ago)`
      : daysSinceLastSession !== null
        ? `- Nothing completed in the last 4 weeks; last session was around ${daysSinceLastSession} days ago.`
        : '- No completed sessions on record yet.',
    patterns.byWeekday.length > 0
      ? `- Days most often dropped: ${patterns.byWeekday.map(p => `${p.label} (${p.missed}/${p.scheduled})`).join(', ')}`
      : null,
    patterns.byWorkout.length > 0
      ? `- Sessions most often dropped: ${patterns.byWorkout.map(p => `${p.label} (${p.missed}/${p.scheduled})`).join(', ')}`
      : null,
    '',
    '## Recent sessions in detail',
    completedWithNotes.length > 0
      ? completedWithNotes.map(s => `- ${summariseSession(s, { today })}`).join('\n')
      : '- Nothing logged with notes or linked activity yet.',
    '',
    '## Training load',
    trainingLoad ?? '- Strava is not connected, so no objective load data (ATL/CTL/TSB) is available.',
    '',
    '## Journal (the athlete in their own words)',
    journal.length > 0
      ? journal.map(entry => `- ${summariseJournalEntry(entry)}`).join('\n')
      : '- No journal entries yet.',
  ]
    .filter(line => line !== null)
    .join('\n');

  return {
    user,
    briefing,
    snapshot: {
      athleteFirstName: user.firstName || 'Athlete',
      programName: program?.name ?? null,
      programWeek,
      programDay,
      programLength: cycleLength,
      todaysSessions,
      completionRate: adherence.completionRate,
      activeWeeks: streak.activeWeeks,
      daysSinceLastSession,
      fatigueLabel,
      raceName: user.raceName ?? null,
      daysToRace,
      hasStrava: !!user.strava?.accessToken,
      hasProgram: !!program,
      notes: notes.map(note => ({
        id: note.id,
        category: note.category,
        content: note.content,
      })),
      suggestedPrompts: buildSuggestedPrompts({
        todaysSessions,
        adherence,
        daysSinceLastSession,
        fatigueLabel,
        daysToRace,
        raceName: user.raceName ?? null,
        patterns,
        hasProgram: !!program,
      }),
    },
  };
}

function formatPersonalRecords(user: User): string | null {
  const records = Object.entries(user.personalRecords ?? {}).filter(([, value]) => !!value);
  if (records.length === 0) return null;
  return `- Personal records: ${records.map(([key, value]) => `${key} ${value}`).join(', ')}`;
}

function formatBenchmarkPaces(user: User): string | null {
  const paces = user.runningProfile?.benchmarkPaces ?? {};
  const entries = Object.entries(paces).filter(([, value]) => typeof value === 'number');
  if (entries.length === 0) return null;
  const formatted = entries.map(([key, seconds]) => {
    const total = seconds as number;
    return `${key} ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`;
  });
  return `- Benchmark times: ${formatted.join(', ')}`;
}

/**
 * Openers worth tapping, drawn from what's actually happening rather than a
 * fixed list. A fatigued athlete two weeks from a race should not be offered
 * "how do I get started".
 */
function buildSuggestedPrompts(input: {
  todaysSessions: string[];
  adherence: ReturnType<typeof computeAdherence>;
  daysSinceLastSession: number | null;
  fatigueLabel: string | null;
  daysToRace: number | null;
  raceName: string | null;
  patterns: ReturnType<typeof findSkipPatterns>;
  hasProgram: boolean;
}): string[] {
  const prompts: string[] = [];

  if (input.todaysSessions.length > 0) {
    prompts.push(`Walk me through today's ${input.todaysSessions[0]}`);
  }
  if (input.daysToRace !== null && input.daysToRace >= 0 && input.daysToRace <= 84) {
    prompts.push(`Am I on track for ${input.raceName ?? 'my race'} in ${input.daysToRace} days?`);
  }
  if (input.fatigueLabel && /fatigue|overreach|high|strain/i.test(input.fatigueLabel)) {
    prompts.push('My load looks high — should I back off this week?');
  }
  if (input.patterns.byWeekday.length > 0) {
    prompts.push(`I keep missing ${input.patterns.byWeekday[0].label}s — can we rework it?`);
  }
  if (input.daysSinceLastSession !== null && input.daysSinceLastSession >= 5) {
    prompts.push("I've been off for a while — how do I restart without overdoing it?");
  }
  if (input.adherence.completionRate >= 80 && input.adherence.scheduled >= 6) {
    prompts.push('How is my progress trending over the last month?');
  }
  if (input.hasProgram) {
    prompts.push('Can you adjust this week around a busy schedule?');
  }

  prompts.push('What should I work on to get faster at the sled push?');

  return [...new Set(prompts)].slice(0, 4);
}
