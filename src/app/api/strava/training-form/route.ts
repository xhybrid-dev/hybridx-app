// src/app/api/strava/training-form/route.ts
// Returns the full PMC time-series (daily ATL/CTL/TSB) plus the standard
// training summary for the Training Form page.

import { NextResponse } from 'next/server';
import { getUser } from '@/services/user-service';
import { computeTrainingFormSummary } from '@/services/training-load-service';
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

    // 10 requests per minute per user — the page refetches on every mount and
    // each miss costs us Strava request allowance.
    const rl = checkRateLimit(`strava-training-form:${userId}`, 60_000, 10);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment and try again.', code: 'STRAVA_RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const accessToken = await getValidStravaToken(userId);

    // 120 days so the 42-day CTL average has run-up before the charted window.
    const { activities, pagesFetched, partial, rateLimit } = await fetchRecentActivities(accessToken, {
      days: 120,
      perPage: 100,
      maxPages: 3,
    });

    console.info('[training-form] fetched Strava activities', {
      userId,
      count: activities.length,
      pagesFetched,
      partial,
      rateLimit,
    });

    const summary = computeTrainingFormSummary(activities);

    return NextResponse.json(
      { ...summary, partial },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (error) {
    // Strava answers 403 both for a missing activity-read grant and for an
    // exhausted daily allowance — the stored scope separates the two.
    let scope: string | undefined;
    if (userId) {
      try {
        scope = (await getUser(userId))?.strava?.scope;
      } catch {
        // best-effort only — never let the diagnostic lookup mask the real error
      }
    }

    const mapped = mapStravaError(error, 'Failed to compute training form data.', scope);
    console.error('[training-form] request failed', {
      userId,
      code: mapped.code,
      scope,
      ...describeStravaError(error),
    });

    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}
