// src/app/api/strava/fix-treadmill/route.ts
//
// "Fix" a treadmill activity that a watch recorded badly.
//
// The Strava API cannot replace the data streams of an existing activity —
// only metadata can be edited in place. So the fix works by:
//   1. reading the real heart-rate / cadence streams of the original activity,
//   2. rebuilding a TCX file with the confirmed workout structure (paces,
//      durations, incline) and the real sensor data re-timed onto it,
//   3. uploading that file as a NEW Strava activity,
//   4. re-linking the workout session to the new activity.
// The original activity has to be deleted by the user on Strava (the public
// API has no delete endpoint); the client shows a deep link for that.
//
// Strava also rejects uploads that overlap an existing activity's time window
// as duplicates. When that happens we return 409 with code DUPLICATE so the
// client can tell the user to delete the original first and retry.
//
// That creates a catch-22 if handled naively: the retry needs the original
// activity's start time and sensor streams, but the user was just told to
// delete that very activity to clear the duplicate block. So the first time
// we successfully read the original activity, we cache its start time, name
// and (downsampled) sensor streams in a side collection keyed by session id.
// Every subsequent attempt for the same original activity — including the
// retry after deletion — reads from that cache instead of hitting Strava
// again. The cache is cleared once the fix succeeds.

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { cookies } from 'next/headers';
import axios from 'axios';
import { getValidStravaToken } from '@/lib/strava-token';
import { isDemoStravaToken } from '@/lib/demo-strava';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import {
  generateTcx,
  computeTotals,
  stravaStreamsToSensorPoints,
  type FlatSegment,
  type SensorAlign,
  type SensorPoint,
} from '@/lib/treadmill';
import type { WorkoutSession } from '@/models/types';

export const maxDuration = 60;

const MAX_SEGMENTS = 200;
const MAX_TOTAL_SEC = 12 * 3600;

interface FixRequestBody {
  sessionId: string;
  segments: FlatSegment[];
  name?: string;
  sensorAlign?: SensorAlign;
}

/** Validate the client-computed segments and re-derive speed server-side. */
function sanitizeSegments(raw: unknown): FlatSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SEGMENTS) return null;
  const out: FlatSegment[] = [];
  let totalSec = 0;
  for (const s of raw) {
    const timeSec = Number(s?.timeSec);
    const distanceM = Number(s?.distanceM);
    const incline = Number(s?.incline);
    if (!(timeSec > 0) || !(distanceM > 0) || isNaN(incline)) return null;
    if (timeSec > MAX_TOTAL_SEC || distanceM > 500_000) return null;
    totalSec += timeSec;
    out.push({
      name: typeof s?.name === 'string' ? s.name.slice(0, 120) : 'Segment',
      timeSec,
      distanceM,
      speedMps: distanceM / timeSec,
      incline: Math.max(-10, Math.min(40, incline)),
    });
  }
  if (totalSec > MAX_TOTAL_SEC) return null;
  return out;
}

