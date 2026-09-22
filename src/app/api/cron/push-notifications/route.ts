/**
 * Daily push notification cron job.
 * Runs every morning, finds today's workout for each subscribed user,
 * generates an AI message, and sends a push notification.
 *
 * Secure with CRON_SECRET header. In Vercel: set as a cron job at e.g. 0 7 * * *
 */

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendPushToUser } from '@/lib/web-push';
import { notificationMessage } from '@/ai/flows/notification-message';
import { mapWithLimit } from '@/lib/concurrency';
import { Timestamp } from 'firebase-admin/firestore';
import type { User, Workout, RunningWorkout } from '@/models/types';
import { calendarDayKey, normaliseTimeZone } from '@/lib/program-day';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Same ceiling daily-coach uses. This route previously fanned out with a bare
 * Promise.all over every subscriber, which is the shape src/lib/concurrency.ts
 * exists to prevent: at two thousand subscribers that was two thousand
 * simultaneous Gemini calls plus ~6000 concurrent Firestore operations from one
 * App Hosting instance, and the failure arrives all at once, at 3am.
 */
const AI_CONCURRENCY = 4;

/** Leave headroom under maxDuration so the handler always returns a summary. */
const TIME_BUDGET_MS = 150_000;

/** One run's ceiling on subscribers; the rest are picked up next run. */
const MAX_SUBSCRIBERS_PER_RUN = 500;

function getTodayWorkout(
  workouts: (Workout | RunningWorkout)[],
  startDate: Date
): Workout | RunningWorkout | null {
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  const dayNumber = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return workouts.find((w) => w.day === dayNumber) ?? null;
}

function workoutSummary(workout: Workout | RunningWorkout): string {
  if ('runs' in workout && workout.runs?.length) {
    return workout.runs
      .slice(0, 3)
      .map((r) => `${r.type} ${r.distance}km`)
      .join(', ');
  }
  if ('exercises' in workout && workout.exercises?.length) {
    return workout.exercises
      .slice(0, 3)
      .map((e: any) => e.name)
      .join(', ');
  }
  return workout.title;
}

/** Re-engagement message for users who haven't opened the app in 3+ days */
const RE_ENGAGEMENT_MESSAGES = [
  "Your training program is waiting — pick up where you left off 💪",
  "3 days since your last session. Time to get back on track!",
  "Your HYROX goals haven't changed. Have you? Come train 🔥",
  "The hardest part is showing up. Open the app and get moving.",
  "Don't lose your progress — your next workout is ready 🏋️",
];

