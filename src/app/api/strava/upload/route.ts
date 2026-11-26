// src/app/api/strava/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { cookies } from 'next/headers';
import { getValidStravaToken } from '@/lib/strava-token';
import { isDemoStravaToken } from '@/lib/demo-strava';
import { mapStravaError, describeStravaError } from '@/lib/strava-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminDb } from '@/lib/firebase-admin';
import { getUser } from '@/services/user-service';
import axios from 'axios';
import type { WorkoutSession, ProgramType } from '@/models/types';
import { hasRuns } from '@/lib/type-guards';
import { generateStravaDescription } from '@/ai/flows/strava-description';
import { logger } from '@/lib/logger';


// Helper function to safely convert Firestore timestamp to Date.
// Returns null (and logs a warning) for missing or unrecognisable values so
// callers can surface a proper error rather than silently using the wrong date.
function toDate(timestamp: any): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp.toDate === 'function') return timestamp.toDate() as Date;
  if (typeof timestamp === 'string') {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) return d;
    logger.warn('toDate: invalid timestamp string', timestamp);
    return null;
  }
  if (typeof timestamp === 'number') return new Date(timestamp);
  logger.warn('toDate: unrecognised timestamp format', typeof timestamp, timestamp);
  return null;
}

// Map your app's activity types to Strava activity types
function mapActivityTypeToStrava(programType: ProgramType): string {
    if (programType === 'running') {
        return 'Run';
    }
    return 'WeightTraining';
}


export async function POST(req: NextRequest) {
  let userId: string | undefined;

  try {
    const { sessionId } = await req.json();
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Authenticate user
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const decodedToken = await getAuth().verifySessionCookie(sessionCookie, true);
    userId = decodedToken.uid;

    // 5 uploads per minute per user
    const rl = checkRateLimit(`strava-upload:${userId}`, 60_000, 5);
    if (!rl.allowed) {
        return NextResponse.json(
          { error: 'Too many upload requests. Please wait before trying again.', code: 'STRAVA_RATE_LIMITED' },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
        );
    }

    const accessToken = await getValidStravaToken(userId);
    if (isDemoStravaToken(accessToken)) {
      return NextResponse.json({ error: 'Strava upload is not available on the demo account.' }, { status: 400 });
    }

    // Fetch workout session from your database
    const adminDb = getAdminDb();
    const sessionDoc = await adminDb.collection('workoutSessions').doc(sessionId).get();

    if (!sessionDoc.exists || sessionDoc.data()?.userId !== userId) {
      return NextResponse.json({ error: 'Workout session not found or access denied' }, { status: 404 });
    }

    const session = sessionDoc.data() as WorkoutSession;
    
    if (session?.uploadedToStrava) {
      return NextResponse.json({ 
        error: 'Activity already uploaded to Strava',
        stravaId: session.stravaId 
      }, { status: 400 });
    }

    if (!session.finishedAt) {
        return NextResponse.json({ error: 'Cannot upload an incomplete workout' }, { status: 400 });
    }

    // Generate AI Description for Strava
    let aiDescription = `Workout from HYBRIDX.CLUB.\n\nNotes:\n${session.notes || 'No notes.'}`;
    if (session.workoutDetails) {
        try {
            const exercises = hasRuns(session.workoutDetails)
                ? session.workoutDetails!.runs
                : session.workoutDetails!.exercises;
            
            const descriptionResult = await generateStravaDescription({
                workoutTitle: session.workoutTitle,
                workoutType: session.programType === 'running' ? 'running' : 'hyrox',
                exercises: JSON.stringify(exercises),
                userNotes: session.notes,
            });
            aiDescription = descriptionResult.description;
        } catch (aiError) {
            logger.error('Failed to generate AI description, using fallback:', aiError);
            // Fallback to the original description if AI fails
        }
    }


    const startDate = toDate(session.startedAt);
    if (!startDate) {
      logger.error('Invalid or missing startedAt timestamp for session:', sessionId);
      return NextResponse.json({ error: 'Workout session has an invalid start time and cannot be uploaded.' }, { status: 400 });
    }

    // Calculate elapsed time from session timestamps; fall back to 1 hour if unavailable
    const endDate = toDate(session.finishedAt);
    const elapsedTime = startDate && endDate
      ? Math.max(60, Math.round((endDate.getTime() - startDate.getTime()) / 1000))
      : 3600;

    const stravaActivityPayload = {
      name: session.workoutTitle,
      type: mapActivityTypeToStrava(session.programType),
      start_date_local: startDate.toISOString(),
      elapsed_time: elapsedTime,
      description: aiDescription,
      trainer: true,
      commute: false
    };

    logger.log('Uploading activity to Strava:', stravaActivityPayload);
    const stravaResponse = await axios.post(
      'https://www.strava.com/api/v3/activities',
      stravaActivityPayload,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const stravaActivityId = stravaResponse.data.id;
    
    // Update session doc with Strava ID
    await sessionDoc.ref.update({
        stravaId: stravaActivityId.toString(),
        uploadedToStrava: true,
        stravaUploadedAt: new Date()
    });

    return NextResponse.json({ 
      success: true, 
      stravaActivityId,
      stravaUrl: `https://www.strava.com/activities/${stravaActivityId}`
    });

  } catch (error) {
    // Strava answers 403 both for a missing activity-write grant and for an
    // exhausted daily allowance — the stored scope separates the two.
    let scope: string | undefined;
    if (userId) {
      try {
        scope = (await getUser(userId))?.strava?.scope;
      } catch {
        // best-effort only — never let the diagnostic lookup mask the real error
      }
    }

    const mapped = mapStravaError(error, 'Failed to upload to Strava.', scope);
    // console, not logger — logger.error strips the payload to a generic line
    // in production, and this diagnosis is the whole point of the log.
    console.error('[strava-upload] request failed', {
      userId,
      code: mapped.code,
      scope,
      ...describeStravaError(error),
    });

    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}
