/**
 * HybridX → Garmin Training API V2 workout mapper.
 *
 * V2 payload shape (confirmed against Training_API_V2.pdf):
 *   - sport at top level AND inside each segment
 *   - All steps live inside segments[].steps (not at top level)
 *   - type: "WorkoutStep" | "WorkoutRepeatStep"
 *   - intensity: "WARMUP" | "INTERVAL" | "COOLDOWN" | "RECOVERY" | "REST" | "ACTIVE"
 *   - durationType: "TIME" | "DISTANCE" | "OPEN" | "REPS" (uppercase strings)
 *   - targetType: "OPEN" | "HEART_RATE" | "PACE" | "SPEED" | "CADENCE" | "POWER"
 *   - All step fields must be present even when null (API expects complete objects)
 *   - workoutProvider + workoutSourceId max 20 chars — "HybridX" is safe
 */

import { lookupGarminExercise } from './program-enricher';

// ============================================================
// INPUT TYPES
// ============================================================

export interface CsvRow {
  programName: string;
  programDescription: string;
  workoutDay: number;
  workoutTitle: string;
  exerciseName: string;
  exerciseDetails: string;
}

export interface WorkoutDayExercise {
  name: string;
  details: string;
  /** Set when this exercise came from a sessionType row; drives Garmin sport routing. */
  sessionType?: 'strength' | 'cardio';
  /** Explicit Garmin sport type override from the CSV garminSport column. */
  garminSport?: string;
  // Structured Garmin fields — populated from enriched Exercise objects
  garminExerciseCategory?: string;
  garminExerciseName?: string;
  weightKg?: number;
  restSeconds?: number;
  sets?: number;
  reps?: number;
  // For run steps: target pace in m/s
  targetPaceMps?: number;
  /** Structured run data, when the day came from a stored program rather than a CSV. */
  runSpec?: RunStepSpec;
}

/**
 * One planned run, resolved to a single Garmin unit before it reaches the
 * mapper. Built by program-adapter.ts, which still has the PlannedRun to hand;
 * reading it here avoids re-deriving the session from its own prose.
 */
export interface RunStepSpec {
  role: 'warmup' | 'work' | 'recovery' | 'cooldown';
  /** Exactly one unit per step — a step is timed or measured, never both. */
  durationType: 'TIME' | 'DISTANCE' | 'OPEN';
  durationValue: number | null;
  /** Repeat count when this row describes intervals. */
  reps?: number;
  /** Recovery between reps, when the row itself states one. */
  recovery?: { durationType: 'TIME' | 'DISTANCE'; durationValue: number };
  /** HR zone derived from the row's RPE. */
  hrZone?: number;
  description?: string;
}

export interface WorkoutDay {
  day: number;
  title: string;
  exercises: WorkoutDayExercise[];
  /** Explicit session type; when set, bypasses the heuristic classifier. */
  sessionType?: 'run' | 'strength' | 'cardio' | 'rest';
  /** Explicit Garmin sport type to use for this session. */
  garminSport?: string;
}

// ============================================================
// GARMIN TRAINING API V2 OUTPUT TYPES
// ============================================================

// Valid single-segment sport types per Garmin Training API V2 (§3.2.1).
// FUNCTIONAL_STRENGTH_TRAINING is NOT a supported value — use CARDIO_TRAINING.
export type GarminSport =
  | 'RUNNING'
  | 'CYCLING'
  | 'LAP_SWIMMING'
  | 'STRENGTH_TRAINING'
  | 'CARDIO_TRAINING'
  | 'YOGA'
  | 'PILATES'
  | 'GENERIC';

export interface WorkoutStepItem {
  type: 'WorkoutStep';
  stepOrder: number;
  intensity: 'WARMUP' | 'COOLDOWN' | 'INTERVAL' | 'ACTIVE' | 'REST' | 'RECOVERY';
  description: string | null;
  durationType: 'TIME' | 'DISTANCE' | 'OPEN' | 'REPS' | 'CALORIES';
  durationValue: number | null;
  durationValueType: null;
  targetType: 'OPEN' | 'HEART_RATE' | 'PACE' | 'SPEED' | 'CADENCE' | 'POWER';
  /** For a zone target this is the zone itself: HR 1-5, power 1-7 (§3.2.1). */
  targetValue: number | null;
  targetValueLow: number | null;
  targetValueHigh: number | null;
  targetValueType: null;
  secondaryTargetType: null;
  secondaryTargetValue: null;
  secondaryTargetValueLow: null;
  secondaryTargetValueHigh: null;
  secondaryTargetValueType: null;
  strokeType: null;
  drillType: null;
  equipmentType: null;
  exerciseCategory: string | null;
  exerciseName: string | null;
  weightValue: number | null;
  weightDisplayUnit: string | null;
}

export interface WorkoutRepeatStepItem {
  type: 'WorkoutRepeatStep';
  stepOrder: number;
  repeatType: 'REPEAT_UNTIL_STEPS_CMPLT';
  repeatValue: number;
  steps: WorkoutStepItem[];
}

export type WorkoutStep = WorkoutStepItem | WorkoutRepeatStepItem;

export interface GarminWorkoutSegment {
  segmentOrder: number;
  sport: GarminSport;
  poolLength: null;
  poolLengthUnit: null;
  steps: WorkoutStep[];
}

export interface GarminWorkout {
  workoutName: string;
  description: string;
  sport: GarminSport;
  workoutProvider: 'HybridX';
  workoutSourceId: 'HybridX';
  isSessionTransitionEnabled: false;
  poolLength: null;
  poolLengthUnit: null;
  estimatedDurationInSecs?: number;
  segments: GarminWorkoutSegment[];
}

