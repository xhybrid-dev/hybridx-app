import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_STRAVA_ACCESS_TOKEN, demoStravaActivities, isDemoStravaToken } from '../demo-strava';
import { computeTrainingSummary } from '@/services/training-load-service';

afterEach(() => vi.useRealTimers());

describe('demo Strava history', () => {
  it('recognises only the exact sentinel token', () => {
    expect(isDemoStravaToken(DEMO_STRAVA_ACCESS_TOKEN)).toBe(true);
    expect(isDemoStravaToken('a-real-strava-token')).toBe(false);
    expect(isDemoStravaToken(undefined)).toBe(false);
  });

  it('is newest first, in the past, and stable for a given day', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const activities = demoStravaActivities(60, now);
    const times = activities.map(a => new Date(a.start_date).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(Math.max(...times)).toBeLessThanOrEqual(now.getTime());
    expect(demoStravaActivities(60, now)).toEqual(activities);
    expect(new Set(activities.map(a => a.id)).size).toBe(activities.length);
  });

  // The Training Load card is the screenshot: it must read as a healthy block
  // whatever day the account is shown on.
  it('reports the optimal training zone on every day of ten weeks', () => {
    for (let offset = 0; offset < 70; offset++) {
      const now = new Date(Date.UTC(2026, 10, 2 + offset, 20));
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const summary = computeTrainingSummary(demoStravaActivities(60, now));
      vi.useRealTimers();
      expect(summary.loadMetrics.fatigueLabel, now.toISOString()).toBe('Optimal Training Zone');
    }
  });
});
