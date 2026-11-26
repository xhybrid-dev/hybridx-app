// src/app/api/strava/activities/[activityId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUser, updateUserAdmin } from '@/services/user-service';
import axios from 'axios';
import type { StravaTokens } from '@/models/types';
import { getAdminAuth } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { demoStravaActivities, isDemoStravaToken } from '@/lib/demo-strava';

async function getValidAccessToken(userId: string): Promise<string> {
    const user = await getUser(userId);
    const stravaTokens = user?.strava;

    if (!stravaTokens?.accessToken) {
        throw new Error('Strava not connected');
    }

    const now = new Date();
    const expiresAt = stravaTokens.expiresAt;
    
    if (expiresAt.getTime() - now.getTime() < 300000) { // 5 min buffer
        console.log(`[Strava Details API] Token for user ${userId} expiring, refreshing...`);
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
        return newTokens.accessToken;
    }
    return stravaTokens.accessToken;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ activityId: string }> }
) {
  console.log('=== DETAILED STRAVA ACTIVITY API START ===');
  const { activityId } = await params;

  if (!activityId) {
    return NextResponse.json({ error: 'Activity ID is required' }, { status: 400 });
  }

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Authentication required: No session cookie.' }, { status: 401 });
    }

    const decodedToken = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    const userId = decodedToken.uid;
    console.log(`🔐 Authenticated user: ${userId} for activity ${activityId}`);

    const accessToken = await getValidAccessToken(userId);

    if (isDemoStravaToken(accessToken)) {
      const demo = demoStravaActivities(120).find(activity => String(activity.id) === String(activityId));
      return demo
        ? NextResponse.json(demo)
        : NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    console.log(`🚀 Fetching detailed activity ${activityId} from Strava...`);
    const activityResponse = await axios.get(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { include_all_efforts: false },
    });

    const activityDetails = activityResponse.data;
    console.log(`✅ Successfully fetched details for activity ${activityId}`);

    return NextResponse.json(activityDetails);

  } catch (error) {
    console.error(`❌ Error fetching Strava activity ${activityId}:`, {
      message: error instanceof Error ? error.message : String(error),
      status: (error as any).response?.status,
      data: (error as any).response?.data,
    });

    const status = (error as any).response?.status || 500;
    const message = (error as any).response?.data?.message || 'Failed to fetch activity details from Strava.';
    
    return NextResponse.json({ error: message }, { status });
  }
}
