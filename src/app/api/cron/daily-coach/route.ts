// src/app/api/cron/daily-coach/route.ts
//
// Adaptive coaching: for every athlete who missed yesterday's session, ask the
// model whether today's should be eased, and write the adjustment.
//
// This endpoint had no Cloud Scheduler job until 2026-08-25, so none of it had
// ever run in production. The shape it was written in would not have survived
// the first execution: it fanned out with Promise.all over every user, which
// starts one model call per missed athlete simultaneously.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { analyzeAndAdjust } from '@/ai/flows/analyze-and-adjust';
import { mapWithLimit } from '@/lib/concurrency';
import { logger } from '@/lib/logger';
import { formatNotesForPrompt, getActiveNotes } from '@/services/coach-notes';

import { FieldValue } from 'firebase-admin/firestore';
import type { User, Workout, RunningWorkout } from '@/models/types';

// Allow this route to run for up to 5 minutes (if platform supports it)
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Model calls in flight at once.
 *
 * The original Promise.all started one per missed athlete, so a few hundred
 * missed sessions meant a few hundred simultaneous Gemini requests: rate
 * limits, and a run that cannot finish inside its deadline. Four keeps the job
 * moving without any single night's misses looking like an attack.
 */
const AI_CONCURRENCY = 4;

/**
 * Stop starting new athletes past this point, and report what is left.
 *
 * Must stay under both maxDuration and the Cloud Scheduler attemptDeadline, so
 * an overrun becomes a truthful partial result rather than a killed container
 * that reports nothing. Anyone skipped is picked up tomorrow — a missed
 * adjustment is a small loss, an invisible failure is not.
 */
const TIME_BUDGET_MS = 150_000;

