// src/app/api/strava/activities/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUser, updateUserAdmin } from '@/services/user-service';
import axios from 'axios';
import { getAdminAuth } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { getValidStravaToken } from '@/lib/strava-token';
import { mapStravaError, describeStravaError } from '@/lib/strava-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { demoStravaActivities, isDemoStravaToken } from '@/lib/demo-strava';

export async function GET(req: NextRequest) {
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

    // 20 requests per minute per user
    const rl = checkRateLimit(`strava-activities:${userId}`, 60_000, 20);
    if (!rl.allowed) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait before syncing again.', code: 'STRAVA_RATE_LIMITED' },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
        );
    }

    const accessToken = await getValidStravaToken(userId);

    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));

    if (isDemoStravaToken(accessToken)) {
      const activities = demoStravaActivities(120).slice((page - 1) * 30, page * 30);
      return NextResponse.json({ activities, hasMore: activities.length === 30 });
    }

    const activitiesResponse = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { per_page: 30, page },
    });

    const activities = activitiesResponse.data;
    if (page === 1) await updateUserAdmin(userId, { lastStravaSync: new Date() });

    return NextResponse.json({ activities, hasMore: activities.length === 30 });

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

    const mapped = mapStravaError(error, 'Failed to fetch activities from Strava.', scope);
    // console, not logger — logger.error strips the payload to a generic line
    // in production, and this diagnosis is the whole point of the log.
    console.error('[strava-activities] request failed', {
      userId,
      code: mapped.code,
      scope,
      ...describeStravaError(error),
    });

    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}