// ============================================================
// RPE → HR ZONE BPM RANGES (using typical zones, no user HR needed)
// ============================================================

export function rpeToHrZone(rpe: number): number {
  if (rpe <= 3) return 1;
  if (rpe <= 6) return 2;
  if (rpe === 7) return 3;
  if (rpe === 8) return 4;
  return 5;
}

export function parseRpe(
  text: string,
): { zone: number; low: number; high: number } | null {
  const m = text.match(/RPE\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);
  if (!m) return null;
  const low = parseInt(m[1], 10);
  const high = m[2] ? parseInt(m[2], 10) : low;
  return { zone: rpeToHrZone(Math.round((low + high) / 2)), low, high };
}

// ============================================================
// NUMERIC PARSERS
// ============================================================

export function parseDurationMinutes(text: string): number | null {
  const m =
    text.match(/(\d+)\s*[- ]\s*minute/i) ||
    text.match(/(\d+)\s*minutes?\b/i) ||
    text.match(/(\d+)\s*min(?!\w)/i);
  return m ? parseInt(m[1], 10) * 60 : null;
}

export function parseDistanceMeters(text: string): number | null {
  const km = text.match(/(\d+(?:\.\d+)?)\s*km\b/i);
  if (km) return Math.round(parseFloat(km[1]) * 1000);
  const m = text.match(/(\d+)\s*m\b(?!in)/i);
  return m ? parseInt(m[1], 10) : null;
}

// An ASCII "x" is not the only way these plans write a multiplier: the
// Unicode multiplication sign ("3 sets × 25 reps") and the spelled-out
// "N sets of M" ("work up to 2 sets of 3 at 85% of your 1RM") both appear
// throughout, and previously fell through both parsers below entirely.
export function parseTimedSets(
  text: string,
): { sets: number; timeS: number } | null {
  const m =
    text.match(/(\d+)\s*(?:sets?)?\s*[x×]\s*(\d+)\s*(?:seconds?|secs?|s\b)/i) ??
    text.match(/(\d+)\s*sets?\s+of\s+(\d+)\s*(?:seconds?|secs?)\b/i);
  if (!m) return null;
  return { sets: parseInt(m[1], 10), timeS: parseInt(m[2], 10) };
}

export function parseSetsReps(
  text: string,
): { sets: number; reps: number; repsMax?: number; isAmrap: boolean } | null {
  const amrap = text.match(/(\d+)\s*x\s*AMRAP/i);
  if (amrap) return { sets: parseInt(amrap[1], 10), reps: 0, isAmrap: true };
  if (/\bAMRAP\b/i.test(text) && !/\d+\s*min.*AMRAP/i.test(text)) {
    return { sets: 1, reps: 0, isAmrap: true };
  }
  // The lookahead excludes a following distance/time unit so a rep count is
  // never confused with "5x800m" or "3x90sec" — those are timed or distance
  // reps, handled by parseTimedSets or the run-interval parsers instead.
  const m =
    text.match(/(\d+)\s*(?:sets?)?\s*[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?\b(?!\s*(?:m\b|sec|s\b))/i) ??
    text.match(/(\d+)\s*sets?\s+of\s+(\d+)\b(?!\s*(?:m\b|sec|s\b))/i);
  if (m) {
    return {
      sets: parseInt(m[1], 10),
      reps: parseInt(m[2], 10),
      repsMax: m[3] ? parseInt(m[3], 10) : undefined,
      isAmrap: false,
    };
  }
  const solo = text.match(/^(\d+)\s*reps?\b/i);
  if (solo) return { sets: 1, reps: parseInt(solo[1], 10), isAmrap: false };
  return null;
}

export function parseRunIntervals(
  text: string,
): { reps: number; distanceM?: number; timeS?: number } | null {
  const dist = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(km|m)\b/i);
  if (dist) {
    const reps = parseInt(dist[1], 10);
    const val = parseFloat(dist[2]);
    return {
      reps,
      distanceM: dist[3].toLowerCase() === 'km' ? val * 1000 : val,
    };
  }
  const time = text.match(/(\d+)\s*x\s*(\d+)[- ]?\s*(min|sec|second)/i);
  if (time) {
    const reps = parseInt(time[1], 10);
    const val = parseInt(time[2], 10);
    return {
      reps,
      timeS: time[3].toLowerCase().startsWith('min') ? val * 60 : val,
    };
  }
  return null;
}

/**
 * Phrases that turn a following time into an aside rather than the length of
 * the session. "A pace you could hold for approx. 1 hour" describes an effort
 * and "fuel every 30-40 min" is a fuelling note; reading either as a duration
 * turns a 5 km threshold run into an hour on the watch.
 */
const ADVISORY_LEAD = /(hold for|every|each|before|after)/i;

/** The duration a description states as the length of the run, in seconds. */
export function parseStatedDuration(text: string): number | null {
  if (!text) return null;
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => number]> = [
    // Longest form first, so "1 hr 45 min" is not read as its trailing "45 min".
    [/(\d+)\s*(?:hrs?|hours?|h)\b\s*(?:and\s+)?(\d+)\s*(?:mins?|minutes?)\b/i,
      (m) => +m[1] * 3600 + +m[2] * 60],
    [/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i, (m) => Math.round(parseFloat(m[1]) * 3600)],
    [/(\d+)\s*[-–]\s*(\d+)\s*(?:mins?|minutes?)\b/i, (m) => Math.round(((+m[1] + +m[2]) / 2) * 60)],
    [/(\d+)\s*(?:mins?|minutes?)\b/i, (m) => +m[1] * 60],
  ];
  for (const [re, toSeconds] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (ADVISORY_LEAD.test(text.slice(Math.max(0, m.index! - 30), m.index!))) continue;
    return toSeconds(m);
  }
  return null;
}

