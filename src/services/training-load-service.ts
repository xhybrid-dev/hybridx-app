// src/services/training-load-service.ts
// Utility functions to compute training load metrics from Strava activities.
// Uses ATL (Acute Training Load), CTL (Chronic Training Load), and TSB (Training Stress Balance)
// — the standard Performance Management Chart (PMC) metrics used in endurance coaching.

import type { StravaActivity } from './strava-service';

// ─── Activity Type Grouping ───────────────────────────────────────────────────

export type ActivityCategory = 'run' | 'ride' | 'swim' | 'strength' | 'walk' | 'rowing' | 'other';

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  run: 'Running',
  ride: 'Cycling',
  swim: 'Swimming',
  // No event brand here: it shows in store screenshots and on the Training Load card.
  strength: 'Strength & stations',
  walk: 'Walking / Hiking',
  rowing: 'Rowing',
  other: 'Other',
};

// Multiplier used to estimate relative intensity when suffer_score is missing.
// Running = highest cardio impact, cycling slightly lower, etc.
const CATEGORY_LOAD_MULTIPLIER: Record<ActivityCategory, number> = {
  run: 1.0,
  ride: 0.75,
  swim: 1.1,
  strength: 0.85,
  walk: 0.55,
  rowing: 0.9,
  other: 0.7,
};

export function categoriseActivity(activity: StravaActivity): ActivityCategory {
  const t = (activity.sport_type || activity.type || '').toLowerCase();

  if (['run', 'trailrun', 'virtualrun', 'treadmill'].includes(t)) return 'run';
  if (['walk', 'hike'].includes(t)) return 'walk';
  if (['ride', 'mountainbikeride', 'gravelride', 'ebikeride', 'virtualride', 'handcycle'].includes(t)) return 'ride';
  if (['swim'].includes(t)) return 'swim';
  if (['weighttraining', 'crossfit', 'workout', 'elliptical', 'stairstepper'].includes(t)) return 'strength';
  if (['rowing', 'kayaking', 'canoeing', 'standuppaddling'].includes(t)) return 'rowing';
  return 'other';
}

// ─── Load Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate a training stress score for a single activity.
 * Uses Strava's suffer_score when available (their own HR-based model).
 * Falls back to duration × category multiplier × a mild HR factor.
 */
export function estimateActivityLoad(activity: StravaActivity): number {
  if (activity.suffer_score && activity.suffer_score > 0) {
    return activity.suffer_score;
  }

  const minutes = (activity.moving_time || 0) / 60;
  const category = categoriseActivity(activity);
  const multiplier = CATEGORY_LOAD_MULTIPLIER[category];

  // If heart rate is available, adjust slightly (higher HR = higher load)
  const hrFactor = activity.average_heartrate
    ? 0.8 + (activity.average_heartrate / 200) * 0.4
    : 1.0;

  return Math.round(minutes * multiplier * hrFactor);
}

// ─── Weekly Breakdown ─────────────────────────────────────────────────────────

export interface WeeklyActivityBreakdown {
  weekLabel: string;       // e.g. "W1", "W2" … "W4"
  weekStart: Date;
  totalMinutes: number;
  byCategory: Partial<Record<ActivityCategory, number>>; // minutes per category
}

/**
 * Returns weekly training time breakdowns for the last `numWeeks` weeks.
 * Week 1 = oldest, Week N = current partial week.
 */
export function computeWeeklyBreakdown(
  activities: StravaActivity[],
  numWeeks = 4,
): WeeklyActivityBreakdown[] {
  const now = new Date();
  // Find the start of the current week (Monday)
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - dayOfWeek);
  thisMonday.setHours(0, 0, 0, 0);

  const weeks: WeeklyActivityBreakdown[] = [];

  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekStart = new Date(thisMonday);
    weekStart.setDate(thisMonday.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const inWeek = activities.filter(a => {
      const d = new Date(a.start_date);
      return d >= weekStart && d < weekEnd;
    });

    const byCategory: Partial<Record<ActivityCategory, number>> = {};
    let totalMinutes = 0;

    for (const act of inWeek) {
      const cat = categoriseActivity(act);
      const mins = Math.round((act.moving_time || 0) / 60);
      byCategory[cat] = (byCategory[cat] || 0) + mins;
      totalMinutes += mins;
    }

    weeks.push({
      weekLabel: `W${numWeeks - i}`,
      weekStart,
      totalMinutes,
      byCategory,
    });
  }

  return weeks;
}

// ─── ATL / CTL / TSB ─────────────────────────────────────────────────────────

