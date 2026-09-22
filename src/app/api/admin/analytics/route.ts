import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { getUser } from '@/services/user-service';
import { cookies } from 'next/headers';
import { Timestamp } from 'firebase-admin/firestore';
import { computeRetention } from '@/lib/retention';

/** Cohorts reported: signups in the last this-many weeks. */
const COHORT_WEEKS = 10;

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    const user = await getUser(decodedToken.uid);
    if (!user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getAdminDb();
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') ?? '30', 10);
    const excludeAdmins = searchParams.get('excludeAdmins') === 'true';
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffTs = Timestamp.fromDate(cutoff);

    // Fetch admin user IDs if exclusion is requested
    const adminUserIds = new Set<string>();
    if (excludeAdmins) {
      const adminSnapshot = await db.collection('users').where('isAdmin', '==', true).get();
      adminSnapshot.docs.forEach((d) => adminUserIds.add(d.id));
    }

    // Fetch all events in the time window (admin SDK, no index needed)
    const snapshot = await db
      .collection('analyticsEvents')
      .where('timestamp', '>=', cutoffTs)
      .orderBy('timestamp', 'desc')
      .get();

    type EventDoc = {
      userId: string;
      event: string;
      properties: Record<string, unknown>;
      platform: string;
      sessionId: string;
      timestamp: Timestamp;
    };

    const allEvents: EventDoc[] = snapshot.docs.map((d) => d.data() as EventDoc);
    const events = excludeAdmins
      ? allEvents.filter((e) => !adminUserIds.has(e.userId))
      : allEvents;

    // ---- Retention ----
    const now = Date.now();
    const dau = new Set<string>();
    const wau = new Set<string>();
    const mau = new Set<string>();
    const d1 = now - 1 * 24 * 60 * 60 * 1000;
    const d7 = now - 7 * 24 * 60 * 60 * 1000;
    const d30 = now - 30 * 24 * 60 * 60 * 1000;

    for (const e of events) {
      if (e.event !== 'session_start') continue;
      const ts = e.timestamp?.toMillis?.() ?? 0;
      const uid = e.userId;
      if (uid === 'anonymous') continue;
      if (ts >= d1) dau.add(uid);
      if (ts >= d7) wau.add(uid);
      if (ts >= d30) mau.add(uid);
    }

    // ---- Onboarding funnel ----
    // Count unique users who reached each step
    const onboardingStepUsers: Record<number, Set<string>> = {};
    const onboardingCompletedUsers = new Set<string>();

    for (const e of events) {
      if (e.event === 'onboarding_step_completed') {
        const step = (e.properties?.step as number) ?? 0;
        if (!onboardingStepUsers[step]) onboardingStepUsers[step] = new Set();
        if (e.userId !== 'anonymous') {
          onboardingStepUsers[step].add(e.userId);
        } else {
          // Pre-signup anonymous users tracked by session
          onboardingStepUsers[step].add(e.sessionId);
        }
      }
      if (e.event === 'onboarding_completed') {
        onboardingCompletedUsers.add(e.userId);
      }
    }

    // signup_page_viewed = top of funnel
    const signupPageViews = events.filter((e) => e.event === 'signup_page_viewed').length;
    const signupSessionIds = new Set(
      events.filter((e) => e.event === 'signup_page_viewed').map((e) => e.sessionId)
    );

    const funnel = [
      { step: 0, label: 'Visited Signup', count: signupSessionIds.size },
      { step: 1, label: 'Email & Password', count: onboardingStepUsers[1]?.size ?? 0 },
      { step: 2, label: 'Name', count: onboardingStepUsers[2]?.size ?? 0 },
      { step: 3, label: 'Experience Level', count: onboardingStepUsers[3]?.size ?? 0 },
      { step: 4, label: 'Training Frequency', count: onboardingStepUsers[4]?.size ?? 0 },
      { step: 5, label: 'Primary Goal', count: onboardingStepUsers[5]?.size ?? 0 },
      { step: 6, label: 'Program Selected', count: onboardingCompletedUsers.size },
    ];

    // ---- Platform breakdown ----
    const platformCounts: Record<string, number> = {};
    const seenSessionsByPlatform = new Set<string>();
    for (const e of events) {
      if (e.event !== 'session_start') continue;
      const key = `${e.sessionId}`;
      if (seenSessionsByPlatform.has(key)) continue;
      seenSessionsByPlatform.add(key);
      const p = e.platform || 'unknown';
      platformCounts[p] = (platformCounts[p] ?? 0) + 1;
    }

    // ---- Feature / page usage ----
    const pageCounts: Record<string, number> = {};
    for (const e of events) {
      if (e.event !== 'page_view') continue;
      const path = (e.properties?.path as string) ?? 'unknown';
      // Normalise dynamic segments like /workout/abc123 → /workout/[id]
      const normalized = path.replace(/\/[a-f0-9]{20,}/, '/[id]');
      pageCounts[normalized] = (pageCounts[normalized] ?? 0) + 1;
    }
    const topPages = Object.entries(pageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    // ---- Session duration ----
    const durations: number[] = events
      .filter((e) => e.event === 'session_end')
      .map((e) => (e.properties?.durationSeconds as number) ?? 0)
      .filter((d) => d > 0 && d < 86400); // sanity filter

    const avgSessionSeconds =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    // Bucket into 0-1min, 1-5min, 5-15min, 15-30min, 30min+
    const durationBuckets = [
      { label: '< 1 min', count: durations.filter((d) => d < 60).length },
      { label: '1-5 min', count: durations.filter((d) => d >= 60 && d < 300).length },
      { label: '5-15 min', count: durations.filter((d) => d >= 300 && d < 900).length },
      { label: '15-30 min', count: durations.filter((d) => d >= 900 && d < 1800).length },
      { label: '30+ min', count: durations.filter((d) => d >= 1800).length },
    ];

    // ---- PWA stats ----
    const pwaShown = events.filter((e) => e.event === 'pwa_prompt_shown').length;
    const pwaAccepted = events.filter((e) => e.event === 'pwa_install_accepted').length;
    const pwaDismissed = events.filter((e) => e.event === 'pwa_install_dismissed').length;

    // ---- Daily active users (last 30 days bar chart) ----
    const dailyActive: Record<string, Set<string>> = {};
    for (const e of events) {
      if (e.event !== 'session_start') continue;
      if (e.userId === 'anonymous') continue;
      const ts = e.timestamp?.toMillis?.() ?? 0;
      const date = new Date(ts).toISOString().slice(0, 10);
      if (!dailyActive[date]) dailyActive[date] = new Set();
      dailyActive[date].add(e.userId);
    }
    const dauChart = Object.entries(dailyActive)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
      .map(([date, users]) => ({ date, users: users.size }));

    // ---- Activation & cohort retention (from workout history, not events) ----
    const cohortCutoff = Timestamp.fromMillis(Date.now() - COHORT_WEEKS * 7 * 24 * 60 * 60 * 1000);
    const [signupSnap, finishedSnap] = await Promise.all([
      db.collection('users').where('trialStartDate', '>=', cohortCutoff).get(),
      db.collection('workoutSessions').where('finishedAt', '>=', cohortCutoff).get(),
    ]);
    const signups = signupSnap.docs
      .filter((d) => !adminUserIds.has(d.id) && !d.data().isAdmin)
      .map((d) => ({ userId: d.id, signedUpAt: (d.data().trialStartDate as Timestamp).toDate() }));
    const finished = finishedSnap.docs
      .map((d) => d.data())
      .filter((d) => !d.skipped && d.finishedAt && d.userId)
      .map((d) => ({ userId: d.userId as string, finishedAt: (d.finishedAt as Timestamp).toDate() }));
    const retentionReport = computeRetention(signups, finished, new Date(), 8);

    return NextResponse.json({
      activation: retentionReport.activation,
      cohorts: retentionReport.cohorts,
      retention: {
        dau: dau.size,
        wau: wau.size,
        mau: mau.size,
      },
      onboardingFunnel: funnel,
      signupPageViews,
      platforms: Object.entries(platformCounts).map(([platform, sessions]) => ({
        platform,
        sessions,
      })),
      topPages,
      sessionDuration: {
        avgSeconds: avgSessionSeconds,
        buckets: durationBuckets,
        totalSessions: durations.length,
      },
      pwa: {
        shown: pwaShown,
        accepted: pwaAccepted,
        dismissed: pwaDismissed,
        installRate: pwaShown > 0 ? Math.round((pwaAccepted / pwaShown) * 100) : 0,
      },
      dauChart,
      totalEvents: events.length,
      windowDays: days,
    });
  } catch (err) {
    console.error('Analytics API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
