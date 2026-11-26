// src/lib/demo-strava.ts
//
// Built-in "Strava" history for demo accounts (scripts/seed-demo-athlete.ts),
// so the store screenshots and the App Review account show a believable
// Training Load card and Training Form chart without a real Strava login.
//
// A demo account stores DEMO_STRAVA_ACCESS_TOKEN as its Strava access token.
// Every server path that would call Strava with that token gets these
// generated activities instead (fetchRecentActivities, /api/strava/activities,
// the analyze-week route), so the sentinel never reaches Strava. Real tokens
// are untouched: the check is an exact string match on a value Strava never
// issues.
//
// The history is deterministic per calendar day, so the chart doesn't jump
// between refreshes, and shaped as a steady, slightly progressive training
// block: the 7-day load sits a little above the 6-week average, which the
// load model reports as "Optimal Training Zone".

import type { StravaActivity } from '@/services/strava-service';

/** Stored as `strava.accessToken` (and refreshToken) on demo accounts only. */
export const DEMO_STRAVA_ACCESS_TOKEN = 'hybridx-demo-account-no-strava';

export function isDemoStravaToken(token: string | null | undefined): boolean {
  return token === DEMO_STRAVA_ACCESS_TOKEN;
}

const DAY_MS = 86_400_000;

interface Template {
  name: string;
  sportType: 'Run' | 'WeightTraining' | 'Workout' | 'Ride' | 'Walk';
  minutes: number;
  /** Metres; 0 for gym sessions. */
  distance: number;
  heartRate: number;
  hour: number;
}

/** Monday-first week. Two templates on a day means a double session. */
const WEEK: Template[][] = [
  [{ name: 'Lower body strength + sled', sportType: 'WeightTraining', minutes: 60, distance: 0, heartRate: 126, hour: 7 }],
  [{ name: 'Track intervals: 6 x 800 m', sportType: 'Run', minutes: 52, distance: 9_600, heartRate: 157, hour: 6 }],
  [{ name: 'Run + stations', sportType: 'Workout', minutes: 62, distance: 0, heartRate: 148, hour: 18 }],
  [
    { name: 'Easy shake-out run', sportType: 'Run', minutes: 32, distance: 6_000, heartRate: 134, hour: 7 },
    { name: 'EMOM: wall balls + burpees', sportType: 'Workout', minutes: 40, distance: 0, heartRate: 152, hour: 18 },
  ],
  [{ name: 'Upper body + core', sportType: 'WeightTraining', minutes: 50, distance: 0, heartRate: 118, hour: 7 }],
  [{ name: 'Long run', sportType: 'Run', minutes: 88, distance: 16_500, heartRate: 143, hour: 8 }],
  [{ name: 'Recovery walk', sportType: 'Walk', minutes: 45, distance: 4_200, heartRate: 98, hour: 10 }],
];

/** Small deterministic jitter in [-1, 1] from an integer seed. */
function jitter(seed: number): number {
  let t = (seed * 2654435761) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 2246822519) >>> 0;
  t ^= t >>> 13;
  return ((t >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * The demo athlete's activities over the last `days` days, newest first, the
 * order Strava returns them in.
 */
export function demoStravaActivities(days = 120, now: Date = new Date()): StravaActivity[] {
  const todayIndex = Math.floor(now.getTime() / DAY_MS);
  const activities: StravaActivity[] = [];

  for (let offset = days; offset >= 0; offset--) {
    const dayIndex = todayIndex - offset;
    const date = new Date(dayIndex * DAY_MS);
    const weekday = (date.getUTCDay() + 6) % 7; // 0 = Monday

    // About 0.5% more load each week over the window: a progressive block.
    const progression = 1 - (offset / 7) * 0.005;

    // Every week has the same shape. The load model's "optimal" band is only a
    // few percent wide, so week-to-week variety (a missed session, a swapped
    // ride) would tip some days into "fresh" or "fatigued". Only start times
    // vary, which doesn't change the load.
    WEEK[weekday].forEach((template, n) => {
      const seed = dayIndex * 7 + n;
      const scale = progression;
      const movingTime = Math.round(template.minutes * 60 * scale);
      const distance = Math.round(template.distance * scale);
      const start = new Date(dayIndex * DAY_MS + template.hour * 3_600_000 + Math.round(jitter(seed + 1) * 20) * 60_000);
      if (start.getTime() > now.getTime()) return;

      const iso = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
      activities.push({
        id: 9_000_000_000 + dayIndex * 10 + n,
        name: template.name,
        distance,
        moving_time: movingTime,
        elapsed_time: movingTime + 120,
        total_elevation_gain: template.distance ? Math.round(distance / 180) : 0,
        type: template.sportType,
        sport_type: template.sportType,
        start_date: iso,
        start_date_local: iso,
        timezone: '(GMT+00:00) Europe/London',
        utc_offset: 0,
        location_city: null,
        location_state: null,
        location_country: 'United Kingdom',
        start_latlng: [0, 0] as [number, number],
        end_latlng: [0, 0] as [number, number],
        map: { id: `demo-${dayIndex}-${n}`, summary_polyline: null, resource_state: 2 },
        average_speed: distance > 0 ? Math.round((distance / movingTime) * 1000) / 1000 : 0,
        max_speed: distance > 0 ? Math.round((distance / movingTime) * 1250) / 1000 : 0,
        average_heartrate: template.heartRate,
        max_heartrate: Math.round(template.heartRate + 22 + jitter(seed + 3) * 5),
      });
    });
  }

  return activities.reverse();
}
