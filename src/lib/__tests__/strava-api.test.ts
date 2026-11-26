import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchRecentActivities, mapStravaError } from '../strava-api';
import { DEMO_STRAVA_ACCESS_TOKEN } from '../demo-strava';

vi.mock('axios');

const mockedGet = vi.mocked(axios.get);

/** Build an axios-shaped error the way `axios.isAxiosError` recognises it. */
function axiosError(status: number, data: any = {}, headers: Record<string, string> = {}) {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.isAxiosError = true;
  err.response = { status, data, headers };
  err.config = { url: 'https://www.strava.com/api/v3/athlete/activities', params: { page: 1 } };
  return err;
}

function page(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({ id: i, moving_time: 1800, type: 'Run', start_date: '2026-08-01T06:00:00Z' })),
    headers: { 'x-ratelimit-usage': '12,300', 'x-ratelimit-limit': '200,2000' },
  };
}

beforeEach(() => {
  vi.mocked(axios.isAxiosError).mockImplementation((e: any) => !!e?.isAxiosError);
  mockedGet.mockReset();
});

describe('fetchRecentActivities', () => {
  it('serves built-in history for the demo token and never calls Strava', async () => {
    const result = await fetchRecentActivities(DEMO_STRAVA_ACCESS_TOKEN, { days: 60 });
    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.activities.length).toBeGreaterThan(40);
    expect(result.partial).toBe(false);
  });

  it('stops after one request when the first page comes back short', async () => {
    mockedGet.mockResolvedValueOnce(page(40) as any);

    const result = await fetchRecentActivities('token', { perPage: 100, maxPages: 3 });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(result.activities).toHaveLength(40);
    expect(result.pagesFetched).toBe(1);
    expect(result.partial).toBe(false);
    expect(result.rateLimit.usage).toBe('12,300');
  });

  it('keeps paging while pages come back full, up to maxPages', async () => {
    mockedGet.mockResolvedValueOnce(page(100) as any).mockResolvedValueOnce(page(100) as any);

    const result = await fetchRecentActivities('token', { perPage: 100, maxPages: 2 });

    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(result.activities).toHaveLength(200);
  });

  it('passes an `after` cutoff derived from the requested window', async () => {
    mockedGet.mockResolvedValueOnce(page(1) as any);

    await fetchRecentActivities('token', { days: 120 });

    const { params } = mockedGet.mock.calls[0][1] as any;
    const expected = Math.floor((Date.now() - 120 * 86_400_000) / 1000);
    expect(Math.abs(params.after - expected)).toBeLessThan(5);
  });

  it('returns partial data when a later page fails', async () => {
    mockedGet.mockResolvedValueOnce(page(100) as any).mockRejectedValueOnce(axiosError(403, { message: 'Forbidden' }));

    const result = await fetchRecentActivities('token', { perPage: 100, maxPages: 3 });

    expect(result.activities).toHaveLength(100);
    expect(result.partial).toBe(true);
  });

  it('propagates a first-page failure', async () => {
    mockedGet.mockRejectedValueOnce(axiosError(403, { message: 'Forbidden' }));

    await expect(fetchRecentActivities('token')).rejects.toThrow(/403/);
  });
});

describe('mapStravaError', () => {
  it('treats 401 as a reconnect prompt', () => {
    const mapped = mapStravaError(axiosError(401, { message: 'Authorization Error' }), 'fallback');
    expect(mapped.code).toBe('STRAVA_REAUTH');
    expect(mapped.status).toBe(401);
  });

  it('reads a 403 as a missing grant when the stored scope lacks activity read', () => {
    const mapped = mapStravaError(axiosError(403, { message: 'Forbidden' }), 'fallback', 'read');
    expect(mapped.code).toBe('STRAVA_SCOPE_MISSING');
  });

  it('reads a 403 as a rate limit when the scope is fine', () => {
    const mapped = mapStravaError(axiosError(403, { message: 'Forbidden' }), 'fallback', 'read,activity:read_all,activity:write');
    expect(mapped.code).toBe('STRAVA_RATE_LIMITED');
  });

  it('never leaks Strava\'s own wording to the user', () => {
    const mapped = mapStravaError(axiosError(403, { message: 'Forbidden' }), 'fallback', 'read,activity:read_all');
    expect(mapped.message).not.toBe('Forbidden');
    expect(mapped.message.length).toBeGreaterThan(20);
  });

  it('maps 429 to a rate limit', () => {
    expect(mapStravaError(axiosError(429, { message: 'Rate Limit Exceeded' }), 'fallback').code).toBe('STRAVA_RATE_LIMITED');
  });

  it('maps Strava 5xx to unavailable', () => {
    expect(mapStravaError(axiosError(502), 'fallback').code).toBe('STRAVA_UNAVAILABLE');
  });

  it('maps token-helper failures', () => {
    expect(mapStravaError(Object.assign(new Error('x'), { code: 'STRAVA_NOT_CONNECTED' }), 'fallback').code).toBe('STRAVA_REAUTH');
    expect(mapStravaError(Object.assign(new Error('x'), { code: 'STRAVA_REFRESH_FAILED' }), 'fallback').code).toBe('STRAVA_REAUTH');
  });

  it('maps an expired session cookie', () => {
    const mapped = mapStravaError(Object.assign(new Error('x'), { code: 'auth/session-cookie-expired' }), 'fallback');
    expect(mapped).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
  });

  it('falls back for anything unrecognised', () => {
    const mapped = mapStravaError(new Error('boom'), 'fallback message');
    expect(mapped).toMatchObject({ status: 500, code: 'UNKNOWN', message: 'fallback message' });
  });
});
