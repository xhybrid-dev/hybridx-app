/**
 * Workout reminders. Runs every 15 minutes and sends to athletes whose chosen
 * reminder time (Profile → Daily Workout Notifications) falls in the current
 * quarter-hour of their own timezone — at most once per athlete per day.
 *
 * What gets sent is decided in lib/reminders.ts: today's session on a
 * training day, nothing on a rest day or a paused plan, the session they
 * committed to with "Do it tomorrow", and a few spaced-out nudges (then
 * silence) for athletes who have stopped opening the app.
 *
 * Previously this fired once at 07:00 UTC for everyone, worked out "today"
 * with UTC arithmetic, ignored customised plans (so quick-start athletes
 * always got a generic line), nagged lapsed athletes daily for ever, and only
 * ever read the first 500 subscriptions.
 */

import { NextResponse } from 'next/server';
import { differenceInCalendarDays } from 'date-fns';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { requireCronAuth } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendPushToUser } from '@/lib/web-push';
import { notificationMessage } from '@/ai/flows/notification-message';
import { mapWithLimit } from '@/lib/concurrency';
import { calendarDayKey, normaliseTimeZone } from '@/lib/program-day';
import { plannedFor, type DaySessionLite } from '@/lib/coach/daily-adjust';
import { isTrialExpired } from '@/lib/trial';
import {
  DEFAULT_REMINDER_TIME,
  DEFAULT_TIME_ZONE,
  decideReminder,
  isReminderDue,
  localClock,
  reengageMessage,
} from '@/lib/reminders';
import type { User, WorkoutDay } from '@/models/types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const AI_CONCURRENCY = 4;
const TIME_BUDGET_MS = 150_000;
const PAGE_SIZE = 1000;
const NON_PROGRAM_IDS = new Set(['one-off-ai', 'custom-workout']);

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

function summarise(workout: WorkoutDay): string {
  const runs = ('runs' in workout && workout.runs?.length)
    ? workout.runs.slice(0, 3).map(r => `${r.type} ${r.distance}km`)
    : [];
  const exercises = (workout.exercises ?? []).slice(0, 3).map(e => e.name);
  return [...runs, ...exercises].join(', ') || workout.title;
}

/** Every user id with at least one push destination, paged so nobody past the first page is dropped. */
async function subscribedUserIds(db: FirebaseFirestore.Firestore): Promise<string[]> {
  const ids = new Set<string>();
  for (const collection of ['pushSubscriptions', 'pushTokens']) {
    let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let query = db.collection(collection).orderBy(FieldPath.documentId()).select('userId').limit(PAGE_SIZE);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      page.docs.forEach(doc => {
        const userId = doc.get('userId');
        if (typeof userId === 'string') ids.add(userId);
      });
      if (page.size < PAGE_SIZE) break;
      last = page.docs[page.docs.length - 1];
    }
  }
  return [...ids];
}

