// src/lib/workout-utils.ts
import type { Program, WorkoutDay, PlannedRun } from '@/models/types';
import { programDayFor } from '@/lib/program-day';

/**
 * A pure utility function to determine the correct workout for a given day based on a program's start date.
 * This function is safe to use on both the client and server.
 * @param program The training program object, which might contain a user's custom workout schedule.
 * @param startDate The start date of the program for the user.
 * @param targetDate The date for which to find the workout.
 * @returns An object containing the day number of the program and the workout object, or null if no workout is scheduled.
 */
/**
 * Formats a PlannedRun into a human-readable label that includes interval count and effort.
 * e.g. "2×15 min at threshold effort (RPE 7)" or "15 min easy warm-up (RPE 3)"
 */
export function formatPlannedRun(run: PlannedRun): string {
  const prefix = run.noIntervals && run.noIntervals > 1 ? `${run.noIntervals}×` : '';
  const rpe = ` (RPE ${run.effortLevel})`;
  return `${prefix}${run.description}${rpe}`;
}

export function getWorkoutForDay(
    program: Pick<Program, 'workouts'>,
    startDate: Date,
    targetDate: Date,
    /**
     * The athlete's IANA timezone. Server callers must pass it: `startDate` is
     * stored as the instant they picked the program, and only their own zone
     * says which calendar day that was. Browser callers can leave it out — the
     * runtime is already in the athlete's zone.
     */
    timeZone?: string,
): { day: number; workout: WorkoutDay | null; sessions: WorkoutDay[] } {
    const dayOfProgram = programDayFor(startDate, targetDate, timeZone);

    if (dayOfProgram < 1) {
        return { day: dayOfProgram, workout: null, sessions: [] };
    }

    const workouts = program.workouts;
    const cycleLength = Math.max(...workouts.map(w => w.day), 0);

    if (cycleLength === 0) {
        return { day: dayOfProgram, workout: null, sessions: [] };
    }

    if (dayOfProgram > cycleLength) {
        return { day: dayOfProgram, workout: null, sessions: [] };
    }

    const sessions = workouts.filter(w => w.day === dayOfProgram);
    const workoutForDay = sessions[0] ?? null;

    return { day: dayOfProgram, workout: workoutForDay, sessions };
}

