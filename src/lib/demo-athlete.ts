// src/lib/demo-athlete.ts
//
// The content of the demo athlete created by scripts/seed-demo-athlete.ts: a
// 16-week plan, the sessions already completed, a coach conversation and the
// coach's notes. Kept here (pure, no Firestore) so it can be tested.
//
// Used for App Store screenshots and the App Review account, so the copy is
// deliberately brand-neutral: no third-party event names (HYROX, ATHX) and no
// real person's data.

import type { Exercise, PlannedRun, WorkoutDay } from '@/models/types';
import type { StoredCoachMessage } from '@/services/coach-conversation';
import type { CoachNoteCategory } from '@/services/coach-notes';

export const DEMO_PLAN_WEEKS = 16;
export const DEMO_PLAN_NAME = 'Race Ready: 16-Week Hybrid Build';
export const DEMO_RACE_NAME = 'Winter hybrid race';

const DAY_MS = 86_400_000;

// ─── Plan ────────────────────────────────────────────────────────────────────

function phaseFor(week: number): string {
  if (week <= 4) return 'Base';
  if (week <= 10) return 'Build';
  if (week <= 14) return 'Peak';
  return 'Taper';
}

const strength = (name: string, details: string): Exercise => ({ name, details, sessionType: 'strength' });
const cardio = (name: string, details: string): Exercise => ({ name, details, sessionType: 'cardio' });

function run(type: PlannedRun['type'], distance: number, paceZone: PlannedRun['paceZone'], description: string, effortLevel: PlannedRun['effortLevel']): PlannedRun {
  return { type, distance, paceZone, description, effortLevel };
}

function lowerStrength(day: number, week: number): WorkoutDay {
  const reps = week <= 4 ? 8 : week <= 10 ? 6 : 4;
  return {
    day,
    programType: 'hyrox',
    title: `Week ${week}: Lower Strength + Sled`,
    exercises: [
      strength('Back Squat', `4 × ${reps} at RPE 7. Rest 2 min.`),
      strength('Romanian Deadlift', '3 × 8, controlled on the way down'),
      cardio('Sled Push', `${week <= 4 ? 4 : 5} × 25 m, race weight`),
      strength('Walking Lunges', '3 × 20 m with dumbbells'),
      strength('Plank', '3 × 45 s'),
    ],
  };
}

function intervals(day: number, week: number): WorkoutDay {
  const reps = Math.min(4 + Math.floor(week / 2), 10);
  return {
    day,
    programType: 'running',
    title: `Week ${week}: Track Intervals`,
    exercises: [],
    runs: [
      run('intervals', 8, 'interval',
        `Warm-up 15 min easy, then ${reps} × 800 m at 5K effort with 90 s jog recovery. Cool-down 10 min.`, 8),
    ],
  } as WorkoutDay;
}

function runPlusStations(day: number, week: number): WorkoutDay {
  return {
    day,
    programType: 'hyrox',
    title: `Week ${week}: Run + Stations`,
    runs: [run('tempo', 3, 'threshold', '3 × 1 km at goal race pace, straight into each station block.', 7)],
    exercises: [
      cardio('SkiErg', '1000 m, steady and strong'),
      cardio('Burpee Broad Jumps', '40 m'),
      cardio('Row', '1000 m'),
      cardio('Farmers Carry', '2 × 100 m, heavy'),
    ],
  } as WorkoutDay;
}

function emom(day: number, week: number): WorkoutDay {
  const minutes = week <= 4 ? 12 : week <= 10 ? 16 : 20;
  return {
    day,
    programType: 'hyrox',
    title: `Week ${week}: EMOM Engine`,
    exercises: [
      // Cardio first, so the calendar labels the day Conditioning, not Strength.
      cardio('Dumbbell Thrusters', '3 × 8 reps'),
      cardio(`EMOM ${minutes}`, 'Alternating minutes: 12 wall balls, 10 burpees'),
      cardio('Sandbag Lunges', '3 × 20 m'),
    ],
  };
}

function upperStrength(day: number, week: number): WorkoutDay {
  return {
    day,
    programType: 'hyrox',
    title: `Week ${week}: Upper Body + Core`,
    exercises: [
      strength('Push Press', `4 × ${week <= 8 ? 6 : 5} at RPE 7`),
      strength('Weighted Pull-Up', '3 × 6'),
      strength('Dumbbell Bench Press', '3 × 10'),
      strength('Bent-Over Row', '3 × 10'),
      strength('Hanging Knee Raise', '3 × 12'),
    ],
  };
}

