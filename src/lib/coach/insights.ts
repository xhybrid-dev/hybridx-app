// src/lib/coach/insights.ts
//
// Pure, IO-free helpers that turn raw training data into the compact prose a
// coach actually reasons about. They live apart from the Firestore reads in
// `src/services/coach-context.ts` so the interesting logic — adherence, skip
// patterns, streaks, how a session is described — can be unit tested without a
// database, and so the chat tools and the context briefing describe the same
// session the same way.

import { differenceInCalendarDays, format, startOfWeek } from 'date-fns';
import type {
  Exercise,
  JournalEntry,
  PlannedRun,
  WorkoutDay,
  WorkoutSession,
} from '@/models/types';
import { formatPlannedRun } from '@/lib/workout-utils';

/** Program ids used for logged extra activity rather than the scheduled plan. */
export const AD_HOC_PROGRAM_IDS = ['one-off-ai', 'custom-workout'];

export type SessionStatus = 'completed' | 'skipped' | 'missed' | 'upcoming' | 'today';

/**
 * What actually happened on a scheduled day.
 *
 * `missed` is the one that matters for coaching: a past session that was
 * neither finished nor explicitly skipped. Athletes rarely press "skip" — they
 * just don't train — so treating an unfinished past session as missed is what
 * lets the coach say "you've dropped the Thursday run three weeks running"
 * instead of believing the plan was followed.
 */
export function sessionStatus(session: WorkoutSession, today: Date): SessionStatus {
  if (session.finishedAt) return 'completed';
  if (session.skipped) return 'skipped';
  const dayDelta = differenceInCalendarDays(session.workoutDate, today);
  if (dayDelta > 0) return 'upcoming';
  if (dayDelta === 0) return 'today';
  return 'missed';
}

function formatExercise(exercise: Exercise): string {
  const details = exercise.details?.trim();
  return details ? `${exercise.name} — ${details}` : exercise.name;
}

function formatRun(run: PlannedRun): string {
  const distance = run.distance ? `${run.distance}km ` : '';
  return `${distance}${formatPlannedRun(run)}`;
}

/**
 * One-line-per-item description of a session's prescribed content.
 * `maxItems` keeps a 20-movement session from swamping the briefing; tools that
 * need the whole thing pass a higher limit.
 */
export function describeWorkout(workout: WorkoutDay | null | undefined, maxItems = 6): string {
  if (!workout) return 'Rest day';

  const items: string[] = [
    ...(workout.exercises ?? []).map(formatExercise),
    ...((workout as { runs?: PlannedRun[] }).runs ?? []).map(formatRun),
  ];

  if (items.length === 0) return 'Rest day';

  const shown = items.slice(0, maxItems);
  const remainder = items.length - shown.length;
  return shown.join('; ') + (remainder > 0 ? `; (+${remainder} more)` : '');
}

/** Human-readable duration of a completed session, from whichever field carries it. */
export function sessionDuration(session: WorkoutSession): string | null {
  if (session.duration) return session.duration;
  if (session.startedAt && session.finishedAt) {
    const minutes = Math.round(
      (session.finishedAt.getTime() - session.startedAt.getTime()) / 60000,
    );
    // startedAt is stamped when the session doc is created, which for a
    // scheduled day can be days before the athlete trains. Only trust it as a
    // duration when it produces something plausible for one session.
    if (minutes > 0 && minutes <= 300) return `${minutes}m`;
  }
  if (session.timerRecord?.totalTime) {
    return `${Math.round(session.timerRecord.totalTime / 60)}m (timed)`;
  }
  return null;
}

/** Strava activity linked to a session, rendered as distance/time/pace. */
export function describeLinkedActivity(session: WorkoutSession): string | null {
  const activity = session.stravaActivity;
  if (!activity) return null;

  const parts: string[] = [];
  if (activity.distance) parts.push(`${(activity.distance / 1000).toFixed(1)}km`);
  if (activity.moving_time) parts.push(`${Math.round(activity.moving_time / 60)}m`);
  if (activity.distance && activity.moving_time && activity.distance > 0) {
    const secondsPerKm = activity.moving_time / (activity.distance / 1000);
    const mins = Math.floor(secondsPerKm / 60);
    const secs = Math.round(secondsPerKm % 60);
    parts.push(`${mins}:${String(secs).padStart(2, '0')}/km`);
  }
  if (parts.length === 0) return activity.name ?? null;
  return `${activity.name ? `${activity.name} — ` : ''}${parts.join(', ')}`;
}

export interface SessionLineOptions {
  /** Include the prescribed movements, not just the title. */
  includeDetail?: boolean;
  today?: Date;
}

