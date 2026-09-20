// scripts/export-training-plans.ts
//
// Dumps every training plan and, for each program day, the exact Garmin
// payload the sync would push for it. The point is reviewability: the same
// adapter and mapper the live sync uses (`workoutToDays` → `mapWorkoutDay`)
// are called here, so what lands in the spreadsheet is what lands on the
// watch — not a second implementation that can drift from the first.
//
// Writes a JSON intermediate; scripts/build-training-plan-workbook.py turns
// that into the .xlsx. Splitting the two keeps the Firestore read (slow,
// credentialed) separate from workbook formatting (fast, re-runnable).
//
// Usage:
//   # against Firestore — needs a service account with Datastore read access
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat sa.json)" npx tsx scripts/export-training-plans.ts --out plans.json
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json  npx tsx scripts/export-training-plans.ts --out plans.json
//
//   # offline smoke test against a checked-in program fixture
//   npx tsx scripts/export-training-plans.ts --from-json src/data/running-programs.json --out plans.json

import * as fs from 'fs';
import * as admin from 'firebase-admin';
import { workoutToDays } from '@/lib/garmin/program-adapter';
import { mapWorkoutDay, classifyWorkout } from '@/lib/garmin/workout-mapper';
import { buildDesiredSessions } from '@/lib/garmin/plan-sync';
import type { WorkoutDay, GarminWorkout } from '@/lib/garmin/workout-mapper';
import type { Program, Workout, RunningWorkout, Exercise, PlannedRun } from '@/models/types';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'hyroxedgeai';

/** Collections holding programs. Both are mapped identically at sync time. */
const PROGRAM_COLLECTIONS = ['programs', 'customPrograms'] as const;

// ── Output shapes ─────────────────────────────────────────────────────────────

interface SessionExport {
  /** Index within the day's sessions, as `workoutToDays` ordered them. */
  sessionIdx: number;
  /** Key the sync writes into `users/{uid}.garminPlanSync.workouts`. */
  dayKey: string;
  sessionType?: string;
  garminSport?: string;
  /** What the heuristic classifier makes of this session, even when
   *  sessionType bypasses it — a disagreement is worth seeing. */
  category: string;
  /** null means the mapper declined to push anything for this session. */
  workout: GarminWorkout | null;
}

interface DayExport {
  /** Position in program.workouts[]. The day number alone is not unique —
   *  some programs store paired sessions as two entries sharing a day. */
  entryIdx: number;
  day: number;
  title: string;
  sourceKind: 'running' | 'hyrox';
  exercises: Exercise[];
  runs: PlannedRun[];
  sessions: SessionExport[];
  /** Data-shape problems found on the stored day, before mapping. */
  dataFlags: string[];
}

interface ProgramExport {
  id: string;
  collection: string;
  name: string;
  description: string;
  programType: string;
  targetRace?: string;
  visibility?: string;
  assignedUserCount: number;
  retainedUserCount: number;
  days: DayExport[];
}

// ── Credential handling ───────────────────────────────────────────────────────

function credential(): admin.credential.Credential {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    // Accept either the JSON blob itself or a path to a key file, since the
    // App Hosting secret stores the blob but a temporary key arrives as a file.
    const json = raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf-8');
    return admin.credential.cert(JSON.parse(json));
  }
  return admin.credential.applicationDefault();
}

// ── Mapping ───────────────────────────────────────────────────────────────────

/**
 * `workoutToDays` reads `w.exercises` unguarded, so a stored day without the
 * field throws there and takes the whole sync request down with it (and
 * would do the same inside buildDesiredSessions() below). Applied once per
 * entry, before either consumer sees it, so one bad document doesn't cost
 * the export of every other one.
 */
function normaliseEntry(w: Workout | RunningWorkout): Workout | RunningWorkout {
  return { ...w, exercises: (w.exercises as Exercise[]) ?? [] } as Workout | RunningWorkout;
}

/**
 * Runs one program day through the real sync path.
 *
 * Mirrors src/app/api/garmin/sync-plan/route.ts: sessions come from
 * `workoutToDays`, and a null mapper result is a skip. `keyByDayAndPayload`
 * supplies the key `reconcileGarminPlan` would actually assign — see
 * `desiredSessionKeys()` below for how it's built. `w` must already be
 * normalised (see `normaliseEntry`).
 */