export interface TrainingLoadMetrics {
  /** Acute Training Load — 7-day rolling average daily load (×7 to give weekly scale) */
  atl: number;
  /** Chronic Training Load — 42-day rolling average daily load (×7 to give weekly scale) */
  ctl: number;
  /** Training Stress Balance = CTL − ATL. Positive = fresh, Negative = fatigued */
  tsb: number;
  /** Human-readable fatigue status */
  fatigueStatus: 'very_fresh' | 'fresh' | 'optimal' | 'building' | 'fatigued' | 'overreaching';
  fatigueLabel: string;
  /** Total load units in each rolling window */
  atl7dayLoad: number;
  ctl42dayLoad: number;
  /** Average load per week over the CTL window — useful for context */
  avgWeeklyLoad: number;
}

/**
 * Compute ATL, CTL and TSB from a list of activities (should cover at least 42 days).
 * We use simple rolling window averages and scale to weekly units for readability.
 */
export function computeTrainingLoad(activities: StravaActivity[]): TrainingLoadMetrics {
  const now = new Date();

  const cutoff7 = new Date(now);
  cutoff7.setDate(now.getDate() - 7);

  const cutoff42 = new Date(now);
  cutoff42.setDate(now.getDate() - 42);

  const load7: number[] = [];
  const load42: number[] = [];

  for (const act of activities) {
    const actDate = new Date(act.start_date);
    const load = estimateActivityLoad(act);

    if (actDate >= cutoff7) load7.push(load);
    if (actDate >= cutoff42) load42.push(load);
  }

  const atl7dayLoad = load7.reduce((s, v) => s + v, 0);
  const ctl42dayLoad = load42.reduce((s, v) => s + v, 0);

  // Normalise to weekly scale: ATL = total in 7 days, CTL = (total in 42 days / 6 weeks)
  const atl = atl7dayLoad;
  const ctl = Math.round(ctl42dayLoad / 6);
  const tsb = ctl - atl;

  const avgWeeklyLoad = ctl;

  let fatigueStatus: TrainingLoadMetrics['fatigueStatus'];
  let fatigueLabel: string;

  if (tsb > 25) {
    fatigueStatus = 'very_fresh';
    fatigueLabel = 'Very Fresh';
  } else if (tsb > 5) {
    fatigueStatus = 'fresh';
    fatigueLabel = 'Fresh';
  } else if (tsb >= -10) {
    fatigueStatus = 'optimal';
    fatigueLabel = 'Optimal Training Zone';
  } else if (tsb >= -25) {
    fatigueStatus = 'building';
    fatigueLabel = 'Building — Watch Recovery';
  } else if (tsb >= -40) {
    fatigueStatus = 'fatigued';
    fatigueLabel = 'Fatigued';
  } else {
    fatigueStatus = 'overreaching';
    fatigueLabel = 'Overreaching — Rest Needed';
  }

  return { atl, ctl, tsb, fatigueStatus, fatigueLabel, atl7dayLoad, ctl42dayLoad, avgWeeklyLoad };
}

// ─── Activity Type Summary (for AI context) ───────────────────────────────────

export interface ActivityTypeSummary {
  category: ActivityCategory;
  label: string;
  last7daysMinutes: number;
  last28daysMinutes: number;
  activityCount28: number;
}

export function computeActivityTypeSummary(activities: StravaActivity[]): ActivityTypeSummary[] {
  const now = new Date();
  const cutoff7 = new Date(now); cutoff7.setDate(now.getDate() - 7);
  const cutoff28 = new Date(now); cutoff28.setDate(now.getDate() - 28);

  const map = new Map<ActivityCategory, ActivityTypeSummary>();

  const allCategories: ActivityCategory[] = ['run', 'ride', 'swim', 'strength', 'walk', 'rowing', 'other'];
  for (const cat of allCategories) {
    map.set(cat, { category: cat, label: CATEGORY_LABELS[cat], last7daysMinutes: 0, last28daysMinutes: 0, activityCount28: 0 });
  }

  for (const act of activities) {
    const actDate = new Date(act.start_date);
    if (actDate < cutoff28) continue;

    const cat = categoriseActivity(act);
    const entry = map.get(cat)!;
    const mins = Math.round((act.moving_time || 0) / 60);

    entry.last28daysMinutes += mins;
    entry.activityCount28 += 1;
    if (actDate >= cutoff7) entry.last7daysMinutes += mins;
  }

  // Return only categories that have at least some activity in 28 days
  return Array.from(map.values()).filter(s => s.last28daysMinutes > 0);
}

// ─── Full Training Summary (used by API and AI) ───────────────────────────────