/**
 * The distance a description gives for the run itself, in metres.
 *
 * Kilometres only. A bare metre figure in this prose is never the session — it
 * is strides ("a few 100m strides"), a hill length, or vertical gain ("800m+
 * vert") — and the stored distance covers every row that has one, so reading
 * metres here only ever mistakes an aside for the run.
 */
export function parseStatedRunDistanceMeters(text: string): number | null {
  if (!text) return null;
  const km = text.match(/(\d+(?:\.\d+)?)\s*km\b/i);
  return km ? Math.round(parseFloat(km[1]) * 1000) : null;
}

/**
 * The recovery a work row spells out, kept in whichever unit it uses.
 *
 * Every plan that prescribes one writes it the same way — "with 400m easy jog
 * recovery", "with 90 seconds easy jog recovery" — so the figure is required to
 * sit between "with" and "recovery", separated by nothing but filler. Matching
 * loosely reads the rep itself as its own recovery: "run 4x1 minute at race
 * effort with full recovery" is a one-minute rep and an unspecified recovery,
 * not a one-minute recovery.
 */
export function parseStatedRecovery(
  text: string,
): { durationType: 'TIME' | 'DISTANCE'; durationValue: number } | null {
  if (!text) return null;
  const m = text.match(
    /with\s+(?:full\s+)?(\d+(?:\.\d+)?)\s*(km|m|mins?|minutes?|secs?|seconds?)\b(?:\s+(?:easy|jog|walk|slow|float))*\s+recover/i,
  );
  if (!m) return null;

  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'km') return { durationType: 'DISTANCE', durationValue: Math.round(value * 1000) };
  if (unit === 'm') return { durationType: 'DISTANCE', durationValue: Math.round(value) };
  if (unit.startsWith('min')) return { durationType: 'TIME', durationValue: Math.round(value * 60) };
  return { durationType: 'TIME', durationValue: Math.round(value) };
}

export function parseRecoverySeconds(text: string): number | 'open' {
  const min = text.match(/(\d+)\s*min(?:ute)?s?\s*(?:jog\s*)?(?:recovery|rest)/i);
  if (min) return parseInt(min[1], 10) * 60;
  const sec = text.match(/(\d+)\s*sec(?:ond)?s?\s*(?:rest|recovery)/i);
  if (sec) return parseInt(sec[1], 10);
  return 'open';
}

// ============================================================
// CLASSIFIER
// ============================================================

export type WorkoutCategory =
  | 'rest'
  | 'skip'
  | 'run_easy'
  | 'run_intervals'
  | 'run_long'
  | 'run_benchmark'
  | 'strength'
  | 'hyrox_circuit'
  | 'hyrox_sim';

export function classifyWorkout(day: WorkoutDay): WorkoutCategory {
  const title = day.title.toLowerCase();
  const allText = (
    day.title +
    ' ' +
    day.exercises.map((e) => e.name + ' ' + e.details).join(' ')
  ).toLowerCase();

  if (day.day === 0) return 'skip';
  if (title.includes('welcome') || title.includes("what's next")) return 'skip';
  if (title.includes('race day')) return 'skip';

  if (
    title === 'rest' ||
    title === 'full rest' ||
    title.startsWith('rest ') ||
    title.includes('rest or active') ||
    title.includes('post-race recovery')
  ) {
    return 'rest';
  }

  if (title.includes('simulation') || title.includes('half-sim')) return 'hyrox_sim';
  if (
    title.includes('compromised running') ||
    title.includes('hyrox station') ||
    title.includes('hyrox skills')
  ) {
    return 'hyrox_circuit';
  }

  if (
    title.includes('threshold') ||
    title.includes('interval') ||
    title.includes('tempo') ||
    title.includes('hill')
  ) {
    return 'run_intervals';
  }
  if (title.includes('long slow') || title.includes('long run')) return 'run_long';
  if (title.includes('shakeout')) return 'run_intervals';
  if (title.includes('easy run') || title.includes('deload: easy')) return 'run_easy';
  if (title.includes('benchmark')) return 'run_benchmark';

  if (
    title.includes('strength') ||
    title.includes('power') ||
    title.includes('deload: light') ||
    title.includes('return to training') ||
    title.includes('unilateral')
  ) {
    return 'strength';
  }

  if (/squats|deadlift|press|lunge/.test(allText)) return 'strength';
  if (/\brun\b|\bjog\b/.test(allText)) return 'run_easy';

  return 'skip';
}

// ============================================================
// STEP BUILDERS
// ============================================================

/** Added only to a structured run session that stores no warm-up of its own. */
const DEFAULT_WARMUP_SECS = 900;

class StepCounter {
  private n = 0;
  next(): number {
    return ++this.n;
  }
}

interface BuildStepParams {
  intensity: WorkoutStepItem['intensity'];
  description?: string | null;
  durationType?: WorkoutStepItem['durationType'];
  durationValue?: number | null;
  targetType?: WorkoutStepItem['targetType'];
  targetValue?: number | null;
  targetValueLow?: number | null;
  targetValueHigh?: number | null;
  exerciseCategory?: string | null;
  exerciseName?: string | null;
  weightValue?: number | null;
}