function exportDay(
  w: Workout | RunningWorkout,
  entryIdx: number,
  hadNoExercises: boolean,
  keyByDayAndPayload: Map<string, string>,
): DayExport {
  const runs: PlannedRun[] = (w as RunningWorkout).runs ?? [];
  const dataFlags: string[] = hadNoExercises
    ? ['stored day has no exercises[] — workoutToDays throws on this shape']
    : [];
  const exercises: Exercise[] = w.exercises as Exercise[];

  const sessions = workoutToDays(w);

  return {
    entryIdx,
    day: w.day,
    title: w.title,
    sourceKind: runs.length > 0 ? 'running' : 'hyrox',
    exercises,
    runs,
    dataFlags,
    sessions: sessions.map((session: WorkoutDay, sessionIdx: number) => {
      const workout = mapWorkoutDay(session);
      // The key reconcileGarminPlan would assign, looked up by exact payload
      // rather than recomputed — see desiredSessionKeys(). A session with no
      // match either mapped to null (nothing is ever created for it, so no
      // real key exists) or was deduplicated against an identical sibling
      // session on the same day; either way this fallback is for the
      // spreadsheet's readability only, not a claim about what Garmin holds.
      const dayKey = (workout && keyByDayAndPayload.get(payloadKey(w.day, workout)))
        ?? (sessions.length > 1 ? `${w.day}_${sessionIdx}` : String(w.day));
      return {
        sessionIdx,
        dayKey,
        sessionType: session.sessionType,
        garminSport: session.garminSport,
        category: classifyWorkout(session),
        workout,
      };
    }),
  };
}

/** Join key for matching a mapped workout back to the reconciler's key for it. */
function payloadKey(day: number, workout: GarminWorkout): string {
  return `${day}::${JSON.stringify(workout)}`;
}

/**
 * The key `reconcileGarminPlan` would assign to every session in this
 * program, keyed by (day, exact mapped payload) so exportDay can look its own
 * sessions up without recomputing the reconciler's indexing or its
 * content-based deduplication — both live in plan-sync.ts, and reading them
 * back through buildDesiredSessions() is what keeps this export unable to
 * drift from what a real sync would actually create.
 *
 * buildDesiredSessions() takes a horizon window; passed 1 and (max day + 1)
 * here so it covers the whole program rather than the ~14 days a real sync
 * would use — this export is for reviewing the plan's content, not one
 * athlete's calendar, and scheduledDate (which needs a real start date) is
 * not read from its output.
 */
function desiredSessionKeys(workouts: Array<Workout | RunningWorkout>): Map<string, string> {
  const maxDay = workouts.reduce((max, w) => Math.max(max, w.day), 0);
  const desired = buildDesiredSessions(workouts, 1, maxDay + 1, 0);
  return new Map(desired.map((d) => [payloadKey(d.day, d.workout), d.key]));
}

function exportProgram(p: Program, collection: string): ProgramExport {
  return {
    id: p.id,
    collection,
    name: p.name ?? '',
    description: p.description ?? '',
    programType: p.programType ?? '',
    targetRace: (p as any).targetRace,
    visibility: p.visibility,
    assignedUserCount: p.assignedUserIds?.length ?? 0,
    retainedUserCount: p.retainedUserIds?.length ?? 0,
    days: (() => {
      const raw = p.workouts ?? [];
      const normalised = raw.map(normaliseEntry);
      const keyByDayAndPayload = desiredSessionKeys(normalised);
      return normalised.map((w, i) => exportDay(w, i, raw[i].exercises == null, keyByDayAndPayload));
    })(),
  };
}

// ── Sources ───────────────────────────────────────────────────────────────────

async function readFirestore(): Promise<ProgramExport[]> {
  admin.initializeApp({ credential: credential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  const out: ProgramExport[] = [];

  for (const collection of PROGRAM_COLLECTIONS) {
    const snap = await db.collection(collection).get();
    console.error(`  ${collection}: ${snap.size} program(s)`);
    for (const doc of snap.docs) {
      out.push(exportProgram({ id: doc.id, ...doc.data() } as Program, collection));
    }
  }
  return out;
}

function readLocalJson(path: string): ProgramExport[] {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const programs: Program[] = Array.isArray(parsed) ? parsed : [parsed];
  return programs.map((p) => exportProgram(p, `local:${path}`));
}

// ── Entry point ───────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const outPath = arg('--out') ?? 'training-plans.json';
  const fromJson = arg('--from-json');

  console.error(fromJson ? `Reading programs from ${fromJson}…` : 'Reading programs from Firestore…');
  const programs = fromJson ? readLocalJson(fromJson) : await readFirestore();

  const totalDays = programs.reduce((n, p) => n + p.days.length, 0);
  const totalSessions = programs.reduce(
    (n, p) => n + p.days.reduce((m, d) => m + d.sessions.length, 0), 0);
  const mapped = programs.reduce(
    (n, p) => n + p.days.reduce((m, d) => m + d.sessions.filter((s) => s.workout).length, 0), 0);

  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: fromJson ?? `firestore:${PROJECT_ID}`,
    programs,
  }, null, 2));

  console.error(
    `Wrote ${outPath}: ${programs.length} programs, ${totalDays} days, ` +
    `${totalSessions} sessions, ${mapped} pushed to Garmin, ${totalSessions - mapped} skipped.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
