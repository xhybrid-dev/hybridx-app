/**
 * Adapt the app's Firestore program shapes (Workout / RunningWorkout) into
 * the WorkoutDay shape(s) the mapper expects. Pure functions, no I/O.
 */
import type { Workout, RunningWorkout, PlannedRun, Exercise } from '@/models/types';
import type { WorkoutDay, WorkoutDayExercise, RunStepSpec } from './workout-mapper';
import {
  parseStatedDuration,
  parseStatedRunDistanceMeters,
  parseStatedRecovery,
  rpeToHrZone,
} from './workout-mapper';

const IS_WARMUP = /warm[- ]?up/i;
const IS_COOLDOWN = /cool[- ]?down/i;
const IS_REP_RECOVERY = /between reps|recovery between/i;

function runRole(run: PlannedRun): RunStepSpec['role'] {
  const desc = run.description || '';
  if (IS_WARMUP.test(desc)) return 'warmup';
  if (IS_COOLDOWN.test(desc)) return 'cooldown';
  if (run.type === 'recovery' && IS_REP_RECOVERY.test(desc)) return 'recovery';
  return 'work';
}

/**
 * Settles the run on one unit: a duration the description states, then the
 * stored distance, then a distance the description states. A step is timed or
 * measured, never both — a long run stored as 25.8 km stays a distance and a
 * recovery run written as "30 minutes" stays a time.
 */
function runUnit(run: PlannedRun): Pick<RunStepSpec, 'durationType' | 'durationValue'> {
  const desc = run.description || '';

  // A duration is only believable if it could actually cover the row's stored
  // distance. Some rows pack a whole session into shorthand — "WU 10. 3x90s at
  // 6% incline, 2 min walk. CD 5." over 5.2 km — where the first figure found
  // belongs to one step inside the session, not the session. An implied pace
  // outside 2:30/km to 20:00/km says the figure was never the length of the run.
  const seconds = parseStatedDuration(desc);
  if (seconds) {
    const impliedSecondsPerKm = run.distance > 0 ? seconds / run.distance : null;
    const plausible =
      impliedSecondsPerKm === null ||
      (impliedSecondsPerKm >= 150 && impliedSecondsPerKm <= 1200);
    if (plausible) return { durationType: 'TIME', durationValue: seconds };
  }

  // The stored distance is the length of the row; a kilometre figure in the
  // prose is as likely to be a split within it — "run the first 7km easy, then
  // push the final 3km" on a 10 km row — so it is only consulted when the row
  // stores no distance of its own.
  if (run.distance > 0) {
    return { durationType: 'DISTANCE', durationValue: Math.round(run.distance * 1000) };
  }

  const metres = parseStatedRunDistanceMeters(desc);
  if (metres) return { durationType: 'DISTANCE', durationValue: metres };

  return { durationType: 'OPEN', durationValue: null };
}

function runSpecFor(run: PlannedRun): RunStepSpec {
  const desc = run.description || '';
  const recovery = parseStatedRecovery(desc);
  return {
    role: runRole(run),
    ...runUnit(run),
    ...((run.noIntervals ?? 0) > 1 ? { reps: run.noIntervals } : {}),
    ...(recovery ? { recovery } : {}),
    ...(run.effortLevel ? { hrZone: rpeToHrZone(run.effortLevel) } : {}),
    description: desc || undefined,
  };
}