/**
 * The canonical one-line rendering of a session for the model: date, title,
 * status, and — crucially — the athlete's own notes, which is where the
 * "challenges" a coach should pick up on actually live.
 */
export function summariseSession(session: WorkoutSession, options: SessionLineOptions = {}): string {
  const today = options.today ?? new Date();
  const status = sessionStatus(session, today);
  const parts = [`${format(session.workoutDate, 'EEE d MMM')} — ${session.workoutTitle}`];

  const duration = status === 'completed' ? sessionDuration(session) : null;
  parts.push(duration ? `${status} (${duration})` : status);

  if (options.includeDetail) {
    const detail = describeWorkout(session.workoutDetails);
    if (detail !== 'Rest day') parts.push(detail);
  }

  const extended = session.extendedExercises ?? [];
  if (extended.length > 0) {
    parts.push(`added: ${extended.map(formatExercise).join('; ')}`);
  }

  const linked = describeLinkedActivity(session);
  if (linked) parts.push(`Strava: ${linked}`);

  if (session.timerRecord?.amrapRounds) {
    parts.push(`${session.timerRecord.amrapRounds} rounds`);
  }

  const notes = session.notes?.trim();
  if (notes) parts.push(`notes: "${notes}"`);

  if (AD_HOC_PROGRAM_IDS.includes(session.programId)) parts.push('(logged outside the plan)');

  return parts.join(' | ');
}

export interface WeekAdherence {
  /** Monday of the week. */
  weekStart: Date;
  label: string;
  scheduled: number;
  completed: number;
  skipped: number;
  missed: number;
  /** Sessions logged that weren't part of the plan (one-off / custom). */
  extra: number;
}

export interface AdherenceReport {
  weeks: WeekAdherence[];
  completed: number;
  scheduled: number;
  missed: number;
  skipped: number;
  /** Completed ÷ scheduled over the window, 0–100, rounded. */
  completionRate: number;
  averageSessionsPerWeek: number;
}

/**
 * Adherence over the trailing `weeks` complete weeks (Monday-start), oldest
 * first. Only days up to `today` count as scheduled, so the current part-week
 * isn't scored as if the athlete had already missed the rest of it.
 */