export async function GET(request: Request) {
  const denied = requireCronAuth(request, 'daily-coach');
  if (denied) return denied;

  const db = getAdminDb();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startOfYesterday = new Date(yesterday); startOfYesterday.setHours(0,0,0,0);
  const endOfYesterday = new Date(yesterday);   endOfYesterday.setHours(23,59,59,999);

  // 1. Get active users and ALL of yesterday's completed sessions in parallel — 2 queries total
  //    instead of 1 + N (one per user).
  const [usersSnap, sessionsSnap] = await Promise.all([
    db.collection('users').where('programId', '!=', null).get(),
    db.collection('workoutSessions')
      .where('finishedAt', '>=', startOfYesterday)
      .where('finishedAt', '<=', endOfYesterday)
      .get(),
  ]);

  // Build a Set of userIds who completed a session yesterday — O(1) lookup per user.
  const trainedYesterday = new Set(sessionsSnap.docs.map(d => d.data().userId as string));

  const results = {
    processed: 0,
    missed: 0,
    adjusted: 0,
    errors: 0
  };

  // 2. Collect unique programIds from users who missed, then batch-fetch those programs.
  const missedUsers = usersSnap.docs.filter(d => !trainedYesterday.has(d.id) && d.data().programId);
  const uniqueProgramIds = [...new Set(missedUsers.map(d => d.data().programId as string))];

  // Programs live in `programs` (public) or `customPrograms` (assigned to
  // specific athletes) and share an id space, so both are checked. Custom
  // programs are the rarer case, so they are only looked up for the ids the
  // public collection did not resolve.
  const programSnaps = await Promise.all(
    uniqueProgramIds.map(id => db.collection('programs').doc(id).get())
  );
  const programCache = new Map(
    programSnaps.filter(s => s.exists).map(s => [s.id, s.data()])
  );

  const unresolvedIds = uniqueProgramIds.filter(id => !programCache.has(id));
  if (unresolvedIds.length > 0) {
    const customSnaps = await Promise.all(
      unresolvedIds.map(id => db.collection('customPrograms').doc(id).get())
    );
    for (const snap of customSnaps) {
      if (snap.exists) programCache.set(snap.id, snap.data());
    }
  }

  const startedAt = Date.now();
  let skippedForTime = 0;

  // Only athletes who actually missed are candidates — the original mapped over
  // every user and returned early inside, which made `processed` count the
  // whole roster and hid how much work a run really did.
  await mapWithLimit(missedUsers, AI_CONCURRENCY, async (userDoc) => {
    const userId = userDoc.id;

    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedForTime++;
      return;
    }

    try {
      const userData = userDoc.data() as User;
      results.processed++;

      const programData = programCache.get(userData.programId!);
      if (!programData) return;

      const workouts = programData.workouts as (Workout | RunningWorkout)[];
      if (!workouts || !userData.startDate) return;

      results.missed++;

      const startDate =
        userData.startDate instanceof Date
          ? userData.startDate
          : new Date((userData.startDate as any).toDate?.() ?? userData.startDate);

      // Day numbering must match garmin-sync, or the two features disagree
      // about which workout "today" is for the same athlete. Both snap to UTC
      // midnight first, because the browser stores the start date as local
      // midnight and the raw difference otherwise carries a partial day.
      //
      // Two bugs fixed here. Math.abs turned a start date in the *future* into
      // a positive day number, picking a workout for an athlete whose
      // programme had not begun; and Math.ceil over that partial day rounded
      // the count up, landing a day early.
      const startMs = Math.round(startDate.getTime() / 86_400_000) * 86_400_000;
      const todayMs = Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      );
      const todayDiffDays = Math.floor((todayMs - startMs) / 86_400_000) + 1;
      if (todayDiffDays < 1) return; // programme has not started yet

      const todaysWorkout = workouts.find((w) => w.day === todayDiffDays);
      if (!todaysWorkout) return; // Rest day or end of program

      // What the athlete has told their coach. Without this the job reads every
      // missed session as a lapse, so the athlete who said "I'm in Spain until
      // the 19th" gets told off for being in Spain — the fastest way to teach
      // someone that telling the coach things is pointless.
      const notes = await getActiveNotes(userId, today);
      const noteContext = formatNotesForPrompt(notes, today);
      const onABreak = notes.some((note) => note.category === 'availability');

      const aiResponse = await analyzeAndAdjust({
        // The input schema requires both. An athlete who never set a name or a
        // goal would otherwise fail zod validation and be counted as an error
        // every single night, for a field that has nothing to do with training.
        userName: userData.firstName || 'there',
        userGoal: userData.goal || 'general fitness',
        recentHistory: [
          {
            date: yesterday.toISOString().split('T')[0],
            workoutTitle: 'Scheduled Workout',
            skipped: true, // Key signal
            notes: 'System detected missed session.',
          },
        ],
        upcomingWorkouts: [{ ...todaysWorkout, day: todayDiffDays } as any],
        customRequest: noteContext
          ? `I missed yesterday. Should I adjust today? Here is what I have already told my coach — take it into account rather than treating the miss as a lapse:\n${noteContext}`
          : 'I missed yesterday. Should I adjust today?',
      });

      if (aiResponse.needsAdjustment && aiResponse.adjustments?.length) {
        const newAdjustment = aiResponse.adjustments[0].modifiedWorkout;

        let currentCustom = userData.customProgram || [];
        currentCustom = currentCustom.filter((w) => w.day !== newAdjustment.day);
        currentCustom.push(newAdjustment as any);

        await db.collection('users').doc(userId).update({
          customProgram: currentCustom,
        });

        results.adjusted++;

        await db.collection('notifications').add({
          userId,
          title: 'Plan Adjusted 🤖',
          // An athlete who told us they'd be away gets an acknowledgement, not
          // an accusation. Same adjustment either way — different sentence.
          body: onABreak
            ? `I know you've got a lot on at the moment — I've reshaped today's ${todaysWorkout.title} so it still works if you get a window.`
            : `Since you missed yesterday, I've modified today's ${todaysWorkout.title} to be more manageable.`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
          type: 'ai-adjustment',
        });
      }
    } catch (err) {
      // Caught per athlete so one bad record cannot abandon the rest of the
      // run. logger.error rather than logger.log: the latter compiles out in
      // production, which is how a nightly job fails silently for months.
      logger.error(
        `[cron/daily-coach] user ${userId} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      results.errors++;
    }
  });

  if (skippedForTime) {
    logger.error(
      `[cron/daily-coach] time budget reached; ${skippedForTime} athletes deferred to tomorrow`,
    );
  }

  return NextResponse.json({
    success: true,
    results: { ...results, candidates: missedUsers.length, skippedForTime },
  });
}
