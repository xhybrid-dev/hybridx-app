// src/app/api/cron/daily-coach/route.ts
//
// Adaptive coaching: for every recently active athlete who missed a session
// that was actually due yesterday, ask the model whether today's should be
// eased, apply it, and tell the athlete (in-app and by push) with an undo.
//
// Until 2026-09 this job replaced a standard-program athlete's whole plan with
// the one adjusted workout, treated rest days as misses, and wrote a
// notification nothing ever read. The decisions now live in
// lib/coach/daily-adjust.ts, where they are tested.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { analyzeAndAdjust } from '@/ai/flows/analyze-and-adjust';
import { mapWithLimit } from '@/lib/concurrency';
import { logger } from '@/lib/logger';
import { formatNotesForPrompt, getActiveNotes } from '@/services/coach-notes';
import { sendPushToUser } from '@/lib/web-push';
import { stripUndefined } from '@/lib/firestore-values';
import { normaliseTimeZone } from '@/lib/program-day';
import { getWorkoutForDay } from '@/lib/workout-utils';
import { isTrialExpired } from '@/lib/trial';
import {
  athleteDays,
  isRecentlyActive,
  missedYesterday,
  plannedFor,
  sessionsOnDay,
  withAdjustment,
  type DaySessionLite,
} from '@/lib/coach/daily-adjust';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { User, WorkoutDay } from '@/models/types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Model calls in flight at once. */
const AI_CONCURRENCY = 4;

/**
 * Stop starting new athletes past this point, so an overrun becomes a truthful
 * partial result rather than a killed container that reports nothing.
 */
const TIME_BUDGET_MS = 150_000;

/** Programme ids that are logged activity, not schedule. */
const NON_PROGRAM_IDS = new Set(['one-off-ai', 'custom-workout']);

