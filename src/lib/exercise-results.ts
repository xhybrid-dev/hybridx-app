// src/lib/exercise-results.ts
//
// What athletes actually lifted, ran and held, turned into "last time",
// personal bests and progress lines. Exercises used to be checkboxes plus a
// free-text note, so there was nothing to chart — and seeing a heavier sled
// or a faster 1 km is the main reason to keep logging.

import type { ExerciseResult, WorkoutSession } from '@/models/types';

/** One key per movement, however it's capitalised or spaced. */
export function resultKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hasAnyValue(result: Partial<ExerciseResult> | undefined): boolean {
  return !!result && [result.load, result.reps, result.timeSeconds, result.distance].some(v => typeof v === 'number' && v > 0);
}

/** "mm:ss" or "h:mm:ss" → seconds; bare numbers are minutes. */
export function parseTime(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 60);
  const parts = trimmed.split(':').map(Number);
  if (parts.some(p => Number.isNaN(p)) || parts.length < 2 || parts.length > 3) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatResult(result: Partial<ExerciseResult>): string {
  const parts: string[] = [];
  if (result.load) parts.push(`${result.load}kg`);
  if (result.reps) parts.push(result.load ? `× ${result.reps}` : `${result.reps} reps`);
  if (result.distance) parts.push(result.distance >= 1000 ? `${(result.distance / 1000).toFixed(2)}km` : `${result.distance}m`);
  if (result.timeSeconds) parts.push(formatTime(result.timeSeconds));
  return parts.join(' ');
}

export interface DatedResult extends ExerciseResult {
  date: Date;
  sessionId: string;
}

/** Every logged result for one movement, oldest first. */
export function historyFor(sessions: WorkoutSession[], name: string): DatedResult[] {
  const key = resultKey(name);
  return sessions
    .filter(s => s.finishedAt && !s.skipped && hasAnyValue(s.results?.[key]))
    .map(s => ({ ...s.results![key], date: s.workoutDate, sessionId: s.id }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function lastResult(sessions: WorkoutSession[], name: string, excludeSessionId?: string): DatedResult | null {
  const history = historyFor(sessions, name).filter(r => r.sessionId !== excludeSessionId);
  return history.at(-1) ?? null;
}

export interface PersonalBest {
  name: string;
  label: string;
}

/**
 * New bests in `session` against everything before it: heavier load, more
 * reps at a load at least as heavy, or a faster time over the same distance
 * (or the same prescribed movement when no distance is logged).
 */
export function personalBests(session: WorkoutSession, sessions: WorkoutSession[]): PersonalBest[] {
  const bests: PersonalBest[] = [];
  for (const [key, result] of Object.entries(session.results ?? {})) {
    if (!hasAnyValue(result)) continue;
    const previous = historyFor(sessions, key).filter(r => r.sessionId !== session.id && r.date <= session.workoutDate);
    if (previous.length === 0) continue; // a first result is a baseline, not a record

    if (result.load) {
      const bestLoad = Math.max(0, ...previous.map(r => r.load ?? 0));
      const repsAtBest = Math.max(0, ...previous.filter(r => (r.load ?? 0) === bestLoad).map(r => r.reps ?? 0));
      if (result.load > bestLoad) {
        bests.push({ name: result.name, label: `${result.load}kg (was ${bestLoad}kg)` });
        continue;
      }
      if (result.load === bestLoad && (result.reps ?? 0) > repsAtBest && repsAtBest > 0) {
        bests.push({ name: result.name, label: `${result.load}kg × ${result.reps} (was × ${repsAtBest})` });
        continue;
      }
    }
    if (result.timeSeconds) {
      const comparable = previous.filter(r => r.timeSeconds && (r.distance ?? 0) === (result.distance ?? 0));
      if (comparable.length > 0) {
        const fastest = Math.min(...comparable.map(r => r.timeSeconds!));
        if (result.timeSeconds < fastest) {
          bests.push({ name: result.name, label: `${formatTime(result.timeSeconds)} (was ${formatTime(fastest)})` });
        }
      }
    }
  }
  return bests;
}

export interface ProgressLine {
  name: string;
  metric: 'load' | 'time';
  points: { date: Date; value: number }[];
  first: number;
  latest: number;
  /** Positive = better. */
  improvement: number;
}

/** Movements with at least two comparable results, most-logged first. */
export function progressLines(sessions: WorkoutSession[], limit = 8): ProgressLine[] {
  const names = new Map<string, string>();
  for (const s of sessions) {
    for (const [key, result] of Object.entries(s.results ?? {})) {
      if (hasAnyValue(result) && !names.has(key)) names.set(key, result.name);
    }
  }

  const lines: ProgressLine[] = [];
  for (const [key, name] of names) {
    const history = historyFor(sessions, key);
    const loads = history.filter(r => r.load).map(r => ({ date: r.date, value: r.load! }));
    const times = history.filter(r => r.timeSeconds).map(r => ({ date: r.date, value: r.timeSeconds! }));
    const [metric, points] = loads.length >= times.length ? (['load', loads] as const) : (['time', times] as const);
    if (points.length < 2) continue;
    const first = points[0].value;
    const latest = points[points.length - 1].value;
    lines.push({ name, metric, points, first, latest, improvement: metric === 'load' ? latest - first : first - latest });
  }
  return lines.sort((a, b) => b.points.length - a.points.length).slice(0, limit);
}