function describePlannedRun(run: PlannedRun): WorkoutDayExercise {
  // Express distance in whole meters when < 1 km to avoid decimal ambiguity in
  // the mapper's regex (e.g. 0.8 km → 800m, giving "5x800m" not "5x 0.8km").
  const distMeters = run.distance ? Math.round(run.distance * 1000) : 0;
  const distStr = distMeters >= 1000
    ? `${run.distance}km`
    : distMeters > 0 ? `${distMeters}m` : '';

  // Produce canonical "5x800m" format that findAllIntervalPatterns expects.
  let name: string;
  if (run.noIntervals && run.noIntervals > 1 && distStr) {
    name = `${run.noIntervals}x${distStr}`;
  } else {
    name = [distStr, run.type].filter(Boolean).join(' ').trim() || 'Run';
  }

  const detailsParts: string[] = [];
  if (run.description) detailsParts.push(run.description);
  if (run.effortLevel) detailsParts.push(`RPE ${run.effortLevel}`);
  if (run.targetPace) {
    const min = Math.floor(run.targetPace / 60);
    const sec = Math.round(run.targetPace % 60).toString().padStart(2, '0');
    detailsParts.push(`Target pace ${min}:${sec}/km`);
  }
  if (run.paceZone) detailsParts.push(`Zone: ${run.paceZone}`);

  // targetPace is seconds/km; Garmin PACE targets use m/s
  const targetPaceMps = run.targetPace ? 1000 / run.targetPace : undefined;

  return {
    name,
    details: detailsParts.join('. '),
    ...(targetPaceMps != null ? { targetPaceMps } : {}),
    runSpec: runSpecFor(run),
  };
}

function adaptExercise(e: Exercise): WorkoutDayExercise {
  return {
    name: e.name,
    details: e.details,
    ...(e.sessionType ? { sessionType: e.sessionType } : {}),
    ...(e.garminSport ? { garminSport: e.garminSport } : {}),
    ...(e.garminExerciseCategory ? { garminExerciseCategory: e.garminExerciseCategory } : {}),
    ...(e.garminExerciseName ? { garminExerciseName: e.garminExerciseName } : {}),
    ...(e.weightKg != null ? { weightKg: e.weightKg } : {}),
    ...(e.restSeconds != null ? { restSeconds: e.restSeconds } : {}),
    ...(e.sets != null ? { sets: e.sets } : {}),
    ...(e.reps != null ? { reps: e.reps } : {}),
  };
}

/**
 * Converts one program day into one or more WorkoutDay sessions for Garmin.
 *
 * A hybrid day (e.g. treadmill run + lower-body strength) produces two
 * WorkoutDay objects so the mapper creates two separate Garmin workouts.
 * Exercise rows are grouped by their (sessionType, garminSport) pair so
 * that e.g. strength and CrossFit conditioning on the same day get distinct
 * sport types on the watch.
 */
export function workoutToDays(w: Workout | RunningWorkout): WorkoutDay[] {
  const result: WorkoutDay[] = [];

  // ── Run session ──────────────────────────────────────────────────────────
  const runs: PlannedRun[] = (w as RunningWorkout).runs ?? [];
  if (runs.length > 0) {
    result.push({
      day: w.day,
      title: w.title,
      exercises: runs.map(describePlannedRun),
      sessionType: 'run',
      garminSport: 'RUNNING',
    });
  }

  // ── Exercise sessions ────────────────────────────────────────────────────
  const rawExercises = (w.exercises as Exercise[]).filter(e => e.name || e.details);
  if (rawExercises.length > 0) {
    // Group by (sessionType, garminSport) to preserve session boundaries.
    // Exercises without sessionType default to 'strength'.
    const order: string[] = [];
    const groups = new Map<string, Exercise[]>();

    for (const ex of rawExercises) {
      const st = ex.sessionType ?? 'strength';
      const gs = ex.garminSport ?? (st === 'cardio' ? 'CARDIO_TRAINING' : 'STRENGTH_TRAINING');
      const key = `${st}|${gs}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(ex);
    }

    for (const key of order) {
      const [st, gs] = key.split('|') as ['strength' | 'cardio', string];
      result.push({
        day: w.day,
        title: w.title,
        exercises: groups.get(key)!.map(adaptExercise),
        sessionType: st,
        garminSport: gs,
      });
    }
  }

  return result;
}

/**
 * Legacy single-session adapter — kept for call sites that haven't migrated
 * to workoutToDays yet. For hybrid days it only returns the exercise session.
 */
export function workoutToDay(w: Workout | RunningWorkout): WorkoutDay {
  if (w.programType === 'running') {
    return {
      day: w.day,
      title: w.title,
      exercises: (w as RunningWorkout).runs.map(describePlannedRun),
      sessionType: 'run',
      garminSport: 'RUNNING',
    };
  }
  return {
    day: w.day,
    title: w.title,
    exercises: w.exercises.map(adaptExercise),
  };
}