export async function GET(request: Request) {
  const denied = requireCronAuth(request, 'push-notifications');
  if (denied) return denied;

  const db = getAdminDb();
  const now = new Date();
  const startedAt = Date.now();

  const userIds = await subscribedUserIds(db);
  if (userIds.length === 0) return NextResponse.json({ message: 'No push subscribers' });

  // Only athletes whose reminder slot is now, and who haven't had today's yet.
  const due: { id: string; user: User; timeZone: string; dateKey: string }[] = [];
  for (let i = 0; i < userIds.length; i += 300) {
    const refs = userIds.slice(i, i + 300).map(id => db.collection('users').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const user = snap.data() as User & { lastReminderDate?: string };
      const timeZone = normaliseTimeZone(user.timeZone) ?? DEFAULT_TIME_ZONE;
      const clock = localClock(now, timeZone);
      if (!isReminderDue(clock, user.notificationTime ?? DEFAULT_REMINDER_TIME)) continue;
      if (user.lastReminderDate === clock.dateKey) continue;
      if (!hasAccess(user) || user.planPausedAt) continue;
      due.push({ id: snap.id, user, timeZone, dateKey: clock.dateKey });
    }
  }

  // Base programs for the due athletes only.
  const programIds = [...new Set(due.map(d => d.user.programId).filter((id): id is string => !!id))];
  const programCache = new Map<string, WorkoutDay[]>();
  for (const collection of ['programs', 'customPrograms']) {
    const missing = programIds.filter(id => !programCache.has(id));
    if (missing.length === 0) break;
    const snaps = await Promise.all(missing.map(id => db.collection(collection).doc(id).get()));
    snaps.forEach(snap => {
      if (snap.exists) programCache.set(snap.id, (snap.data()?.workouts ?? []) as WorkoutDay[]);
    });
  }

  const results = { due: due.length, sent: 0, silent: 0, errors: 0, skippedForTime: 0 };

  await mapWithLimit(due, AI_CONCURRENCY, async ({ id: userId, user, timeZone, dateKey }) => {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      results.skippedForTime++;
      return;
    }
    try {
      // "Today" as a runtime-local midnight whose Y/M/D is the athlete's date.
      const [y, m, d] = dateKey.split('-').map(Number);
      const today = new Date(y, m - 1, d);

      let todaysWorkout: WorkoutDay | null = null;
      const startDate = toDate(user.startDate);
      const custom = (user.customProgram ?? []) as WorkoutDay[];
      const workouts = custom.length > 0 ? custom : programCache.get(user.programId ?? '') ?? [];
      if (startDate && workouts.length > 0) {
        // The athlete may have moved sessions between days; their docs win.
        const around = await db.collection('workoutSessions')
          .where('userId', '==', userId)
          .where('workoutDate', '>=', Timestamp.fromMillis(today.getTime() - 2 * 86_400_000))
          .where('workoutDate', '<=', Timestamp.fromMillis(today.getTime() + 2 * 86_400_000))
          .get();
        const todaySessions: DaySessionLite[] = around.docs
          .map(doc => doc.data())
          .filter(s => !NON_PROGRAM_IDS.has(s.programId) && calendarDayKey(toDate(s.workoutDate)!, timeZone) === dateKey)
          .map(s => ({ workoutDate: toDate(s.workoutDate)!, finishedAt: toDate(s.finishedAt), skipped: !!s.skipped, workoutDetails: s.workoutDetails ?? null }));
        if (!todaySessions.some(s => s.finishedAt)) {
          todaysWorkout = plannedFor({ workouts }, startDate, today, todaySessions, timeZone)[0] ?? null;
        }
      }

      const lastSeen = toDate(user.lastSeenAt);
      const daysSinceSeen = lastSeen ? differenceInCalendarDays(today, new Date(`${calendarDayKey(lastSeen, timeZone)}T00:00:00`)) : null;
      const commitment = user.trainingCommitment?.date === dateKey ? user.trainingCommitment.workoutTitle : null;

      const reminder = decideReminder({
        todaysWorkout: todaysWorkout ? { title: todaysWorkout.title, exercises: summarise(todaysWorkout) } : null,
        commitmentTitle: commitment,
        daysSinceSeen,
      });

      const userRef = db.collection('users').doc(userId);
      if (reminder.kind === 'none') {
        await userRef.update({ lastReminderDate: dateKey });
        results.silent++;
        return;
      }

      let body: string;
      let url = '/workout/active';
      if (reminder.kind === 'commitment') {
        body = `You said today's the day — ${reminder.workoutTitle} is ready when you are 💪`;
      } else if (reminder.kind === 'reengage') {
        body = reengageMessage(daysSinceSeen ?? 0, reminder.workoutTitle);
        url = '/dashboard';
      } else {
        try {
          const ai = await notificationMessage({
            userName: user.firstName || 'Athlete',
            workoutTitle: reminder.workoutTitle,
            exercises: reminder.exercises,
          });
          body = ai.message;
        } catch {
          body = `${reminder.workoutTitle} is on today. Let's go! 💪`;
        }
      }

      const { sent } = await sendPushToUser(userId, { title: 'HYBRIDX Training', body, url });
      await userRef.update({
        lastReminderDate: dateKey,
        ...(reminder.kind === 'commitment' ? { trainingCommitment: null } : {}),
      });
      if (sent > 0) results.sent++;
      else results.silent++;
    } catch (err) {
      logger.error(`[cron/push-notifications] user ${userId} failed:`, err instanceof Error ? err.message : String(err));
      results.errors++;
    }
  });

  if (results.skippedForTime) {
    logger.error(`[cron/push-notifications] time budget reached; ${results.skippedForTime} reminders not sent`);
  }
  return NextResponse.json({ success: true, results, subscribers: userIds.length });
}