function buildStep(counter: StepCounter, params: BuildStepParams): WorkoutStepItem {
  return {
    type: 'WorkoutStep',
    stepOrder: counter.next(),
    intensity: params.intensity,
    description: params.description ?? null,
    durationType: params.durationType ?? 'OPEN',
    durationValue: params.durationValue ?? null,
    durationValueType: null,
    targetType: params.targetType ?? 'OPEN',
    targetValue: params.targetValue ?? null,
    targetValueLow: params.targetValueLow ?? null,
    targetValueHigh: params.targetValueHigh ?? null,
    targetValueType: null,
    secondaryTargetType: null,
    secondaryTargetValue: null,
    secondaryTargetValueLow: null,
    secondaryTargetValueHigh: null,
    secondaryTargetValueType: null,
    strokeType: null,
    drillType: null,
    equipmentType: null,
    exerciseCategory: params.exerciseCategory ?? null,
    exerciseName: params.exerciseName ?? null,
    weightValue: params.weightValue ?? null,
    weightDisplayUnit: params.weightValue != null ? 'KILOGRAM' : null,
  };
}

function buildRepeat(
  counter: StepCounter,
  iterations: number,
  buildInner: () => WorkoutStepItem[],
): WorkoutRepeatStepItem {
  const stepOrder = counter.next();
  const steps = buildInner();
  return {
    type: 'WorkoutRepeatStep',
    stepOrder,
    repeatType: 'REPEAT_UNTIL_STEPS_CMPLT',
    repeatValue: iterations,
    steps,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Rows that are pure coaching commentary, never the work itself. Deliberately
 * excludes "Format" and "Work N" — in a circuit day those name the round
 * structure and the prescribed movements ("Format: 4 rounds for time" /
 * "Work 1: 500m row · 15 burpees..."), and dropping them would lose the
 * workout, not just tidy it.
 *
 * A skipped row still reaches the athlete: workoutDescription() below reads
 * day.exercises directly, not the filtered step list, so the text lands in
 * the workout's own description field instead of becoming a step to lap past.
 */
const NOTE_ROW = /^[^\w]*(notes?|session\s+notes|coaching\s+notes?|focus|cue|reminder)\b/i;

function isNoteRow(name: string): boolean {
  return NOTE_ROW.test(name.trim());
}

function workoutName(day: WorkoutDay): string {
  return truncate(`D${day.day} – ${day.title}`, 50);
}

function workoutDescription(day: WorkoutDay): string {
  return truncate(
    day.exercises.map((e) => `${e.name}: ${e.details}`).join('\n'),
    1000,
  );
}

function wrapSegment(sport: GarminSport, steps: WorkoutStep[]): GarminWorkoutSegment {
  return { segmentOrder: 1, sport, poolLength: null, poolLengthUnit: null, steps };
}

function makeWorkout(
  day: WorkoutDay,
  sport: GarminSport,
  steps: WorkoutStep[],
  estimatedDurationInSecs?: number,
): GarminWorkout {
  return {
    workoutName: workoutName(day),
    description: workoutDescription(day),
    sport,
    workoutProvider: 'HybridX',
    workoutSourceId: 'HybridX',
    isSessionTransitionEnabled: false,
    poolLength: null,
    poolLengthUnit: null,
    ...(estimatedDurationInSecs != null ? { estimatedDurationInSecs } : {}),
    segments: [wrapSegment(sport, steps)],
  };
}

// ============================================================
// PACE TARGET HELPERS
// ============================================================

// When targetPaceMps is present, use PACE target with a ±5% band.
// When absent, fall back to OPEN so the athlete runs free.
function paceTarget(
  targetPaceMps?: number,
): Pick<BuildStepParams, 'targetType' | 'targetValueLow' | 'targetValueHigh'> {
  if (targetPaceMps) {
    return {
      targetType: 'PACE',
      targetValueLow: Math.round(targetPaceMps * 0.95 * 1000) / 1000,
      targetValueHigh: Math.round(targetPaceMps * 1.05 * 1000) / 1000,
    };
  }
  return { targetType: 'OPEN' };
}

// ============================================================
// WORKOUT BUILDERS
// ============================================================

function mapRunEasy(day: WorkoutDay): GarminWorkout {
  const counter = new StepCounter();
  const details = day.exercises.map((e) => `${e.name} ${e.details}`).join(' ');
  const durationSecs = parseDurationMinutes(details) ?? 1800;
  const rpe = parseRpe(details);
  const zoneDesc = rpe ? ` (RPE ${rpe.low}${rpe.high !== rpe.low ? `–${rpe.high}` : ''})` : '';

  // Use the first available pace target across all exercises
  const targetPaceMps = day.exercises.find((e) => e.targetPaceMps)?.targetPaceMps;

  const steps: WorkoutStep[] = [
    buildStep(counter, {
      intensity: 'ACTIVE',
      description: day.exercises.map((e) => e.name).join('; ') + zoneDesc,
      durationType: 'TIME',
      durationValue: durationSecs,
      ...paceTarget(targetPaceMps),
    }),
  ];

  return makeWorkout(day, 'RUNNING', steps, durationSecs);
}

function mapRunIntervals(day: WorkoutDay): GarminWorkout {
  const counter = new StepCounter();
  const steps: WorkoutStep[] = [];
  let estimatedSecs = 0;

  const allText = day.exercises.map((e) => `${e.name} ${e.details}`).join(' ');
  const targetPaceMps = day.exercises.find((e) => e.targetPaceMps)?.targetPaceMps;

  const warmup = allText.match(/(\d+)\s*min(?:ute)?\s*warm[- ]?up/i);
  if (warmup) {
    const secs = parseInt(warmup[1], 10) * 60;
    steps.push(
      buildStep(counter, {
        intensity: 'WARMUP',
        durationType: 'TIME',
        durationValue: secs,
        targetType: 'OPEN',
      }),
    );
    estimatedSecs += secs;
  }

  const shakeout = allText.match(
    /(\d+)[- ]?minute\s*(?:easy\s*)?jog(?!\s*recovery)/i,
  );
  if (shakeout && !warmup) {
    const secs = parseInt(shakeout[1], 10) * 60;
    steps.push(
      buildStep(counter, {
        intensity: 'WARMUP',
        description: 'Easy jog',
        durationType: 'TIME',
        durationValue: secs,
        targetType: 'OPEN',
      }),
    );
    estimatedSecs += secs;
  }

  const intervalPatterns = findAllIntervalPatterns(allText);
  for (const pat of intervalPatterns) {
    const workSecs = pat.distanceM
      ? Math.round((pat.distanceM / 1000) * 270)
      : pat.timeS ?? 0;
    const recSecs = pat.recovery === 'open' ? 30 : pat.recovery;
    estimatedSecs += pat.reps * (workSecs + recSecs);

    const group = buildRepeat(counter, pat.reps, () => {
      const workStep = buildStep(counter, {
        intensity: 'INTERVAL',
        description: pat.description,
        durationType: pat.distanceM ? 'DISTANCE' : 'TIME',
        durationValue: pat.distanceM ?? pat.timeS,
        ...paceTarget(targetPaceMps),
      });
      const recStep =
        pat.recovery === 'open'
          ? buildStep(counter, {
              intensity: 'RECOVERY',
              description: 'Jog/walk recovery — lap when ready',
              durationType: 'OPEN',
              targetType: 'OPEN',
            })
          : buildStep(counter, {
              intensity: 'RECOVERY',
              durationType: 'TIME',
              durationValue: pat.recovery,
              targetType: 'OPEN',
            });
      return [workStep, recStep];
    });
    steps.push(group);
  }

  const cooldown = allText.match(/(\d+)\s*min(?:ute)?\s*cool[- ]?down/i);
  if (cooldown) {
    const secs = parseInt(cooldown[1], 10) * 60;
    steps.push(
      buildStep(counter, {
        intensity: 'COOLDOWN',
        durationType: 'TIME',
        durationValue: secs,
        targetType: 'OPEN',
      }),
    );
    estimatedSecs += secs;
  }

  if (steps.length === 0) return mapRunEasy(day);

  return makeWorkout(day, 'RUNNING', steps, estimatedSecs || undefined);
}

function findAllIntervalPatterns(text: string): Array<{
  reps: number;
  distanceM?: number;
  timeS?: number;
  zone: number;
  recovery: number | 'open';
  description: string;
}> {
  type Pat = ReturnType<typeof findAllIntervalPatterns>[number];
  const results: Pat[] = [];
  const byKey = new Map<string, number>();

  const regex = /(\d+)\s*x\s*(\d+(?:\.\d+)?)[- ]?\s*(km|m|min|sec|second|minute)\b/gi;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    const reps = parseInt(m[1], 10);
    const val = parseFloat(m[2]);
    const unit = m[3].toLowerCase();

    let distanceM: number | undefined;
    let timeS: number | undefined;
    if (unit === 'km') distanceM = val * 1000;
    else if (unit === 'm') distanceM = val;
    else if (unit.startsWith('min')) timeS = val * 60;
    else if (unit.startsWith('sec')) timeS = val;

    const key = `${reps}_${distanceM ?? `T${timeS}`}`;

    const start = Math.max(0, m.index - 20);
    const end = Math.min(text.length, m.index + m[0].length + 80);
    const localCtx = text.slice(start, end).toLowerCase();
    const postCtx = text.slice(m.index + m[0].length, m.index + m[0].length + 80);

    const rpe = parseRpe(localCtx);
    const isHard =
      /stride|hill sprint|sprint|maximal|all[- ]out|80% effort|90% effort/i.test(
        localCtx,
      );
    const zone = rpe?.zone ?? (isHard ? 5 : 4);

    let label: string;
    if (/\bstride/i.test(localCtx)) label = 'Strides';
    else if (/\bhill/i.test(localCtx) && timeS) label = 'Hill sprint';
    else if (distanceM && distanceM >= 1000) label = `${val}${unit} interval`;
    else if (distanceM) label = `${val}${unit} rep`;
    else if (timeS && timeS <= 60) label = 'Short rep';
    else label = 'Effort';

    let recovery: number | 'open' = 'open';
    const recMin = postCtx.match(/(\d+)\s*min(?:ute)?s?\s*(?:jog\s*)?(?:recovery|rest)/i);
    const recSec = postCtx.match(/(\d+)\s*sec(?:ond)?s?\s*(?:rest|recovery)/i);
    if (recMin) recovery = parseInt(recMin[1], 10) * 60;
    else if (recSec) recovery = parseInt(recSec[1], 10);

    const existingIdx = byKey.get(key);
    if (existingIdx !== undefined) {
      const existing = results[existingIdx];
      if (existing.recovery === 'open' && recovery !== 'open') {
        existing.recovery = recovery;
      }
      if (rpe && zone !== 4) existing.zone = zone;
      continue;
    }

    byKey.set(key, results.length);
    results.push({ reps, distanceM, timeS, zone, recovery, description: label });
  }

  return results;
}

function mapStrength(day: WorkoutDay, sport: GarminSport = 'STRENGTH_TRAINING'): GarminWorkout {
  const counter = new StepCounter();
  const steps: WorkoutStep[] = [];

  steps.push(buildStep(counter, {
    intensity: 'WARMUP',
    description: 'Warm up — press lap when ready',
    durationType: 'OPEN',
    targetType: 'OPEN',
  }));

  for (const ex of day.exercises) {
    if (isNoteRow(ex.name)) continue;

    const rpe = parseRpe(ex.details);

    // Resolve exercise category: prefer structured field, fall back to keyword lookup
    const garminMatch = (ex.garminExerciseCategory && ex.garminExerciseName)
      ? { exerciseCategory: ex.garminExerciseCategory, exerciseName: ex.garminExerciseName }
      : lookupGarminExercise(ex.name);

    // Timed sets: "3x90 seconds", "3x60sec per side"
    const timedSets = parseTimedSets(ex.details);
    if (timedSets) {
      const perSide = /per side|each side/i.test(ex.details);
      const label = perSide ? `${ex.name} — each side` : ex.name;
      steps.push(
        buildRepeat(counter, timedSets.sets * (perSide ? 2 : 1), () => [
          buildStep(counter, {
            intensity: 'ACTIVE',
            description: label,
            durationType: 'TIME',
            durationValue: timedSets.timeS,
            targetType: 'OPEN',
            ...garminMatch,
            weightValue: ex.weightKg ?? null,
          }),
          buildStep(counter, { intensity: 'REST', durationType: 'OPEN', targetType: 'OPEN' }),
        ]),
      );
      continue;
    }

    // A held effort ("max hold", "dead hang") and an unbounded-reps effort
    // ("max unbroken reps") are both "go until you can't" sets with no fixed
    // target — same OPEN-step shape either way, just a different label.
    // "3 sets of max unbroken reps" never states a rep count, so
    // parseSetsReps() (which requires a number on both sides of "x"/"of")
    // correctly returns null for it; the set count is read directly here
    // instead of falling back to a guessed default.
    // "dead hang start" describes how to begin a rep of some other exercise
    // ("Dead hang start, chin over bar..."), not a prescription to hold one —
    // pre-existing ambiguity this regex already had, excluded here so a
    // max-reps pulling set doesn't get mislabelled as a static hold.
    const isMaxHold = /max\s+hold|dead\s+hang(?!\s+start\b)/i.test(ex.name + ex.details);
    // Two things this deliberately does NOT catch, both because an earlier
    // check already handles them correctly:
    //  - Bare "AMRAP" ("3xAMRAP", "AMRAP 10 mins" as a finisher) — parsed
    //    below via parseSetsReps()'s own isAmrap detection, used by 70+
    //    exercises across these programs today.
    //  - A top-set-then-drop-set row ("Top set: 1x5 @ 135kg. Drop to 60kg,
    //    max reps to failure.") — the leading "1x5" already parses as a
    //    real set/rep pair via parseSetsReps() below; that's what should
    //    win, not this. The gate on `!parseSetsReps(ex.details)` is what
    //    keeps this special case from grabbing those ~40 rows and losing
    //    the actual prescribed top set.
    const isMaxReps =
      /max(?:imum)?\s+(?:unbroken\s+)?reps?\b/i.test(ex.name + ex.details)
      && !parseSetsReps(ex.details);
    if (isMaxHold || isMaxReps) {
      // "N sets of max reps" and "Nx Max Reps" both state the set count this
      // way rather than through parseSetsReps()'s "N x M" shape, since there
      // is no M — the second half is "max", not a number.
      const looseSetCount =
        Number((ex.details.match(/(\d+)\s*(?:sets?\b|[x×](?=\s*max))/i) ?? [])[1]) || undefined;
      const setCount = ex.sets ?? parseSetsReps(ex.details)?.sets ?? looseSetCount ?? 3;
      const label = isMaxHold ? 'max hold' : 'max reps';
      steps.push(
        buildRepeat(counter, setCount, () => [
          buildStep(counter, {
            intensity: 'ACTIVE',
            description: `${ex.name} — ${label}`,
            durationType: 'OPEN',
            targetType: 'OPEN',
            ...garminMatch,
            weightValue: ex.weightKg ?? null,
          }),
          buildStep(counter, { intensity: 'REST', durationType: 'OPEN', targetType: 'OPEN' }),
        ]),
      );
      continue;
    }

    // Prefer structured sets/reps over parsed
    const structuredSets = ex.sets;
    const structuredReps = ex.reps;
    const parsedReps = structuredSets == null ? parseSetsReps(ex.details) : null;

    if (structuredSets != null && structuredReps != null) {
      const rpeLabel = rpe
        ? ` @ RPE ${rpe.low}${rpe.high !== rpe.low ? `-${rpe.high}` : ''}`
        : '';
      steps.push(
        buildRepeat(counter, structuredSets, () => {
          const workStep = buildStep(counter, {
            intensity: 'ACTIVE',
            description: `${ex.name} — ${structuredReps}${rpeLabel}`,
            durationType: 'REPS',
            durationValue: structuredReps,
            targetType: 'OPEN',
            ...garminMatch,
            weightValue: ex.weightKg ?? null,
          });
          const restStep = buildStep(counter, {
            intensity: 'REST',
            description: ex.restSeconds ? `Rest ${ex.restSeconds}s` : 'Rest 60–120s',
            durationType: ex.restSeconds ? 'TIME' : 'OPEN',
            durationValue: ex.restSeconds ?? null,
            targetType: 'OPEN',
          });
          return [workStep, restStep];
        }),
      );
      continue;
    }

    if (parsedReps) {
      const rpeLabel = rpe
        ? ` @ RPE ${rpe.low}${rpe.high !== rpe.low ? `-${rpe.high}` : ''}`
        : '';
      const repLabel = parsedReps.isAmrap
        ? 'AMRAP'
        : parsedReps.repsMax
          ? `${parsedReps.reps}-${parsedReps.repsMax}`
          : `${parsedReps.reps}`;
      const description = `${ex.name} — ${repLabel}${rpeLabel}`;

      // Resolve rest period: prefer structured, fall back to parsed
      const restFromDetails = parseRecoverySeconds(ex.details);
      const restSecs = ex.restSeconds ?? (typeof restFromDetails === 'number' ? restFromDetails : null);

      steps.push(
        buildRepeat(counter, parsedReps.sets, () => {
          const workStep: WorkoutStepItem = parsedReps.isAmrap
            ? buildStep(counter, {
                intensity: 'ACTIVE',
                description,
                durationType: 'OPEN',
                targetType: 'OPEN',
                ...garminMatch,
                weightValue: ex.weightKg ?? null,
              })
            : buildStep(counter, {
                intensity: 'ACTIVE',
                description,
                durationType: 'REPS',
                durationValue: parsedReps.repsMax ?? parsedReps.reps,
                targetType: 'OPEN',
                ...garminMatch,
                weightValue: ex.weightKg ?? null,
              });
          const restStep = buildStep(counter, {
            intensity: 'REST',
            description: restSecs ? `Rest ${restSecs}s` : 'Rest 60–120s',
            durationType: restSecs ? 'TIME' : 'OPEN',
            durationValue: restSecs,
            targetType: 'OPEN',
          });
          return [workStep, restStep];
        }),
      );
      continue;
    }

    // Fallback: single open step
    steps.push(
      buildStep(counter, {
        intensity: 'ACTIVE',
        description: `${ex.name}: ${truncate(ex.details, 150)}`,
        durationType: 'OPEN',
        targetType: 'OPEN',
        ...garminMatch,
        weightValue: ex.weightKg ?? null,
      }),
    );
  }

  steps.push(buildStep(counter, {
    intensity: 'COOLDOWN',
    description: 'Cool down — press lap when done',
    durationType: 'OPEN',
    targetType: 'OPEN',
  }));

  return makeWorkout(day, sport, steps);
}

function mapHyroxCircuit(day: WorkoutDay, sport: GarminSport = 'CARDIO_TRAINING'): GarminWorkout {
  const counter = new StepCounter();
  const steps: WorkoutStep[] = [
    buildStep(counter, {
      intensity: 'WARMUP',
      description: 'Warm up — press lap when ready',
      durationType: 'OPEN',
      targetType: 'OPEN',
    }),
    ...day.exercises
      .filter((ex) => !isNoteRow(ex.name))
      .map((ex) =>
        buildStep(counter, {
          intensity: 'ACTIVE',
          description: `${ex.name}: ${truncate(ex.details, 180)}`,
          durationType: 'OPEN',
          targetType: 'OPEN',
        }),
      ),
    buildStep(counter, {
      intensity: 'COOLDOWN',
      description: 'Cool down — press lap when done',
      durationType: 'OPEN',
      targetType: 'OPEN',
    }),
  ];

  return makeWorkout(day, sport, steps);
}

// ============================================================
// MAIN DISPATCHER
// ============================================================

/**
 * Titles whose sessions get bookended with a warm-up and a cool-down. Anything
 * with repeats gets them too, whatever it is called.
 */
const STRUCTURED_RUN_TITLE =
  /interval|hill|threshold|tempo|vo2|repetition|treadmill incline|race[- ]pace|sharpening|race-sim/i;

/** Rest days stored as a run row with nothing in it. */
const REST_RUN_TITLE = /^(rest|rest or cross[- ]?train|what's next|full rest|active recovery \+ strength)/i;

function hrTargetFor(zone: number | undefined): Pick<BuildStepParams, 'targetType' | 'targetValue'> {
  return zone == null ? { targetType: 'OPEN' } : { targetType: 'HEART_RATE', targetValue: zone };
}

/**
 * Only work carries a target. A warm-up or cool-down is run to feel, so pinning
 * it to the session's RPE would have the watch nagging through both.
 */
function specStep(
  counter: StepCounter,
  intensity: WorkoutStepItem['intensity'],
  spec: Pick<RunStepSpec, 'durationType' | 'durationValue' | 'description' | 'hrZone'>,
): WorkoutStepItem {
  const targeted = intensity === 'ACTIVE' || intensity === 'INTERVAL';
  return buildStep(counter, {
    intensity,
    description: spec.description ?? null,
    durationType: spec.durationType,
    durationValue: spec.durationValue,
    ...hrTargetFor(targeted ? spec.hrZone : undefined),
  });
}

/**
 * Builds a run session from the structured rows the program stores, rather
 * than by re-reading the joined prose.
 *
 * Returns null for a rest day, so nothing is pushed for it. Returns null too
 * when the day carries no structured rows, which leaves the CSV-derived days
 * to the older text-parsing builders.
 */
export function mapRunStructured(day: WorkoutDay): GarminWorkout | null {
  const specs = day.exercises
    .map((e) => e.runSpec)
    .filter((r): r is RunStepSpec => r != null);
  if (specs.length === 0) return null;

  const hasWork = specs.some(
    (r) => r.role !== 'recovery' && (r.durationValue ?? 0) > 0,
  );
  if (REST_RUN_TITLE.test(day.title.trim()) && !hasWork) return null;

  const counter = new StepCounter();
  const steps: WorkoutStep[] = [];
  let estimated = 0;

  const warmup = specs.find((r) => r.role === 'warmup');
  const cooldown = specs.find((r) => r.role === 'cooldown');
  const recoveryRow = specs.find((r) => r.role === 'recovery');
  const work = specs.filter((r) => r.role === 'work');

  const structured =
    specs.some((r) => (r.reps ?? 0) > 1) || STRUCTURED_RUN_TITLE.test(day.title);

  const addTime = (secs: number | null | undefined) => {
    if (secs) estimated += secs;
  };

  // ── Warm-up ───────────────────────────────────────────────────────────────
  // A stored warm-up is always sent, whatever kind of day it is — a race day
  // stores one and dropping it would lose a step the plan asked for. Only the
  // 15-minute default is reserved for structured sessions.
  if (warmup) {
    steps.push(specStep(counter, 'WARMUP', warmup));
    if (warmup.durationType === 'TIME') addTime(warmup.durationValue);
  } else if (structured) {
    steps.push(buildStep(counter, {
      intensity: 'WARMUP',
      description: 'Easy jog warm-up',
      durationType: 'TIME',
      durationValue: DEFAULT_WARMUP_SECS,
      targetType: 'OPEN',
    }));
    addTime(DEFAULT_WARMUP_SECS);
  }

  // ── Work ──────────────────────────────────────────────────────────────────
  for (const row of work) {
    const reps = row.reps ?? 0;
    if (reps <= 1) {
      steps.push(specStep(counter, structured ? 'ACTIVE' : 'ACTIVE', row));
      if (row.durationType === 'TIME') addTime(row.durationValue);
      continue;
    }

    // Recovery is never left open: the row's own figure first, then the day's
    // dedicated recovery row, then a default set by how long the rep is.
    const recovery = row.recovery
      ?? (recoveryRow && recoveryRow.durationValue != null
            ? { durationType: recoveryRow.durationType as 'TIME' | 'DISTANCE',
                durationValue: recoveryRow.durationValue }
            : defaultRecovery(row));

    steps.push(buildRepeat(counter, reps, () => [
      specStep(counter, 'INTERVAL', row),
      buildStep(counter, {
        intensity: 'RECOVERY',
        description: 'Recovery jog',
        durationType: recovery.durationType,
        durationValue: recovery.durationValue,
        targetType: 'OPEN',
      }),
    ]));

    if (row.durationType === 'TIME') addTime((row.durationValue ?? 0) * reps);
    if (recovery.durationType === 'TIME') addTime(recovery.durationValue * reps);
  }

  // ── Cool-down ─────────────────────────────────────────────────────────────
  if (cooldown) {
    steps.push(specStep(counter, 'COOLDOWN', cooldown));
    if (cooldown.durationType === 'TIME') addTime(cooldown.durationValue);
  } else if (structured) {
    steps.push(buildStep(counter, {
      intensity: 'COOLDOWN',
      description: 'Cool down — press lap when done',
      durationType: 'OPEN',
      targetType: 'OPEN',
    }));
  }

  if (steps.length === 0) return null;
  return makeWorkout(day, 'RUNNING', steps, estimated || undefined);
}

/** 2 min after a long rep, 90 s after a short one. */
function defaultRecovery(row: RunStepSpec): { durationType: 'TIME'; durationValue: number } {
  const long =
    (row.durationType === 'DISTANCE' && (row.durationValue ?? 0) >= 1000) ||
    (row.durationType === 'TIME' && (row.durationValue ?? 0) >= 180);
  return { durationType: 'TIME', durationValue: long ? 120 : 90 };
}

export function mapWorkoutDay(day: WorkoutDay): GarminWorkout | null {
  // When sessionType is explicitly provided, use it to bypass the heuristic classifier.
  if (day.sessionType) {
    const sport = day.garminSport as GarminSport | undefined;
    switch (day.sessionType) {
      case 'rest':
        return null;
      case 'run': {
        // Stored programs carry the session's structure on the rows themselves.
        // Only CSV-derived days, which have no runSpec, fall back to reading
        // the structure back out of the prose.
        const structured = mapRunStructured(day);
        if (structured) return structured;
        if (day.exercises.some((e) => e.runSpec)) return null;  // rest day

        const category = classifyWorkout(day);
        return category === 'run_intervals' ? mapRunIntervals(day) : mapRunEasy(day);
      }
      case 'strength':
        return mapStrength(day, sport ?? 'STRENGTH_TRAINING');
      case 'cardio':
        return mapHyroxCircuit(day, sport ?? 'CARDIO_TRAINING');
    }
  }

  // Heuristic path for legacy WorkoutDay objects without explicit sessionType.
  const category = classifyWorkout(day);
  switch (category) {
    case 'skip':
    case 'rest':
      return null;
    case 'run_easy':
    case 'run_long':
      return mapRunEasy(day);
    case 'run_intervals':
      return mapRunIntervals(day);
    case 'run_benchmark': {
      const runEx = day.exercises.filter((e) =>
        /run|jog|time trial/i.test(e.name + ' ' + e.details),
      );
      if (runEx.length) return mapRunEasy({ ...day, exercises: runEx });
      return mapStrength(day);
    }
    case 'strength':
      return mapStrength(day);
    case 'hyrox_circuit':
    case 'hyrox_sim':
      return mapHyroxCircuit(day);
  }
}

// ============================================================
// CSV / FIRESTORE PIPELINE
// ============================================================

export function groupRowsByDay(rows: CsvRow[]): WorkoutDay[] {
  const map = new Map<number, WorkoutDay>();
  for (const row of rows) {
    if (!map.has(row.workoutDay)) {
      map.set(row.workoutDay, {
        day: row.workoutDay,
        title: row.workoutTitle,
        exercises: [],
      });
    }
    map.get(row.workoutDay)!.exercises.push({
      name: row.exerciseName,
      details: row.exerciseDetails,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.day - b.day);
}

export interface MappedDay {
  day: number;
  title: string;
  category: WorkoutCategory;
  workout: GarminWorkout | null;
}

export function mapTrainingPlan(rows: CsvRow[]): MappedDay[] {
  return groupRowsByDay(rows).map((day) => ({
    day: day.day,
    title: day.title,
    category: classifyWorkout(day),
    workout: mapWorkoutDay(day),
  }));
}
