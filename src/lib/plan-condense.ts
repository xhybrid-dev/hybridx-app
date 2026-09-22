// src/lib/plan-condense.ts
//
// Fits a program to the number of days a week an athlete can train, week by
// week, without a model.
//
// This replaced an AI flow whose prompt was written for ONE week ("the output
// MUST contain exactly 3 workouts") but was handed whole 12-week programs at
// signup, so athletes were left with a single week of training. A deterministic
// pass is instant, cannot truncate a plan, and keeps each session on the
// weekday the program's author put it.

export type TrainingDays = '3' | '4' | '5+';

interface PlanWorkout {
  day: number;
  title: string;
  exercises?: unknown[];
  runs?: unknown[];
}

const LOW_PRIORITY = /\b(recovery|easy|mobility|stretch|optional|active rest|shake[- ]?out|flush)\b/i;
const HIGH_PRIORITY = /\b(long run|race|simulation|sim|test|benchmark|time trial|tempo|threshold|interval|hyrox)\b/i;

function isRest(workout: PlanWorkout): boolean {
  const empty = (workout.exercises?.length ?? 0) === 0 && (workout.runs?.length ?? 0) === 0;
  return empty || (/\brest\b/i.test(workout.title) && !HIGH_PRIORITY.test(workout.title));
}

/** Higher = keep first. */
function dayPriority(workouts: PlanWorkout[]): number {
  let score = 0;
  for (const w of workouts) {
    if (HIGH_PRIORITY.test(w.title)) score += 100;
    if (LOW_PRIORITY.test(w.title)) score -= 50;
    score += (w.exercises?.length ?? 0) + (w.runs?.length ?? 0);
  }
  return score;
}

/**
 * The plan with, in each week, only the `target` most important training
 * days kept. Days keep their original positions; rest entries are untouched.
 * A plan that already fits comes back unchanged (as a new array).
 */
export function condensePlan<T extends PlanWorkout>(workouts: T[], target: TrainingDays): T[] {
  if (target === '5+') return [...workouts];
  const perWeek = Number(target);

  const byWeek = new Map<number, Map<number, T[]>>();
  for (const workout of workouts) {
    if (isRest(workout)) continue;
    const week = Math.ceil(workout.day / 7);
    const days = byWeek.get(week) ?? new Map<number, T[]>();
    const list = days.get(workout.day) ?? [];
    list.push(workout);
    days.set(workout.day, list);
    byWeek.set(week, days);
  }

  const dropped = new Set<number>();
  for (const days of byWeek.values()) {
    if (days.size <= perWeek) continue;
    const ranked = [...days.entries()].sort(
      ([dayA, a], [dayB, b]) => dayPriority(b) - dayPriority(a) || dayA - dayB,
    );
    for (const [day] of ranked.slice(perWeek)) dropped.add(day);
  }

  return workouts.filter(w => isRest(w) || !dropped.has(w.day));
}

/** Training days per week the plan asks for at most. */
export function maxTrainingDaysPerWeek(workouts: PlanWorkout[]): number {
  const weeks = new Map<number, Set<number>>();
  for (const w of workouts) {
    if (isRest(w)) continue;
    const week = Math.ceil(w.day / 7);
    const set = weeks.get(week) ?? new Set<number>();
    set.add(w.day);
    weeks.set(week, set);
  }
  return Math.max(0, ...[...weeks.values()].map(s => s.size));
}

/**
 * The plan resized to the athlete's weekly availability, or null when it
 * already fits (or they train 5+ days) and should be used as it is.
 */
export function fitToSchedule<T extends PlanWorkout>(workouts: T[], frequency: string | null | undefined): T[] | null {
  if (frequency !== '3' && frequency !== '4') return null;
  if (maxTrainingDaysPerWeek(workouts) <= Number(frequency)) return null;
  return condensePlan(workouts, frequency);
}
