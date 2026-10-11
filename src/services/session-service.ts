// src/services/session-service.ts
'use server';

import { Timestamp } from 'firebase-admin/firestore';
import { addDays } from 'date-fns';
import { getAdminDb } from '@/lib/firebase-admin';
import { assertUser } from '@/lib/api-auth';
import type { WorkoutSession, WorkoutDay, ProgramType } from '@/models/types';
import { z } from 'zod';
import { AD_HOC_PROGRAM_IDS } from '@/lib/schedule-move';
import { planScheduleWrites, type DayToSave, type ExistingSessionDoc } from '@/lib/schedule-save';

/** Firestore caps a write batch at 500 operations; leave headroom. */
const DELETE_BATCH_SIZE = 450;

/**
 * How far ahead clearFutureProgramSessions looks. The longest program in the
 * catalogue is 84 days, so a year is generous while still bounding the read.
 */
const CLEAR_HORIZON_DAYS = 365;

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


const DayChangeSchema = z.object({
  date: z.date(),
  // The day's sessions, in order. Empty = the day was cleared entirely.
  entries: z.array(z.object({
    workout: z.any(), // Using any because Zod struggles with recursive types in zod-to-json-schema
    // The session doc this came from, when there is one. Only ever matched
    // against docs read below for this user, so a foreign id is just ignored.
    sessionId: z.string().optional(),
  })),
});

const SaveScheduleChangesInputSchema = z.object({
  programId: z.string(),
  days: z.array(DayChangeSchema).refine(
    days => new Set(days.map(day => day.date.getTime())).size === days.length,
    'Each day may appear only once.',
  ),
});

type SaveScheduleChangesInput = z.infer<typeof SaveScheduleChangesInputSchema>;

/**
 * Persists a rearranged schedule (calendar drag-and-drop, "Do this today", "Do it tomorrow"):
 * each day in `days` ends up holding exactly its `entries`, in order. The rules live in
 * lib/schedule-save.ts. In short: a session that came from a doc moves as that doc; finished
 * docs never change day; a day left empty gets a content-less marker so it doesn't fall back
 * to the program's default; ad-hoc (one-off/custom) docs are never read or written.
 *
 * One transaction: a move is one doc leaving a day and arriving on another, so the two halves
 * must land together, and a doc read here that changes before the commit (a session finished
 * meanwhile) makes Firestore rerun the read and plan rather than have it written over.
 */
export async function saveScheduleChanges(input: SaveScheduleChangesInput): Promise<void> {
    const { uid: userId } = await assertUser('sessions:save-schedule');
    const { programId, days } = SaveScheduleChangesInputSchema.parse(input);
    const adminDb = getAdminDb();
    const sessionsCollection = adminDb.collection('workoutSessions');
    const keyOf = (date: Date) => String(date.getTime());
    const dateByKey = new Map(days.map(({ date }) => [keyOf(date), date]));

    await adminDb.runTransaction(async (tx) => {
        const snapshots = await Promise.all(days.map(({ date }) => tx.get(
            sessionsCollection
                .where('userId', '==', userId)
                .where('workoutDate', '==', Timestamp.fromDate(date))
                .where('programId', 'not-in', AD_HOC_PROGRAM_IDS),
        )));

        const refs = new Map<string, FirebaseFirestore.DocumentReference>();
        const existing: ExistingSessionDoc[] = [];
        snapshots.forEach((snap, dayIndex) => snap.docs.forEach(doc => {
            const data = doc.data();
            refs.set(doc.id, doc.ref);
            existing.push({
                id: doc.id,
                dateKey: keyOf(days[dayIndex].date),
                title: data.workoutDetails ? (data.workoutDetails.title ?? data.workoutTitle ?? '') : null,
                finished: !!data.finishedAt,
                sessionIndex: data.sessionIndex ?? 0,
                sessionCount: data.sessionCount,
            });
        }));

        const writes = planScheduleWrites(
            days.map(({ date, entries }) => ({ dateKey: keyOf(date), entries: entries as DayToSave['entries'] })),
            existing,
        );

        for (const write of writes) {
            if (write.type === 'delete') {
                tx.delete(refs.get(write.id)!);
            } else if (write.type === 'keep') {
                tx.update(refs.get(write.id)!, {
                    sessionIndex: write.sessionIndex,
                    sessionCount: write.sessionCount,
                    // Opened on its old day doesn't mean started on its new one: the
                    // workout page records the real start the first time it's opened.
                    ...(write.moved ? {
                        workoutDate: Timestamp.fromDate(dateByKey.get(write.dateKey)!),
                        startedAt: Timestamp.now(),
                        startedInApp: false,
                    } : {}),
                });
            } else if (write.type === 'create') {
                tx.set(sessionsCollection.doc(), {
                    userId,
                    programId,
                    workoutDate: Timestamp.fromDate(dateByKey.get(write.dateKey)!),
                    workoutTitle: write.workout.title,
                    programType: deriveSessionProgramType(write.workout),
                    workoutDetails: write.workout,
                    sessionIndex: write.sessionIndex,
                    sessionCount: write.sessionCount,
                    finishedAt: null,
                    skipped: false,
                    startedAt: Timestamp.now(),
                    notes: '',
                });
            } else {
                const markerData = {
                    userId,
                    programId,
                    workoutDate: Timestamp.fromDate(dateByKey.get(write.dateKey)!),
                    workoutTitle: 'Rest',
                    programType: 'hyrox' as ProgramType,
                    workoutDetails: null,
                    sessionIndex: 0,
                    sessionCount: 0,
                    finishedAt: null,
                    skipped: false,
                };
                if (write.id) {
                    tx.update(refs.get(write.id)!, markerData);
                } else {
                    tx.set(sessionsCollection.doc(), { ...markerData, startedAt: Timestamp.now(), notes: '' });
                }
            }
        }
    });
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
    //
    // Bounded at the far end as well: the open-ended `>=` collected every future
    // doc the account had ever accumulated, across previous programs and
    // drag-and-drop markers, which is how the delete set grew past what one
    // batch can carry. No program here is longer than a year.
    const snapshot = await sessionsCollection
        .where('userId', '==', userId)
        .where('workoutDate', '>=', Timestamp.fromDate(fromDate))
        .where('workoutDate', '<=', Timestamp.fromDate(addDays(fromDate, CLEAR_HORIZON_DAYS)))
        .get();

    const toDelete = snapshot.docs.filter(doc => {
        const data = doc.data();
        if (AD_HOC_PROGRAM_IDS.includes(data.programId)) return false; // logged extra activity, not schedule
        if (data.finishedAt) return false; // preserve completed workout history
        return true;
    });

    // Chunked, because a Firestore batch takes at most 500 writes and a batch is
    // atomic: one oversized commit failed with INVALID_ARGUMENT and deleted
    // NOTHING. Both callers swallowed that throw, so the athlete silently kept a
    // full set of stale docs shadowing their new program — the "freshly
    // scheduled program has no workouts" report this function exists to prevent.
    for (let i = 0; i < toDelete.length; i += DELETE_BATCH_SIZE) {
        const batch = adminDb.batch();
        for (const doc of toDelete.slice(i, i + DELETE_BATCH_SIZE)) {
            batch.delete(doc.ref);
        }
        await batch.commit();
    }
}