interface SessionRow extends DaySessionLite {
  id: string;
  userId: string;
  programId: string;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function hasAccess(user: User): boolean {
  if (user.isAdmin) return true;
  const status = user.subscriptionStatus ?? 'trial';
  if (status === 'trial') return !isTrialExpired(toDate(user.trialStartDate));
  return status === 'active' || status === 'paused';
}

export async function GET(request: Request) {
  const denied = requireCronAuth(request, 'daily-coach');
  if (denied) return denied;

  const db = getAdminDb();
  const now = new Date();

  // Three days covers "yesterday" and "today" in every timezone.
  const windowStart = Timestamp.fromDate(new Date(now.getTime() - 3 * 86_400_000));

  const [usersSnap, sessionsSnap] = await Promise.all([
    db.collection('users').where('programId', '!=', null).get(),
    db.collection('workoutSessions').where('workoutDate', '>=', windowStart).get(),
  ]);

  const sessionsByUser = new Map<string, SessionRow[]>();
  for (const doc of sessionsSnap.docs) {
    const data = doc.data();
    const workoutDate = toDate(data.workoutDate);
    if (!workoutDate || !data.userId) continue;
    const row: SessionRow = {
      id: doc.id,
      userId: data.userId,
      programId: data.programId ?? '',
      workoutDate,
      finishedAt: toDate(data.finishedAt),
      skipped: !!data.skipped,
      workoutDetails: data.workoutDetails ?? null,
    };
    const list = sessionsByUser.get(row.userId) ?? [];
    list.push(row);
    sessionsByUser.set(row.userId, list);
  }

  const candidates = usersSnap.docs.filter(doc => {
    const user = doc.data() as User;
    return !!user.startDate && !user.planPausedAt && hasAccess(user) && isRecentlyActive(toDate(user.lastSeenAt), now);
  });

  // Base programs, resolved once: public collection first, then customPrograms.
  const programIds = [...new Set(candidates.map(d => d.data().programId as string))];
  const programCache = new Map<string, WorkoutDay[]>();
  const publicSnaps = await Promise.all(programIds.map(id => db.collection('programs').doc(id).get()));
  for (const snap of publicSnaps) {
    if (snap.exists) programCache.set(snap.id, (snap.data()?.workouts ?? []) as WorkoutDay[]);
  }
  const unresolved = programIds.filter(id => !programCache.has(id));
  if (unresolved.length > 0) {
    const customSnaps = await Promise.all(unresolved.map(id => db.collection('customPrograms').doc(id).get()));
    for (const snap of customSnaps) {
      if (snap.exists) programCache.set(snap.id, (snap.data()?.workouts ?? []) as WorkoutDay[]);
    }
  }

  const results = { candidates: candidates.length, missed: 0, adjusted: 0, errors: 0 };
  const startedAt = Date.now();
  let skippedForTime = 0;

  await mapWithLimit(candidates, AI_CONCURRENCY, async (userDoc) => {
    const userId = userDoc.id;
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedForTime++;
      return;
    }

    try {
      const user = userDoc.data() as User;
      const startDate = toDate(user.startDate);
      if (!startDate) return;

      const baseWorkouts = programCache.get(user.programId!) ?? [];
      const custom = (user.customProgram ?? null) as WorkoutDay[] | null;
      const workouts = custom && custom.length > 0 ? custom : baseWorkouts;
      if (workouts.length === 0) return;
      const program = { workouts };

      const timeZone = normaliseTimeZone(user.timeZone);
      const days = athleteDays(now, timeZone);
      const programDay = getWorkoutForDay(program, startDate, days.today, timeZone).day;
      if (programDay < 2) return; // nothing was due before day 1

      const all = sessionsByUser.get(userId) ?? [];
      const scheduled = all.filter(s => !NON_PROGRAM_IDS.has(s.programId));

      // Any finished session counts as training, but only program sessions
      // count as something that was due.
      const missed = missedYesterday({
        program,
        startDate,
        days,
        recentSessions: all.map(s => (NON_PROGRAM_IDS.has(s.programId) ? { ...s, workoutDetails: null } : s)),
        timeZone,
      });
      if (!missed) return;

      const todaySessions = sessionsOnDay(scheduled, days.todayKey, timeZone) as SessionRow[];
      if (todaySessions.some(s => s.finishedAt)) return; // already trained today

      const planned = plannedFor(program, startDate, days.today, todaySessions, timeZone);
      const todaysWorkout = planned[0];
      if (!todaysWorkout) return; // rest day today — nothing to ease

      results.missed++;

      // What the athlete has told their coach, so a trip they mentioned is
      // treated as a trip rather than a lapse.
      const notes = await getActiveNotes(userId, now);
      const noteContext = formatNotesForPrompt(notes, now);
      const onABreak = notes.some(note => note.category === 'availability');

      const aiResponse = await analyzeAndAdjust({
        userName: user.firstName || 'there',
        userGoal: user.goal || 'general fitness',
        recentHistory: [
          {
            date: days.yesterdayKey,
            workoutTitle: 'Scheduled Workout',
            skipped: true,
            notes: 'System detected missed session.',
          },
        ],
        upcomingWorkouts: [{ ...todaysWorkout, day: programDay } as never],
        customRequest: noteContext
          ? `I missed yesterday. Should I adjust today? Here is what I have already told my coach — take it into account rather than treating the miss as a lapse:\n${noteContext}`
          : 'I missed yesterday. Should I adjust today?',
      });

      const adjustment = aiResponse.needsAdjustment ? aiResponse.adjustments?.[0] : undefined;
      if (!adjustment?.modifiedWorkout) return;

      const modified = stripUndefined({
        ...(adjustment.modifiedWorkout as unknown as WorkoutDay),
        day: programDay,
      }) as WorkoutDay;
      const original = stripUndefined(todaysWorkout);

      // Change what the app will actually show. An unfinished session doc for
      // today already exists when the athlete rearranged their week or opened
      // the app early; it shadows the program, so that is what gets edited.
      const persisted = todaySessions.find(s => !s.finishedAt && !s.skipped);
      let target: 'session' | 'program';
      if (persisted) {
        await db.collection('workoutSessions').doc(persisted.id).update({
          workoutDetails: modified,
          workoutTitle: modified.title,
        });
        target = 'session';
      } else {
        const nextProgram = withAdjustment(baseWorkouts, custom, {
          day: programDay,
          originalTitle: todaysWorkout.title,
          modifiedWorkout: modified,
        });
        await db.collection('users').doc(userId).update({ customProgram: stripUndefined(nextProgram) });
        target = 'program';
      }
      results.adjusted++;

      const title = 'Plan adjusted';
      const body = onABreak
        ? `I know you've got a lot on — I've reshaped today's ${todaysWorkout.title} so it still works if you get a window.`
        : `Since yesterday's session didn't happen, I've eased today's ${todaysWorkout.title}.`;

      await db.collection('notifications').add({
        userId,
        title,
        body,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
        type: 'ai-adjustment',
        target,
        sessionId: persisted?.id ?? null,
        day: programDay,
        original,
        modified,
      });

      try {
        await sendPushToUser(userId, { title, body, url: '/dashboard' });
      } catch (err) {
        logger.error(`[cron/daily-coach] push for ${userId} failed:`, err instanceof Error ? err.message : String(err));
      }
    } catch (err) {
      // Per athlete, so one bad record cannot abandon the rest of the run.
      logger.error(
        `[cron/daily-coach] user ${userId} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      results.errors++;
    }
  });

  if (skippedForTime) {
    logger.error(`[cron/daily-coach] time budget reached; ${skippedForTime} athletes deferred to tomorrow`);
  }

  return NextResponse.json({ success: true, results: { ...results, skippedForTime } });
}
