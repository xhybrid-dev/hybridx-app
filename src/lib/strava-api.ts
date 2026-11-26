// src/lib/strava-api.ts
// Shared helpers for talking to the Strava activities API:
//  • fetchRecentActivities — date-windowed, sequential paging that stops as soon
//    as Strava runs out of activities (most athletes need a single request).
//  • mapStravaError / describeStravaError — turn an upstream failure into an
//    actionable message + machine-readable code instead of leaking Strava's own
//    wording ("Forbidden") straight through to the user.

import axios from 'axios';
import type { StravaActivity } from '@/services/strava-service';
import { demoStravaActivities, isDemoStravaToken } from '@/lib/demo-strava';

const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';

/** Strava's rate-limit counters, echoed on every response. Useful in logs when
 *  a request starts failing with 403/429. */
export interface StravaRateLimit {
  /** Overall usage this 15-min window / today, e.g. "312,4521" */
  usage?: string;
  /** Overall limit, e.g. "200,2000" */
  limit?: string;
  /** Read-only usage this 15-min window / today */
  readUsage?: string;
  /** Read-only limit */
  readLimit?: string;
}

export interface FetchActivitiesResult {
  activities: StravaActivity[];
  pagesFetched: number;
  /** True when a later page failed but earlier pages succeeded — the caller
   *  still has usable (if slightly truncated) data. */
  partial: boolean;
  rateLimit: StravaRateLimit;
}

function readRateLimit(headers: any): StravaRateLimit {
  return {
    usage: headers?.['x-ratelimit-usage'],
    limit: headers?.['x-ratelimit-limit'],
    readUsage: headers?.['x-readratelimit-usage'],
    readLimit: headers?.['x-readratelimit-limit'],
  };
}

/**
 * Fetch the athlete's activities for the last `days` days.
 *
 * Uses Strava's `after` filter so we ask only for the window we actually chart,
 * and pages sequentially, stopping as soon as a page comes back short. With
 * `perPage: 100` a typical athlete's 120-day history is one request rather than
 * the three unconditional requests this used to cost — which matters because
 * Strava answers 403 once an app burns through its daily request allowance.
 *
 * If page 1 fails the error propagates. If a *later* page fails we keep what we
 * have and flag the result as partial — a truncated chart beats an error page.
 */
export async function fetchRecentActivities(
  accessToken: string,
  { days = 120, perPage = 100, maxPages = 3 }: { days?: number; perPage?: number; maxPages?: number } = {},
): Promise<FetchActivitiesResult> {
  // Demo accounts carry a sentinel token and get built-in history instead.
  if (isDemoStravaToken(accessToken)) {
    return { activities: demoStravaActivities(days), pagesFetched: 1, partial: false, rateLimit: {} };
  }

  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  const activities: StravaActivity[] = [];
  let pagesFetched = 0;
  let partial = false;
  let rateLimit: StravaRateLimit = {};

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(ACTIVITIES_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { per_page: perPage, page, after },
      });

      rateLimit = readRateLimit(res.headers);
      const batch: StravaActivity[] = Array.isArray(res.data) ? res.data : [];
      activities.push(...batch);
      pagesFetched++;

      if (batch.length < perPage) break; // no more activities in the window
    } catch (err) {
      if (page === 1) throw err;
      // Later page failed — keep the earlier pages rather than failing outright.
      console.warn(
        `[strava] page ${page} failed, continuing with ${activities.length} activities:`,
        describeStravaError(err),
      );
      partial = true;
      break;
    }
  }

  return { activities, pagesFetched, partial, rateLimit };
}

export type StravaErrorCode =
  | 'STRAVA_REAUTH'        // token invalid/revoked — user must reconnect
  | 'STRAVA_SCOPE_MISSING' // token lacks activity read permission
  | 'STRAVA_RATE_LIMITED'  // 15-minute or daily allowance exhausted
  | 'STRAVA_FORBIDDEN'     // 403 we could not attribute more precisely
  | 'STRAVA_UNAVAILABLE'   // Strava 5xx / network
  | 'SESSION_EXPIRED'
  | 'UNKNOWN';

export interface MappedStravaError {
  status: number;
  code: StravaErrorCode;
  message: string;
}

/**
 * Map an upstream failure onto a user-facing message and a code the UI can act
 * on (e.g. render a "Reconnect Strava" button).
 *
 * `scope` is the scope string stored at connect time — Strava answers 403 both
 * for a missing `activity:read` grant and for an exhausted daily allowance, and
 * the stored scope is what tells the two apart.
 */
export function mapStravaError(
  error: unknown,
  fallbackMessage: string,
  scope?: string,
): MappedStravaError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;

    if (status === 401) {
      return {
        status: 401,
        code: 'STRAVA_REAUTH',
        message: 'Your Strava connection has expired. Please reconnect Strava from your profile.',
      };
    }

    if (status === 403) {
      const hasActivityRead = !scope || scope.includes('activity:read');
      if (!hasActivityRead) {
        return {
          status: 403,
          code: 'STRAVA_SCOPE_MISSING',
          message:
            'Strava has not granted this app permission to read your activities. Reconnect Strava and tick "View data about your activities".',
        };
      }
      return {
        status: 403,
        code: 'STRAVA_RATE_LIMITED',
        message:
          'Strava is temporarily refusing requests — this usually means the daily API limit has been reached. Please try again later.',
      };
    }

    if (status === 429) {
      return {
        status: 429,
        code: 'STRAVA_RATE_LIMITED',
        message: 'Too many Strava requests right now. Please try again in about 15 minutes.',
      };
    }

    if (status >= 500 || status === 0) {
      return {
        status: 503,
        code: 'STRAVA_UNAVAILABLE',
        message: 'Strava is not responding right now. Please try again shortly.',
      };
    }

    return { status, code: 'UNKNOWN', message: fallbackMessage };
  }

  const code = (error as any)?.code;
  if (code === 'auth/session-cookie-expired' || code === 'auth/session-cookie-revoked' || code === 'auth/argument-error') {
    return { status: 401, code: 'SESSION_EXPIRED', message: 'Session expired. Please log in again.' };
  }
  if (code === 'STRAVA_NOT_CONNECTED') {
    return { status: 400, code: 'STRAVA_REAUTH', message: 'Strava account not connected. Connect it from your profile to see your training load.' };
  }
  if (code === 'STRAVA_REFRESH_FAILED') {
    return { status: 401, code: 'STRAVA_REAUTH', message: 'Your Strava connection has expired. Please reconnect Strava from your profile.' };
  }

  return { status: 500, code: 'UNKNOWN', message: fallbackMessage };
}

/** Full detail for server logs — status, Strava's own error body and the
 *  rate-limit counters. The old routes logged only "Request failed with status
 *  code 403", which said nothing about why. */
export function describeStravaError(error: unknown): Record<string, unknown> {
  if (axios.isAxiosError(error)) {
    return {
      status: error.response?.status,
      stravaBody: error.response?.data,
      rateLimit: readRateLimit(error.response?.headers),
      url: error.config?.url,
      params: error.config?.params,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: (error as any)?.code,
  };
}
