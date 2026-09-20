// src/services/session-service.ts
'use server';

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { assertUser } from '@/lib/api-auth';
import type { WorkoutSession, WorkoutDay, ProgramType } from '@/models/types';
import { z } from 'zod';

// Every function exported from this module is a public HTTP endpoint: it is a
// `'use server'` file imported by client components, so Next.js registers each
// export as a Server Action and ships its id in the browser bundle. All of them
// write to workoutSessions with the Admin SDK, which bypasses firestore.rules.
//
// So none of them may take a `userId` argument. They resolve the caller from
// the session cookie via assertUser() and operate on that uid only — otherwise
// a single unauthenticated POST rewrites or deletes a named athlete's schedule.

function fromFirestore(doc: any): WorkoutSession {
    const data = doc.data();
    return {
        id: doc.id,
        userId: data.userId,
        programId: data.programId,
        workoutDate: data.workoutDate.toDate(),
        workoutTitle: data.workoutTitle,
        programType: data.programType,
        startedAt: data.startedAt.toDate(),
        finishedAt: data.finishedAt ? data.finishedAt.toDate() : undefined,
        notes: data.notes || '',
        extendedExercises: data.extendedExercises,
        skipped: data.skipped,
        workoutDetails: data.workoutDetails,
        stravaId: data.stravaId,
        uploadedToStrava: data.uploadedToStrava,
        stravaUploadedAt: data.stravaUploadedAt,
        stravaActivity: data.stravaActivity,
    };
}

// SERVER-SIDE function using Admin SDK
function deriveSessionProgramType(workout: WorkoutDay): ProgramType {
    const hasR = ('runs' in workout ? (workout as any).runs?.length ?? 0 : 0) > 0;
    const hasE = (workout.exercises?.length ?? 0) > 0;
    if (hasR && hasE) return 'hybrid';
    if (hasR) return 'running';
    return 'hyrox';
}

export async function getOrCreateWorkoutSessionAdmin(programId: string, workoutDate: Date, workout: WorkoutDay): Promise<WorkoutSession> {
    const { uid: userId } = await assertUser('sessions:get-or-create');
    const adminDb = getAdminDb();
    const sessionsCollectionAdmin = adminDb.collection('workoutSessions');
    const q = sessionsCollectionAdmin
        .where('userId', '==', userId)
        .where('workoutDate', '==', Timestamp.fromDate(workoutDate))
        .limit(1);

    const snapshot = await q.get();

    if (!snapshot.empty) {
        return fromFirestore(snapshot.docs[0]);
    }

    const newSessionData = {
        userId,
        programId,
        workoutDate: Timestamp.fromDate(workoutDate),
        startedAt: Timestamp.now(),
        finishedAt: null,
        notes: '',
        workoutTitle: workout.title,
        programType: deriveSessionProgramType(workout),
        workoutDetails: workout, // Store the full workout details
    };

    const docRef = await sessionsCollectionAdmin.add(newSessionData);

    return {
        id: docRef.id,
        userId,
        programId,
        workoutDate,
        workoutTitle: workout.title,
        programType: deriveSessionProgramType(workout),
        startedAt: new Date(),
        notes: '',
        workoutDetails: workout,
    };
}


const SwapWorkoutsInputSchema = z.object({
  programId: z.string(),
  date1: z.date(),
  workout1: z.any(), // Using any because Zod struggles with recursive types in zod-to-json-schema
  date2: z.date(),
  workout2: z.any().nullable(),
});

type SwapWorkoutsInput = z.infer<typeof SwapWorkoutsInputSchema>;

