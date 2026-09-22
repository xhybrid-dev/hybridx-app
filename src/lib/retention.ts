// src/lib/retention.ts
//
// Activation and weekly cohort retention, computed from signups and finished
// workouts. "Retained in week N" means the athlete finished at least one
// (non-skipped) workout in their Nth week after signing up.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface SignupRow {
  userId: string;
  signedUpAt: Date;
}

export interface WorkoutRow {
  userId: string;
  finishedAt: Date;
}

export interface CohortRow {
  /** Monday (UTC) of the signup week, YYYY-MM-DD. */
  weekStart: string;
  size: number;
  /** Percent retained in week 0, 1, 2… — null where the week hasn't fully elapsed for anyone. */
  retained: (number | null)[];
}

export interface RetentionReport {
  activation: { signups: number; activated: number; rate: number };
  cohorts: CohortRow[];
}

function mondayKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function computeRetention(
  signups: SignupRow[],
  workouts: WorkoutRow[],
  now: Date,
  weeks = 8,
): RetentionReport {
  const byUser = new Map<string, Date[]>();
  for (const w of workouts) {
    const list = byUser.get(w.userId) ?? [];
    list.push(w.finishedAt);
    byUser.set(w.userId, list);
  }

  // Activation: a finished workout within 72 hours, among signups at least 72 hours old.
  const matured = signups.filter(s => now.getTime() - s.signedUpAt.getTime() >= 3 * DAY_MS);
  const activated = matured.filter(s =>
    (byUser.get(s.userId) ?? []).some(f => {
      const delta = f.getTime() - s.signedUpAt.getTime();
      return delta >= 0 && delta <= 3 * DAY_MS;
    }),
  ).length;

  const cohorts = new Map<string, SignupRow[]>();
  for (const s of signups) {
    const key = mondayKey(s.signedUpAt);
    const list = cohorts.get(key) ?? [];
    list.push(s);
    cohorts.set(key, list);
  }

  const rows: CohortRow[] = [...cohorts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, members]) => {
      const retained: (number | null)[] = [];
      for (let k = 0; k < weeks; k++) {
        const eligible = members.filter(m => m.signedUpAt.getTime() + (k + 1) * WEEK_MS <= now.getTime());
        if (eligible.length === 0) {
          retained.push(null);
          continue;
        }
        const active = eligible.filter(m =>
          (byUser.get(m.userId) ?? []).some(f => {
            const delta = f.getTime() - m.signedUpAt.getTime();
            return delta >= k * WEEK_MS && delta < (k + 1) * WEEK_MS;
          }),
        ).length;
        retained.push(Math.round((active / eligible.length) * 100));
      }
      return { weekStart, size: members.length, retained };
    });

  return {
    activation: {
      signups: matured.length,
      activated,
      rate: matured.length > 0 ? Math.round((activated / matured.length) * 100) : 0,
    },
    cohorts: rows,
  };
}
