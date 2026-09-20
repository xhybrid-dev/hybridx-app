// src/lib/workout-utils.ts
import type { Program, WorkoutDay, PlannedRun } from '@/models/types';
import { programDayFor } from '@/lib/program-day';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';

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

/**
 * Finds the last time a user performed a specific exercise.
 * @param userId The ID of the user.
 * @param exerciseName The name of the exercise to search for.
 * @returns A promise resolving to a string description of the last performance, or null if never performed.
 */
export async function getLastPerformedExercise(userId: string, exerciseName: string): Promise<string | null> {
    try {
        const sessionsRef = collection(db, 'workoutSessions');
        
        // We need to query sessions and then filter client-side or use a complex index
        // Since exercise details are nested in arrays, standard Firestore queries are limited without array-contains-any on objects
        // A more scalable approach would be to have a separate 'exerciseLogs' collection
        // For now, we'll query recent sessions and search within them
        
        const q = query(
            sessionsRef,
            where('userId', '==', userId),
            where('finishedAt', '!=', null),
            orderBy('finishedAt', 'desc'),
            limit(20) // Limit to last 20 workouts for performance
        );

        const snapshot = await getDocs(q);
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const exercises = [
                ...(data.workoutDetails?.exercises || []),
                ...(data.extendedExercises || [])
            ];
            
            // runs are already covered by workoutDetails.exercises check above for unified WorkoutDay type

            const found = exercises.find((e: any) => e.name === exerciseName);
            
            if (found) {
                // If details contains something like "4x8 @ 60kg", we can try to extract it
                // Or simply return the details from the previous session plan
                // The 'details' field in the workout object is the prescription, not the log.
                // However, without a dedicated log per exercise (feature request: actual weight logging),
                // the best we can do is show what was prescribed last time OR the session notes.
                
                // If the user noted specific weights in the session notes, we might find them there
                // But generally, the requirement implies showing the previous *prescription* or *logged weight*.
                // Since we don't have per-exercise weight logging yet, we will return the DATE and the PRESCRIPTION.
                
                const dateStr = data.finishedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                return `${dateStr}: ${found.details}`;
            }
        }
        
        return null;
    } catch (error) {
        console.error("Error finding last exercise:", error);
        return null;
    }
}