function longRun(day: number, week: number): WorkoutDay {
  const km = Math.min(10 + week, 21);
  return {
    day,
    programType: 'running',
    title: `Week ${week}: Long Run`,
    exercises: [],
    runs: [run('long', km, 'easy', `${km} km at a conversational pace. Pick up the last 2 km.`, 5)],
  } as WorkoutDay;
}

function raceWeek(start: number, week: number): WorkoutDay[] {
  return [
    {
      day: start + 1,
      programType: 'hyrox',
      title: `Week ${week}: Race-Week Primer`,
      exercises: [
        strength('Back Squat', '3 × 3 at RPE 6, crisp and fast'),
        cardio('Sled Push', '3 × 15 m, light'),
        cardio('Wall Balls', '2 × 15'),
      ],
    },
    {
      day: start + 2,
      programType: 'running',
      title: `Week ${week}: Sharpening Run`,
      exercises: [],
      runs: [run('tempo', 6, 'threshold', '10 min easy, 3 × 3 min at race pace, 10 min easy.', 6)],
    } as WorkoutDay,
    {
      day: start + 4,
      programType: 'running',
      title: `Week ${week}: Shake-Out Run`,
      exercises: [],
      runs: [run('easy', 4, 'easy', '20 min easy with 4 strides.', 3)],
    } as WorkoutDay,
    {
      day: start + 6,
      programType: 'hyrox',
      title: 'Race Day',
      exercises: [
        cardio('Race', '8 × 1 km run with a station after each. Warm up 15 min, start controlled, finish strong.'),
      ],
    },
  ];
}

/**
 * The 16-week plan, Monday-first. Sundays are unscheduled, so they are rest.
 * The last Saturday is race day.
 */
export function buildDemoPlan(): WorkoutDay[] {
  const workouts: WorkoutDay[] = [];
  for (let week = 1; week <= DEMO_PLAN_WEEKS; week++) {
    const start = (week - 1) * 7;
    if (week === DEMO_PLAN_WEEKS) {
      workouts.push(...raceWeek(start, week));
      continue;
    }
    workouts.push(
      lowerStrength(start + 1, week),
      intervals(start + 2, week),
      runPlusStations(start + 3, week),
      emom(start + 4, week),
      upperStrength(start + 5, week),
      longRun(start + 6, week),
    );
  }
  return workouts;
}

export function demoPlanDescription(): string {
  return `A ${DEMO_PLAN_WEEKS}-week hybrid race build: strength, intervals, station work and a weekly long run, ` +
    `moving from ${phaseFor(1).toLowerCase()} to ${phaseFor(DEMO_PLAN_WEEKS).toLowerCase()} and finishing on race day.`;
}

// ─── Calendar helpers ────────────────────────────────────────────────────────

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. 60 for BST). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant of `hour:minute` on a calendar day (UTC-based day number) in `timeZone`. */
export function zonedInstant(dayNumber: number, timeZone: string, hour = 0, minute = 0): Date {
  const naive = dayNumber * DAY_MS + (hour * 60 + minute) * 60_000;
  const first = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  // Re-check once: the offset can differ either side of a clock change.
  return new Date(naive - zoneOffsetMinutes(new Date(first), timeZone) * 60_000);
}