export async function swapWorkouts(input: SwapWorkoutsInput): Promise<void> {
    const { uid: userId } = await assertUser('sessions:swap');
    const adminDb = getAdminDb();
    const sessionsCollection = adminDb.collection('workoutSessions');

    const { programId, date1, workout1, date2, workout2 } = SwapWorkoutsInputSchema.parse(input);
  
    const batch = adminDb.batch();
  
    // Update or create session for date1 (today) with workout1 (from source day)
    const session1Query = await sessionsCollection
      .where('userId', '==', userId)
      .where('workoutDate', '==', Timestamp.fromDate(date1))
      .limit(1)
      .get();
      
    if (session1Query.empty) {
      const newSession1Ref = sessionsCollection.doc();
      batch.set(newSession1Ref, createSessionData(userId, programId, date1, workout1));
    } else {
      batch.update(session1Query.docs[0].ref, createSessionData(userId, programId, date1, workout1, false));
    }
  
    // Update or create session for date2 (source day) with workout2 (from today)
    const session2Query = await sessionsCollection
      .where('userId', '==', userId)
      .where('workoutDate', '==', Timestamp.fromDate(date2))
      .limit(1)
      .get();
  
    if (session2Query.empty) {
      if (workout2) { // Only create a session if there was a workout
        const newSession2Ref = sessionsCollection.doc();
        batch.set(newSession2Ref, createSessionData(userId, programId, date2, workout2));
      }
    } else {
      if (workout2) {
        batch.update(session2Query.docs[0].ref, createSessionData(userId, programId, date2, workout2, false));
      } else {
        // If there was no workout for today, we can delete the source day's placeholder session
        batch.delete(session2Query.docs[0].ref);
      }
    }
  
    await batch.commit();
}
  
  // Helper to create session data for batch operations
function createSessionData(userId: string, programId: string, date: Date, workout: WorkoutDay, isNew: boolean = true) {
    const data: any = {
      userId,
      programId,
      workoutDate: Timestamp.fromDate(date),
      workoutTitle: workout.title,
      programType: deriveSessionProgramType(workout),
      finishedAt: null,
      notes: '',
      workoutDetails: workout, // <-- CRITICAL FIX: Ensure full workout object is saved
      skipped: false,
    };

    if (isNew) {
        data.startedAt = Timestamp.now();
    }

    return data;
}

const DayChangeSchema = z.object({
  date: z.date(),
  // Final list of sub-workouts for the day, in order. Empty = the day was cleared entirely.
  workouts: z.array(z.any()),
});

const SaveScheduleChangesInputSchema = z.object({
  programId: z.string(),
  days: z.array(DayChangeSchema),
});

type SaveScheduleChangesInput = z.infer<typeof SaveScheduleChangesInputSchema>;

/**
 * Persists a training-calendar drag-and-drop rearrangement: for each changed date, writes that day's
 * final set of sub-workouts. A date whose workouts array is empty is written as an explicit "cleared"
 * marker doc (sessionCount 0, no workoutDetails) rather than having its session docs deleted outright —
 * deleting them would make the date fall back to the program's original schedule on the next read,
 * silently undoing the drag. Dates that already have a finished session are skipped as a safety net;
 * the calling UI should never include those since only future/incomplete days can be rearranged.
 */