export async function GET(request: Request) {
  const denied = requireCronAuth(request, 'push-notifications');
  if (denied) return denied;

  const db = getAdminDb();

  // Bounded: an unbounded scan grows with the subscriber list until the run no
  // longer fits in maxDuration.
  const subsSnap = await db.collection('pushSubscriptions').limit(MAX_SUBSCRIBERS_PER_RUN).get();
  if (subsSnap.empty) {
    return NextResponse.json({ message: 'No push subscribers' });
  }

  // Build unique userId list from subscriptions
  const userIds = [...new Set(subsSnap.docs.map((d) => d.data().userId as string))];

  // Batch fetch users
  const userDocs = await Promise.all(
    userIds.map((id) => db.collection('users').doc(id).get())
  );

  // Resolve every distinct programme once, rather than 1-2 document reads per
  // subscriber inside the loop below. Programmes are shared across athletes, so
  // that per-user lookup was almost entirely redundant. Same approach as
  // daily-coach: check the public collection first, then only the ids it did not
  // resolve against customPrograms.
  const programIds = [...new Set(
    userDocs.filter(d => d.exists).map(d => (d.data() as User).programId).filter((id): id is string => !!id)
  )];
  const programCache = new Map<string, Record<string, unknown> | undefined>();
  if (programIds.length > 0) {
    const publicSnaps = await Promise.all(
      programIds.map(id => db.collection('programs').doc(id).get())
    );
    for (const snap of publicSnaps) {
      if (snap.exists) programCache.set(snap.id, snap.data());
    }
    const unresolvedIds = programIds.filter(id => !programCache.has(id));
    if (unresolvedIds.length > 0) {
      const customSnaps = await Promise.all(
        unresolvedIds.map(id => db.collection('customPrograms').doc(id).get())
      );
      for (const snap of customSnaps) {
        if (snap.exists) programCache.set(snap.id, snap.data());
      }
    }
  }

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const results = { sent: 0, skipped: 0, errors: 0 };
  const startedAt = Date.now();
  let skippedForTime = 0;

  await mapWithLimit(userDocs, AI_CONCURRENCY, async (userDoc) => {
      if (!userDoc.exists) return;

      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        skippedForTime++;
        return;
      }

      const user = userDoc.data() as User;
      const userId = userDoc.id;

      // Skip if trial ended / canceled
      const status = user.subscriptionStatus ?? 'trial';
      if (!['trial', 'active', 'paused'].includes(status)) {
        results.skipped++;
        return;
      }

      // They paused their plan for a break: no reminders, no "come back" nags.
      if (user.planPausedAt) {
        results.skipped++;
        return;
      }

      try {
        // Determine today's workout
        let workoutTitle = "Today's Training";
        let exerciseSummary = 'Keep up the great work!';
        let notifUrl = '/dashboard';

        if (user.programId && user.startDate) {
          const startDate =
            user.startDate instanceof Timestamp
              ? user.startDate.toDate()
              : new Date(user.startDate as any);

          // Resolved once above, across both collections.
          const programData = programCache.get(user.programId);
          if (programData) {
            const workouts = programData.workouts as (Workout | RunningWorkout)[];
            const customWorkouts = user.customProgram;
            const allWorkouts = customWorkouts?.length ? customWorkouts : workouts;
            const todayWorkout = getTodayWorkout(allWorkouts ?? [], startDate);

            if (todayWorkout) {
              workoutTitle = todayWorkout.title;
              exerciseSummary = workoutSummary(todayWorkout);
              notifUrl = '/workout/active';
            }
          }
        }

        // Check if this is a re-engagement scenario (no recent session)
        const recentSessionSnap = await db
          .collection('workoutSessions')
          .where('userId', '==', userId)
          .where('startedAt', '>=', Timestamp.fromDate(threeDaysAgo))
          .limit(1)
          .get();

        let messageBody: string;
        const commitment = user.trainingCommitment;
        const committedToday =
          !!commitment && commitment.date === calendarDayKey(now, normaliseTimeZone(user.timeZone));

        if (committedToday) {
          // They pressed "Do it tomorrow" yesterday: hold them to it, by name.
          messageBody = `You said today's the day — ${commitment!.workoutTitle} is ready when you are 💪`;
          notifUrl = '/workout/active';
          await db.collection('users').doc(userId).update({ trainingCommitment: null });
        } else if (recentSessionSnap.empty) {
          // Re-engagement: pick a rotating message
          const idx = now.getDate() % RE_ENGAGEMENT_MESSAGES.length;
          messageBody = RE_ENGAGEMENT_MESSAGES[idx];
        } else {
          // Daily workout reminder: use AI
          try {
            const aiResult = await notificationMessage({
              userName: user.firstName || 'Athlete',
              workoutTitle,
              exercises: exerciseSummary,
            });
            messageBody = aiResult.message;
          } catch {
            messageBody = `${workoutTitle} is scheduled for today. Let's go! 💪`;
          }
        }

        const { sent } = await sendPushToUser(userId, {
          title: 'HYBRIDX Training',
          body: messageBody,
          url: notifUrl,
        });

        if (sent > 0) results.sent++;
        else results.skipped++;
      } catch (err) {
        logger.error(`Push failed for user ${userId}:`, err);
        results.errors++;
      }
  });

  return NextResponse.json({
    success: true,
    results,
    subscribers: userIds.length,
    skippedForTime,
  });
}