/** Today's calendar day in `timeZone`, as a UTC day number. */
export function zonedDayNumber(now: Date, timeZone: string): number {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** The Monday that makes today fall in week `weekInPlan` (1-based). */
export function demoPlanStartDay(todayDay: number, weekInPlan: number): number {
  const weekday = (new Date(todayDay * DAY_MS).getUTCDay() + 6) % 7; // 0 = Monday
  return todayDay - weekday - (weekInPlan - 1) * 7;
}

// ─── History ─────────────────────────────────────────────────────────────────

export interface DemoSession {
  programId: string;
  workoutDate: Date;
  workoutTitle: string;
  programType: 'hyrox' | 'running' | 'hybrid';
  startedAt: Date;
  finishedAt: Date;
  duration: string;
  notes: string;
  rpe: number;
  startedInApp: true;
  skipped: false;
  sessionIndex: 0;
  sessionCount: 1;
  workoutDetails: WorkoutDay;
  timerRecord?: { timerMode: 'emom'; totalTime: number; completedAt: string };
}

const NOTES = [
  'Felt strong today.',
  'Legs heavy for the first 10 minutes, then settled.',
  'Kept the pacing even. Happy with that.',
  '',
  'Good session. Sled felt lighter than last week.',
  '',
  'Tough last round but held form.',
];

function programTypeOf(workout: WorkoutDay): DemoSession['programType'] {
  const hasRuns = ((workout as { runs?: unknown[] }).runs?.length ?? 0) > 0;
  const hasExercises = (workout.exercises?.length ?? 0) > 0;
  if (hasRuns && hasExercises) return 'hybrid';
  return hasRuns ? 'running' : 'hyrox';
}

/**
 * A completed session for every planned day before today: the full,
 * consistent history a committed athlete would have, so the calendar shows
 * green and the consistency chart is healthy.
 */
export function buildDemoSessions(
  plan: WorkoutDay[],
  programId: string,
  startDay: number,
  todayDay: number,
  timeZone: string,
): DemoSession[] {
  const sessions: DemoSession[] = [];
  for (const workout of plan) {
    const dayNumber = startDay + workout.day - 1;
    if (dayNumber >= todayDay) continue;

    const isRun = programTypeOf(workout) === 'running';
    const isLong = workout.title.includes('Long Run');
    const morning = isRun ? 6 : 7;
    const minutes = isLong ? 80 + (workout.day % 3) * 5 : isRun ? 50 : 55 + (workout.day % 4) * 3;
    const startedAt = zonedInstant(dayNumber, timeZone, morning, 30);
    const finishedAt = new Date(startedAt.getTime() + minutes * 60_000);

    const session: DemoSession = {
      programId,
      workoutDate: zonedInstant(dayNumber, timeZone),
      workoutTitle: workout.title,
      programType: programTypeOf(workout),
      startedAt,
      finishedAt,
      duration: `${minutes} mins`,
      notes: NOTES[workout.day % NOTES.length],
      rpe: isLong ? 6 : isRun ? 8 : 7,
      startedInApp: true,
      skipped: false,
      sessionIndex: 0,
      sessionCount: 1,
      workoutDetails: workout,
    };
    const emomBlock = workout.exercises?.find(exercise => /^EMOM \d+/.test(exercise.name));
    if (emomBlock) {
      session.timerRecord = {
        timerMode: 'emom',
        totalTime: Number(emomBlock.name.replace(/\D/g, '')) * 60,
        completedAt: finishedAt.toISOString(),
      };
    }
    sessions.push(session);
  }
  return sessions;
}

// ─── Coach ───────────────────────────────────────────────────────────────────

/** A short, friendly exchange that shows what the coach does. */
export function buildDemoConversation(firstName: string, raceDate: Date, now: Date): StoredCoachMessage[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const race = raceDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return [
    {
      role: 'user',
      content: 'Last EMOM felt brutal at the end, but I held 12 wall balls every round. Is that a good sign?',
      createdAt: at(26),
    },
    {
      role: 'assistant',
      content:
        `That's a great sign, ${firstName}. Holding 12 every round means your engine is well ahead of where it was in the base phase, ` +
        `when the last few rounds dropped to 9 or 10.\n\n` +
        `For the rest of this week:\n` +
        `- **Keep that pacing.** Start each wall ball minute at about 80% effort.\n` +
        `- **Saturday's long run** stays conversational. Pick up the last 2 km only if your legs feel good.\n` +
        `- **Your training load is in the optimal zone**, so we stay on plan.\n\n` +
        `You're on track for race day on ${race}.`,
      createdAt: at(25.9),
      consulted: ['training history', 'training load', 'upcoming plan'],
    },
    {
      role: 'user',
      content: "Heads up: I'm away for work Tuesday and Wednesday next week, hotel gym only.",
      createdAt: at(2),
    },
    {
      role: 'assistant',
      content:
        `Thanks for the heads-up, I've noted it. Here's how we'll handle those two days:\n\n` +
        `- **Tuesday:** treadmill intervals instead of the track. 6 × 3 min at 10K effort with 90 s easy.\n` +
        `- **Wednesday:** a hotel-gym circuit. 4 rounds of 20 dumbbell lunges, 15 push-ups, 20 sit-ups and 400 m on the treadmill.\n\n` +
        `Everything else stays as planned, including Saturday's long run. Enjoy the trip.`,
      createdAt: at(1.95),
      consulted: ['upcoming plan', 'plan adjustment draft'],
    },
  ];
}

export interface DemoCoachNote {
  category: CoachNoteCategory;
  content: string;
  /** Days from now; null for notes that don't expire. */
  expiresInDays: number | null;
}

export function buildDemoNotes(firstName: string, raceDate: Date): DemoCoachNote[] {
  const race = raceDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return [
    { category: 'goal', content: `${firstName} is racing a hybrid event on ${race}, aiming to finish under 75 minutes.`, expiresInDays: null },
    { category: 'preference', content: 'Prefers to train before work, around 6:30am, with long runs on Saturday mornings.', expiresInDays: null },
    { category: 'availability', content: 'Away for work next Tuesday and Wednesday, hotel gym only.', expiresInDays: 10 },
  ];
}