export interface TrainingSummary {
  loadMetrics: TrainingLoadMetrics;
  weeklyBreakdown: WeeklyActivityBreakdown[];
  activityTypeSummary: ActivityTypeSummary[];
  /** Total number of activities analysed */
  activitiesAnalysed: number;
  /** Date range covered */
  oldestActivityDate: string | null;
}

export function computeTrainingSummary(activities: StravaActivity[]): TrainingSummary {
  const sorted = [...activities].sort(
    (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  );

  return {
    loadMetrics: computeTrainingLoad(sorted),
    weeklyBreakdown: computeWeeklyBreakdown(sorted, 4),
    activityTypeSummary: computeActivityTypeSummary(sorted),
    activitiesAnalysed: sorted.length,
    oldestActivityDate: sorted.length > 0 ? sorted[sorted.length - 1].start_date : null,
  };
}

// ─── Daily PMC Time Series (EWMA) ────────────────────────────────────────────

export interface PMCDataPoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Daily training load (sum of all activities that day) */
  load: number;
  /** Acute Training Load — 7-day EWMA (fatigue) */
  atl: number;
  /** Chronic Training Load — 42-day EWMA (fitness) */
  ctl: number;
  /** Training Stress Balance = CTL − ATL (form) */
  tsb: number;
}

/**
 * Compute a daily PMC time series using exponentially weighted moving averages.
 * This is the standard approach used by TrainingPeaks, Golden Cheetah, etc.
 *
 * EWMA formula: new_value = old_value + (daily_load − old_value) × (1 / time_constant)
 * - ATL time constant = 7 days
 * - CTL time constant = 42 days
 * - TSB = yesterday's CTL − yesterday's ATL
 *
 * Returns one data point per day, covering the full date range of activities
 * (minimum 60 days to allow CTL to stabilise).
 */
export function computeDailyPMC(activities: StravaActivity[], numDays = 90): PMCDataPoint[] {
  const ATL_TC = 7;
  const CTL_TC = 42;

  // Build a map of date → total daily load
  const dailyLoad = new Map<string, number>();
  for (const act of activities) {
    const dateKey = new Date(act.start_date).toISOString().slice(0, 10);
    const load = estimateActivityLoad(act);
    dailyLoad.set(dateKey, (dailyLoad.get(dateKey) || 0) + load);
  }

  // Generate a continuous date range for the last N days
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - numDays);

  const points: PMCDataPoint[] = [];
  let atl = 0;
  let ctl = 0;

  for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
    const dateKey = d.toISOString().slice(0, 10);
    const load = dailyLoad.get(dateKey) || 0;

    // EWMA update
    atl = atl + (load - atl) * (1 / ATL_TC);
    ctl = ctl + (load - ctl) * (1 / CTL_TC);
    const tsb = ctl - atl;

    points.push({
      date: dateKey,
      load: Math.round(load),
      atl: Math.round(atl * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
    });
  }

  return points;
}

/** Extended training summary that includes the daily PMC time series */
export interface TrainingFormSummary extends TrainingSummary {
  dailyPMC: PMCDataPoint[];
}

export function computeTrainingFormSummary(activities: StravaActivity[]): TrainingFormSummary {
  const sorted = [...activities].sort(
    (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  );

  return {
    ...computeTrainingSummary(sorted),
    dailyPMC: computeDailyPMC(sorted, 90),
  };
}

// ─── AI-friendly text summary ─────────────────────────────────────────────────

/** Renders training summary as a readable string for injection into AI prompts. */
export function formatTrainingSummaryForAI(summary: TrainingSummary): string {
  const { loadMetrics, weeklyBreakdown, activityTypeSummary } = summary;

  const typeLines = activityTypeSummary.map(t =>
    `  • ${t.label}: ${t.last7daysMinutes}min last 7d / ${t.last28daysMinutes}min last 28d (${t.activityCount28} sessions)`
  ).join('\n');

  const weekLines = weeklyBreakdown.map(w =>
    `  ${w.weekLabel}: ${w.totalMinutes}min total`
  ).join('\n');

  return `
--- Strava Training Load Summary ---
Fatigue Status: ${loadMetrics.fatigueLabel}
This Week (ATL): ${loadMetrics.atl} load units
Avg Weekly (CTL): ${loadMetrics.ctl} load units
Form (TSB = CTL−ATL): ${loadMetrics.tsb > 0 ? '+' : ''}${loadMetrics.tsb}

Activity Breakdown (last 28 days):
${typeLines || '  No activities found'}

Weekly Training Time (last 4 weeks):
${weekLines}
------------------------------------`.trim();
}