export async function saveScheduleChanges(input: SaveScheduleChangesInput): Promise<void> {
    const { uid: userId } = await assertUser('sessions:save-schedule');
    const { programId, days } = SaveScheduleChangesInputSchema.parse(input);
    const adminDb = getAdminDb();
    const sessionsCollection = adminDb.collection('workoutSessions');
    const batch = adminDb.batch();

    for (const { date, workouts } of days) {
        const dateTimestamp = Timestamp.fromDate(date);
        const existingSnap = await sessionsCollection
            .where('userId', '==', userId)
            .where('workoutDate', '==', dateTimestamp)
            .where('programId', 'not-in', ['one-off-ai', 'custom-workout'])
            .get();

        if (existingSnap.docs.some(d => !!d.data().finishedAt)) continue;

        const existingBySessionIndex = new Map<number, FirebaseFirestore.QueryDocumentSnapshot>();
        existingSnap.docs.forEach(doc => {
            const idx = doc.data().sessionIndex ?? 0;
            if (!existingBySessionIndex.has(idx)) existingBySessionIndex.set(idx, doc);
        });

        if (workouts.length === 0) {
            const markerDoc = existingBySessionIndex.get(0);
            existingBySessionIndex.delete(0);
            const markerData = {
                userId,
                programId,
                workoutDate: dateTimestamp,
                workoutTitle: 'Rest',
                programType: 'hyrox' as ProgramType,
                workoutDetails: null,
                sessionIndex: 0,
                sessionCount: 0,
                finishedAt: null,
                skipped: false,
            };
            if (markerDoc) {
                batch.update(markerDoc.ref, markerData);
            } else {
                batch.set(sessionsCollection.doc(), { ...markerData, startedAt: Timestamp.now(), notes: '' });
            }
        } else {
            for (let i = 0; i < workouts.length; i++) {
                const workout = workouts[i] as WorkoutDay;
                const existingDoc = existingBySessionIndex.get(i);
                existingBySessionIndex.delete(i);

                const data = {
                    userId,
                    programId,
                    workoutDate: dateTimestamp,
                    workoutTitle: workout.title,
                    programType: deriveSessionProgramType(workout),
                    workoutDetails: workout,
                    sessionIndex: i,
                    sessionCount: workouts.length,
                    finishedAt: null,
                    skipped: false,
                };

                if (existingDoc) {
                    batch.update(existingDoc.ref, data);
                } else {
                    batch.set(sessionsCollection.doc(), { ...data, startedAt: Timestamp.now(), notes: '' });
                }
            }
        }

        // Any remaining slots weren't reused above (the day shrank) — remove them.
        existingBySessionIndex.forEach(doc => batch.delete(doc.ref));
    }

    await batch.commit();
}

const ClearFutureProgramSessionsInputSchema = z.object({
  fromDate: z.date(),
});

type ClearFutureProgramSessionsInput = z.infer<typeof ClearFutureProgramSessionsInputSchema>;

/**
 * Deletes persisted per-day program-schedule session docs (today onward) that aren't already
 * finished. Call this whenever a user (re)assigns an active program.
 *
 * Session docs are keyed only by userId + workoutDate, not by programId, and both the calendar
 * (buildDaySlots) and the dashboard (getOrCreateProgramSessionsForDay) treat any persisted doc for
 * a date as fully authoritative over that date — including the content-less "cleared" rest-day
 * markers saveScheduleChanges writes for drag-and-drop rearrangements. Left in place, those docs
 * from a previous program keep shadowing the newly assigned program's schedule on the same dates
 * forever, which is why a freshly (re)scheduled program can appear to have no workouts. One-off/
 * custom-workout entries are logged extra activity, not schedule, so they're left untouched, and
 * finished sessions are always preserved as workout history.
 */
export async function clearFutureProgramSessions(input: ClearFutureProgramSessionsInput): Promise<void> {
    const { uid: userId } = await assertUser('sessions:clear-future');
    const { fromDate } = ClearFutureProgramSessionsInputSchema.parse(input);
    const adminDb = getAdminDb();
    const sessionsCollection = adminDb.collection('workoutSessions');

    // Firestore rejects a query that combines an inequality/range filter on one field
    // (workoutDate >=) with a not-in filter on a different field (programId), so the
    // one-off/custom-workout and finished-session exclusions are applied after the fetch
    // instead of in the query itself.
    const snapshot = await sessionsCollection
        .where('userId', '==', userId)
        .where('workoutDate', '>=', Timestamp.fromDate(fromDate))
        .get();

    const batch = adminDb.batch();
    let deletedCount = 0;
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (['one-off-ai', 'custom-workout'].includes(data.programId)) return; // logged extra activity, not schedule
        if (data.finishedAt) return; // preserve completed workout history
        batch.delete(doc.ref);
        deletedCount++;
    });

    if (deletedCount > 0) {
        await batch.commit();
    }
}