async function fetchSensorPoints(activityId: string, accessToken: string): Promise<SensorPoint[]> {
  try {
    const res = await axios.get(
      `https://www.strava.com/api/v3/activities/${activityId}/streams`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { keys: 'time,heartrate,cadence', key_by_type: true },
      },
    );
    return stravaStreamsToSensorPoints(res.data || {});
  } catch (err) {
    // Manual activities (created without a file) have no streams — that's
    // fine, the rebuilt file simply carries no HR/cadence.
    logger.warn('fix-treadmill: no streams available for activity', {
      activityId,
      status: (err as any).response?.status,
    });
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FixCache {
  originalStravaId: string;
  startDate: string;
  name: string;
  sensorPoints: SensorPoint[];
  cachedAt: string;
}

const MAX_CACHED_SENSOR_POINTS = 3000;

/** Stride-based downsample so the cached doc stays well under Firestore's
 *  1MiB limit even for very long activities. buildActivity() interpolates
 *  linearly between points anyway, so losing some resolution on slow-moving
 *  signals like HR/cadence costs negligible accuracy. */
function capSensorPoints(points: SensorPoint[]): SensorPoint[] {
  if (points.length <= MAX_CACHED_SENSOR_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_CACHED_SENSOR_POINTS);
  const out: SensorPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FixRequestBody;
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const segments = sanitizeSegments(body.segments);
    if (!segments) {
      return NextResponse.json({ error: 'Invalid workout segments' }, { status: 400 });
    }
    const sensorAlign: SensorAlign = body.sensorAlign === 'realtime' ? 'realtime' : 'stretch';

    // Authenticate user
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const decodedToken = await getAuth().verifySessionCookie(sessionCookie, true);
    const userId = decodedToken.uid;

    // 3 fixes per minute per user — uploads are expensive on Strava's side
    const rl = checkRateLimit(`strava-fix:${userId}`, 60_000, 3);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    let accessToken: string;
    try {
      accessToken = await getValidStravaToken(userId);
    } catch (tokenErr: any) {
      if (tokenErr.code === 'STRAVA_NOT_CONNECTED') {
        return NextResponse.json({ error: 'Strava account not connected.' }, { status: 400 });
      }
      return NextResponse.json(
        { error: 'Strava connection expired. Please reconnect your account.' },
        { status: 401 },
      );
    }
    if (isDemoStravaToken(accessToken)) {
      return NextResponse.json({ error: 'The treadmill fixer is not available on the demo account.' }, { status: 400 });
    }

    // Load and verify the workout session
    const adminDb = getAdminDb();
    const sessionRef = adminDb.collection('workoutSessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists || sessionDoc.data()?.userId !== userId) {
      return NextResponse.json({ error: 'Workout session not found or access denied' }, { status: 404 });
    }
    const session = sessionDoc.data() as WorkoutSession;
    const originalActivityId = session.stravaId;
    if (!originalActivityId) {
      return NextResponse.json(
        { error: 'No Strava activity is linked to this session yet.' },
        { status: 400 },
      );
    }

    // Original activity: gives us the true start time and the sensor streams.
    // Reuse the cached copy from a prior attempt (if any) so a retry works
    // even after the user has deleted the original on Strava to clear a
    // duplicate-upload block — see the file header comment.
    const fixCacheRef = adminDb.collection('treadmillFixCache').doc(sessionId);
    const cachedDoc = await fixCacheRef.get();
    const cached = cachedDoc.exists ? (cachedDoc.data() as FixCache) : null;

    let originalStart: Date;
    let originalName = '';
    let sensorPoints: SensorPoint[];

    if (cached && cached.originalStravaId === originalActivityId) {
      originalStart = new Date(cached.startDate);
      originalName = cached.name;
      sensorPoints = cached.sensorPoints;
      logger.info('fix-treadmill: reusing cached original activity data', { originalActivityId, sessionId });
    } else {
      try {
        const actRes = await axios.get(
          `https://www.strava.com/api/v3/activities/${originalActivityId}`,
          { headers: { Authorization: `Bearer ${accessToken}` }, params: { include_all_efforts: false } },
        );
        originalStart = new Date(actRes.data.start_date);
        originalName = actRes.data.name || '';
        if (isNaN(originalStart.getTime())) throw new Error('Invalid start_date');
      } catch (err) {
        logger.error('fix-treadmill: could not fetch original activity', {
          originalActivityId,
          status: (err as any).response?.status,
        });
        return NextResponse.json(
          { error: 'Could not read the original Strava activity. It may have been deleted.' },
          { status: 404 },
        );
      }

      sensorPoints = await fetchSensorPoints(originalActivityId, accessToken);

      // Best-effort cache write — if it fails, the fix still proceeds; a
      // retry after deleting the original would just fail with the 404
      // above instead of using the cache.
      try {
        const cachePayload: FixCache = {
          originalStravaId: originalActivityId,
          startDate: originalStart.toISOString(),
          name: originalName,
          sensorPoints: capSensorPoints(sensorPoints),
          cachedAt: new Date().toISOString(),
        };
        await fixCacheRef.set(cachePayload);
      } catch (cacheErr) {
        logger.warn('fix-treadmill: failed to cache original activity data', { sessionId, cacheErr });
      }
    }

    const name = (typeof body.name === 'string' && body.name.trim())
      ? body.name.trim().slice(0, 120)
      : originalName || session.workoutTitle || 'Treadmill Run';

    const tcx = generateTcx({
      name,
      startTime: originalStart,
      segments,
      resolutionSec: 3,
      sensorPoints,
      sensorAlign,
    });

    // Upload the corrected file as a new activity
    const totals = computeTotals(segments);
    const externalId = `hybridx-treadmill-fix-${sessionId}-${Date.now()}.tcx`;
    const form = new FormData();
    form.append('file', new Blob([tcx], { type: 'application/xml' }), externalId);
    form.append('data_type', 'tcx');
    form.append('name', name);
    form.append('trainer', '1');
    form.append('external_id', externalId);
    form.append(
      'description',
      `Treadmill workout rebuilt with HYBRIDX.CLUB — prescribed paces with recorded heart rate${
        sensorPoints.some((p) => p.cad !== null) ? ' and cadence' : ''
      }.`,
    );

    const uploadRes = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      logger.error('fix-treadmill: upload request failed', { status: uploadRes.status, data: uploadData });
      return NextResponse.json(
        { error: uploadData?.message || 'Strava rejected the upload.' },
        { status: 502 },
      );
    }

    // Poll upload processing until Strava assigns an activity id
    const uploadId = uploadData.id;
    let newActivityId: number | null = uploadData.activity_id ?? null;
    let uploadError: string | null = uploadData.error ?? null;
    for (let attempt = 0; attempt < 20 && !newActivityId && !uploadError; attempt++) {
      await sleep(1500);
      try {
        const pollRes = await axios.get(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        newActivityId = pollRes.data.activity_id ?? null;
        uploadError = pollRes.data.error ?? null;
      } catch (pollErr) {
        logger.warn('fix-treadmill: upload poll failed, retrying', {
          uploadId,
          status: (pollErr as any).response?.status,
        });
      }
    }

    if (uploadError) {
      // Strava flags time-overlapping uploads as duplicates of the original.
      const dupMatch = uploadError.match(/duplicate of[^\d]*(\d+)/i);
      if (dupMatch || /duplicate/i.test(uploadError)) {
        return NextResponse.json(
          {
            error:
              'Strava flagged the corrected file as a duplicate of the original activity. Delete the original on Strava, then retry.',
            code: 'DUPLICATE',
            duplicateOfId: dupMatch?.[1] || originalActivityId,
          },
          { status: 409 },
        );
      }
      logger.error('fix-treadmill: Strava upload processing failed', { uploadId, uploadError });
      return NextResponse.json({ error: `Strava could not process the file: ${uploadError}` }, { status: 502 });
    }

    if (!newActivityId) {
      return NextResponse.json(
        {
          error: 'Strava is still processing the corrected file. Check your Strava feed in a minute.',
          code: 'PROCESSING',
        },
        { status: 202 },
      );
    }

    // Re-link the session to the corrected activity
    await sessionRef.update({
      stravaId: newActivityId.toString(),
      uploadedToStrava: true,
      stravaUploadedAt: new Date(),
      stravaActivity: {
        distance: totals.distanceM,
        moving_time: Math.round(totals.timeSec),
        name,
      },
      treadmillFix: {
        originalStravaId: originalActivityId,
        fixedStravaId: newActivityId.toString(),
        fixedAt: new Date(),
      },
    });

    // Cache no longer needed now the session points at the corrected activity.
    fixCacheRef.delete().catch((err) =>
      logger.warn('fix-treadmill: failed to clear fix cache', { sessionId, err }),
    );

    return NextResponse.json({
      success: true,
      newActivityId,
      newActivityUrl: `https://www.strava.com/activities/${newActivityId}`,
      originalActivityId,
      originalActivityUrl: `https://www.strava.com/activities/${originalActivityId}`,
      hadHeartRate: sensorPoints.some((p) => p.hr !== null),
      hadCadence: sensorPoints.some((p) => p.cad !== null),
    });
  } catch (error) {
    logger.error('fix-treadmill error:', {
      message: error instanceof Error ? error.message : String(error),
      response: (error as any).response?.data,
      status: (error as any).response?.status,
    });
    if ((error as any).response?.status === 401) {
      return NextResponse.json({ error: 'Strava authorization expired' }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: 'Failed to fix the treadmill activity',
        details:
          (error as any).response?.data?.message ||
          (error instanceof Error ? error.message : String(error)),
      },
      { status: 500 },
    );
  }
}
