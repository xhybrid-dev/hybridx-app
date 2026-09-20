// src/app/api/strava/training-summary/route.ts
// Returns computed training load metrics (ATL, CTL, TSB, activity breakdown)
// by fetching the athlete's recent Strava activities and processing them through
// the training-load-service. Powers the dashboard training-load card and the
// assistant's training context.

import { NextResponse } from 'next/server';
import { getUser } from '@/services/user-service';
import { computeTrainingSummary } from '@/services/training-load-service';
import { getAdminAuth } from '@/lib/firebase-admin';
import { getValidStravaToken } from '@/lib/strava-token';
import { fetchRecentActivities, mapStravaError, describeStravaError } from '@/lib/strava-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';

export async function GET() {
  let userId: string | undefined;

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Authentication required.', code: 'SESSION_EXPIRED' }, { status: 401 });
    }

    const adminAuth = getAdminAuth();
    const decodedToken = await adminAuth.verifySessionCookie(sessionCookie, true);
    userId = decodedToken.uid;

    const rl = checkRateLimit(`strava-training-summary:${userId}`, 60_000, 10);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment and try again.', code: 'STRAVA_RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const accessToken = await getValidStravaToken(userId);

    // 60 days comfortably covers the 42-day CTL window.
    const { activities, pagesFetched, partial, rateLimit } = await fetchRecentActivities(accessToken, {
      days: 60,
      perPage: 100,
      maxPages: 2,
    });

    console.info('[training-summary] fetched Strava activities', {
      userId,
      count: activities.length,
      pagesFetched,
      partial,
      rateLimit,
    });

    const summary = computeTrainingSummary(activities);

    return NextResponse.json(
      { ...summary, partial },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (error) {
    let scope: string | undefined;
    if (userId) {
      try {
        scope = (await getUser(userId))?.strava?.scope;
      } catch {
        // best-effort only
      }
    }

    const mapped = mapStravaError(error, 'Failed to compute training summary.', scope);
    console.error('[training-summary] request failed', {
      userId,
      code: mapped.code,
      scope,
      ...describeStravaError(error),
    });

    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}
