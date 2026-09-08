// src/app/api/ai/analyze-week/route.ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { analyzeAndAdjust } from '@/ai/flows/analyze-and-adjust';
import { getUser, updateUserAdmin } from '@/services/user-service';
import { getAdminDb } from '@/lib/firebase-admin';
import { getProgram } from '@/services/program-service';
import { getWorkoutForDay } from '@/lib/workout-utils';
import { toCalendarDay } from '@/lib/program-day';
import { Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';
import type { StravaTokens } from '@/models/types';
import { computeTrainingSummary, formatTrainingSummaryForAI } from '@/services/training-load-service';

export async function POST(request: Request) {
    try {
        // AI generation is expensive — require a valid Firebase ID token and
        // rate-limit per user. userId is derived from the verified token, never
        // trusted from the body (prevents acting on another user's data).
        const auth = await requireUser(request, { bucket: 'ai:analyze-week', windowMs: 60_000, max: 5 });
        if ('response' in auth) return auth.response;
        const userId = auth.uid;

        console.log('[Analyze Week] Starting analysis...');
        const body = await request.json();
        const { customRequest } = body;
        console.log('[Analyze Week] Custom Request:', customRequest || 'None');

        // 1. Fetch User Profile
        console.log('[Analyze Week] Fetching user profile...');
        const user = await getUser(userId);
        console.log('[Analyze Week] User found:', !!user, 'Has program:', !!user?.programId, 'Has startDate:', !!user?.startDate);

        if (!user || !user.programId || !user.startDate) {
            return NextResponse.json({ error: 'User or program data missing' }, { status: 404 });
        }

        // 2. Fetch Recent History (last 5 sessions)
        console.log('[Analyze Week] Fetching recent workout history...');
        const adminDb = getAdminDb();
        const sessionsRef = adminDb.collection('workoutSessions');
        const sessionsSnapshot = await sessionsRef
            .where('userId', '==', userId)
            .orderBy('workoutDate', 'desc')
            .limit(5)
            .get();

        const recentHistory = sessionsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                date: data.workoutDate.toDate().toISOString().split('T')[0],
                workoutTitle: data.workoutTitle,
                notes: data.notes || '',
                skipped: data.skipped || false
            };
        });
        console.log('[Analyze Week] Found', recentHistory.length, 'recent sessions');

        // 3. Fetch Upcoming Workouts (next 7 days)
        console.log('[Analyze Week] Fetching program:', user.programId);
        const program = await getProgram(user.programId);
        if (!program) {
             return NextResponse.json({ error: 'Program not found' }, { status: 404 });
        }
        console.log('[Analyze Week] Program found:', program.name);

        // If user has a custom program override, we should respect that, but for now let's analyze the base vs custom
        const sourceProgram = user.customProgram ? { ...program, workouts: user.customProgram } : program;

        // The athlete's zone, so "the next 7 days" are their days. Without it
        // this resolved a day ahead on the server and adjusted the wrong
        // sessions.
        const timeZone = auth.timeZone ?? user.timeZone;
        // Resolved to the athlete's calendar day before any day arithmetic —
        // getWorkoutForDay reads the target in runtime-local terms.
        const today = timeZone ? toCalendarDay(new Date(), timeZone) : new Date();
        const upcomingWorkouts: any[] = [];
        for (let i = 1; i <= 7; i++) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + i);
            const w = getWorkoutForDay(sourceProgram, user.startDate, targetDate, timeZone);
            if (w.workout) {
                const workout = w.workout;

                // WorkoutDay always has both exercises and runs arrays; push directly
                upcomingWorkouts.push(workout);
            }
        }

        console.log('[Analyze Week] Found', upcomingWorkouts.length, 'upcoming workouts');

        if (upcomingWorkouts.length === 0) {
             return NextResponse.json({ analysis: "No upcoming workouts found to adjust.", needsAdjustment: false });
        }

        // 4a. Optionally fetch Strava training context if user is connected
        let stravaTrainingContext: string | undefined;
        if (user.strava?.accessToken) {
            try {
                let accessToken = user.strava.accessToken;
                const now = new Date();
                const stravaTokens = user.strava as StravaTokens;

                if (
                    stravaTokens.expiresAt instanceof Date &&
                    stravaTokens.expiresAt.getTime() < now.getTime() + 300000
                ) {
                    const refreshResponse = await axios.post('https://www.strava.com/oauth/token', {
                        client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
                        client_secret: process.env.STRAVA_CLIENT_SECRET,
                        grant_type: 'refresh_token',
                        refresh_token: stravaTokens.refreshToken,
                    });
                    const newTokens: StravaTokens = {
                        ...stravaTokens,
                        accessToken: refreshResponse.data.access_token,
                        refreshToken: refreshResponse.data.refresh_token,
                        expiresAt: new Date(refreshResponse.data.expires_at * 1000),
                    };
                    await updateUserAdmin(userId, { strava: newTokens });
                    accessToken = newTokens.accessToken;
                }

                const [p1, p2] = await Promise.all([
                    axios.get('https://www.strava.com/api/v3/athlete/activities', {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        params: { per_page: 50, page: 1 },
                    }),
                    axios.get('https://www.strava.com/api/v3/athlete/activities', {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        params: { per_page: 50, page: 2 },
                    }),
                ]);
                const stravaActivities = [...p1.data, ...p2.data];
                const trainingSummary = computeTrainingSummary(stravaActivities);
                stravaTrainingContext = formatTrainingSummaryForAI(trainingSummary);
                console.log('[Analyze Week] Strava training context fetched successfully');
            } catch (stravaErr: any) {
                // Non-fatal — proceed without Strava context
                console.warn('[Analyze Week] Could not fetch Strava training context:', stravaErr.message);
            }
        }

        // 4b. Run AI Analysis
        console.log('[Analyze Week] Running AI analysis...');
        if (!user.firstName || !user.goal) {
            console.warn("Missing user details for AI prompt, using defaults");
        }

        const aiResult = await analyzeAndAdjust({
            userName: user.firstName || "Athlete",
            userGoal: user.goal || "Improve Fitness",
            recentHistory,
            upcomingWorkouts: upcomingWorkouts as any, // Cast due to complex union types in workout
            customRequest: customRequest || undefined, // Include custom request if provided
            stravaTrainingContext,
        });

        console.log('[Analyze Week] AI analysis complete, needsAdjustment:', aiResult.needsAdjustment);
        return NextResponse.json(aiResult);

    } catch (error) {
        console.error("Analysis error:", error);
        console.error("Error stack:", error instanceof Error ? error.stack : undefined);
        console.error("Error details:", JSON.stringify(error, null, 2));
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            details: String(error)
        }, { status: 500 });
    }
}