export function computeAdherence(
  sessions: WorkoutSession[],
  today: Date,
  weeks = 4,
): AdherenceReport {
  const buckets = new Map<number, WeekAdherence>();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    buckets.set(weekStart.getTime(), {
      weekStart,
      label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i} weeks ago`,
      scheduled: 0,
      completed: 0,
      skipped: 0,
      missed: 0,
      extra: 0,
    });
  }

  for (const session of sessions) {
    const weekStart = startOfWeek(session.workoutDate, { weekStartsOn: 1 });
    weekStart.setHours(0, 0, 0, 0);
    const bucket = buckets.get(weekStart.getTime());
    if (!bucket) continue;

    const status = sessionStatus(session, today);
    if (AD_HOC_PROGRAM_IDS.includes(session.programId)) {
      if (status === 'completed') bucket.extra++;
      continue;
    }

    // A rest-day marker (see saveScheduleChanges) carries no workout — it isn't
    // a session the athlete owes anyone.
    if (!session.workoutDetails && status !== 'completed') continue;

    // Today's session is still open — counting it as scheduled would score it
    // as missed for the rest of the day.
    if (status === 'upcoming' || status === 'today') continue;

    bucket.scheduled++;
    if (status === 'completed') bucket.completed++;
    else if (status === 'skipped') bucket.skipped++;
    else bucket.missed++;
  }

  const weekList = [...buckets.values()].sort(
    (a, b) => a.weekStart.getTime() - b.weekStart.getTime(),
  );

  const completed = weekList.reduce((sum, w) => sum + w.completed + w.extra, 0);
  const scheduled = weekList.reduce((sum, w) => sum + w.scheduled, 0);
  const missed = weekList.reduce((sum, w) => sum + w.missed, 0);
  const skipped = weekList.reduce((sum, w) => sum + w.skipped, 0);
  const plannedCompleted = weekList.reduce((sum, w) => sum + w.completed, 0);

  return {
    weeks: weekList,
    completed,
    scheduled,
    missed,
    skipped,
    completionRate: scheduled > 0 ? Math.round((plannedCompleted / scheduled) * 100) : 0,
    averageSessionsPerWeek: weekList.length > 0
      ? Math.round((completed / weekList.length) * 10) / 10
      : 0,
  };
}

export interface StreakReport {
  /** Consecutive weeks (ending with the last complete week) with ≥1 session. */
  activeWeeks: number;
  daysSinceLastSession: number | null;
  lastSessionTitle: string | null;
  lastSessionDate: Date | null;
  totalCompleted: number;
}

export function computeStreak(sessions: WorkoutSession[], today: Date): StreakReport {
  const completed = sessions
    .filter(s => !!s.finishedAt)
    .sort((a, b) => b.workoutDate.getTime() - a.workoutDate.getTime());

  const last = completed[0] ?? null;

  const weeksWithWork = new Set(
    completed.map(s => startOfWeek(s.workoutDate, { weekStartsOn: 1 }).getTime()),
  );

  // Count back from last week, not this one: a Monday check-in shouldn't read
  // as a broken streak just because the week has barely started.
  let activeWeeks = 0;
  const cursor = startOfWeek(today, { weekStartsOn: 1 });
  if (weeksWithWork.has(cursor.getTime())) activeWeeks++;
  cursor.setDate(cursor.getDate() - 7);
  while (weeksWithWork.has(cursor.getTime())) {
    activeWeeks++;
    cursor.setDate(cursor.getDate() - 7);
  }

  return {
    activeWeeks,
    daysSinceLastSession: last ? differenceInCalendarDays(today, last.workoutDate) : null,
    lastSessionTitle: last?.workoutTitle ?? null,
    lastSessionDate: last?.workoutDate ?? null,
    totalCompleted: completed.length,
  };
}

export interface SkipPattern {
  /** e.g. "Thursday" or a workout title. */
  label: string;
  missed: number;
  scheduled: number;
}

export interface SkipPatternReport {
  byWeekday: SkipPattern[];
  byWorkout: SkipPattern[];
}

/**
 * Where the plan is actually breaking down. A coach who can say "it's always
 * the Thursday intervals" is doing something a plan alone cannot.
 * Only patterns with 2+ misses are returned — one skipped session is a life
 * event, not a pattern.
 */
export function findSkipPatterns(sessions: WorkoutSession[], today: Date): SkipPatternReport {
  const weekdays = new Map<string, SkipPattern>();
  const workouts = new Map<string, SkipPattern>();

  for (const session of sessions) {
    if (AD_HOC_PROGRAM_IDS.includes(session.programId)) continue;
    const status = sessionStatus(session, today);
    if (status === 'upcoming' || status === 'today') continue;
    if (!session.workoutDetails && status !== 'completed') continue;

    const weekdayKey = format(session.workoutDate, 'EEEE');
    const titleKey = session.workoutTitle || 'Untitled';
    const dropped = status === 'missed' || status === 'skipped';

    for (const [map, key] of [
      [weekdays, weekdayKey],
      [workouts, titleKey],
    ] as const) {
      const entry = map.get(key) ?? { label: key, missed: 0, scheduled: 0 };
      entry.scheduled++;
      if (dropped) entry.missed++;
      map.set(key, entry);
    }
  }

  const rank = (map: Map<string, SkipPattern>) =>
    [...map.values()]
      .filter(p => p.missed >= 2)
      .sort((a, b) => b.missed - a.missed || b.scheduled - a.scheduled)
      .slice(0, 3);

  return { byWeekday: rank(weekdays), byWorkout: rank(workouts) };
}

/** Compact journal rendering: date, mood, tags, and the athlete's own words. */
export function summariseJournalEntry(entry: JournalEntry, maxChars = 320): string {
  const meta = [format(entry.date, 'EEE d MMM')];
  if (entry.mood) meta.push(`mood: ${entry.mood}`);
  if (entry.tags?.length) meta.push(entry.tags.join('/'));

  const content = entry.content.trim();
  const trimmed = content.length > maxChars ? `${content.slice(0, maxChars)}…` : content;
  return `${meta.join(' | ')} — "${trimmed}"`;
}

/**
 * Does `haystack` mention `needle` as a movement? Deliberately loose: an
 * athlete asking about "sled" should match "Sled Push (Heavy)", and "wall
 * balls" should match "Wall Ball".
 */
export function matchesExerciseName(haystack: string, needle: string): boolean {
  const normalise = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  const target = normalise(needle);
  const source = normalise(haystack);
  if (!target || !source) return false;
  if (source.includes(target)) return true;

  // Fall back to word overlap so plurals and word order don't matter.
  const targetWords = target.split(' ').filter(w => w.length > 2).map(singularise);
  if (targetWords.length === 0) return false;
  const sourceWords = new Set(source.split(' ').map(singularise));
  return targetWords.every(word => sourceWords.has(word));
}

function singularise(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
