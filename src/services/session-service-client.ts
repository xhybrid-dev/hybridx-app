// src/services/session-service-client.ts
import { logger } from '@/lib/logger';
// This file contains functions for client-side components. NO 'use server' here.

import { collection, doc, getDocs, addDoc, updateDoc, query, where, Timestamp, limit, orderBy, getDoc, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { db, getAuthInstance } from '@/lib/firebase';
import type { WorkoutSession, WorkoutDay, Exercise, ProgramType, PlannedRun } from '@/models/types';
import type { StravaActivity } from './strava-service';

// Re-export WorkoutSession type for convenience
export type { WorkoutSession };

// Pagination result type
export interface PaginatedSessions {
    sessions: WorkoutSession[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
    hasMore: boolean;
}

function fromFirestore(doc: any): WorkoutSession {
    const data = doc.data();
    return {
        id: doc.id,
        userId: data.userId,
        programId: data.programId,
        workoutDate: data.workoutDate.toDate(),
        workoutTitle: data.workoutTitle || 'Workout',
        programType: data.programType || 'hyrox',
        startedAt: data.startedAt.toDate(),
        finishedAt: data.finishedAt ? data.finishedAt.toDate() : undefined,
        notes: data.notes || '',
        duration: data.duration,
        extendedExercises: data.extendedExercises || [],
        skipped: data.skipped || false,
        skipReason: data.skipReason,
        rpe: data.rpe,
        startedInApp: data.startedInApp,
        exerciseChecklist: data.exerciseChecklist || {},
        workoutDetails: data.workoutDetails,
        timerRecord: data.timerRecord,
        stravaId: data.stravaId,
        uploadedToStrava: data.uploadedToStrava,
        stravaUploadedAt: data.stravaUploadedAt ? data.stravaUploadedAt.toDate() : undefined,
        stravaActivity: data.stravaActivity,
        sessionIndex: data.sessionIndex,
        sessionCount: data.sessionCount,
    };
}

const sessionsCollection = collection(db, 'workoutSessions');

/**
 * Default ceiling for the "recent sessions" read.
 *
 * Every document here embeds its whole workoutDetails object — the full exercise
 * list, extendedExercises, timerRecord, stravaActivity — so an unbounded read of
 * an athlete two years in is several MB and hundreds of read units, on every app
 * open, on every device. 400 covers well over a year of daily training, which is
 * more than the streak calculator, the four-week progress chart or the history
 * list ever look at.
 */
export const RECENT_SESSIONS_LIMIT = 400;

/**
 * The athlete's most recent sessions, newest first.
 *
 * Prefer this over an unbounded read. If you need a specific window (a calendar
 * month, a coaching range), query by date instead — the userId + workoutDate
 * composite indexes in firestore.indexes.json serve both directions.
 */
export async function getRecentUserSessions(
    userId: string,
    max: number = RECENT_SESSIONS_LIMIT,
): Promise<WorkoutSession[]> {
    const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        orderBy('workoutDate', 'desc'),
        limit(max),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(fromFirestore);
}

/**
 * The athlete's sessions whose workoutDate falls in [from, to], inclusive.
 *
 * Preferred over {@link getRecentUserSessions} whenever the caller knows the
 * window it will actually read — the calendar's schedule view walks exactly one
 * date range, so anything outside it was transferred and discarded. Served by
 * the userId + workoutDate composite index in firestore.indexes.json.
 */
export async function getUserSessionsInRange(
    userId: string,
    from: Date,
    to: Date,
): Promise<WorkoutSession[]> {
    const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        where('workoutDate', '>=', Timestamp.fromDate(from)),
        where('workoutDate', '<=', Timestamp.fromDate(to)),
        orderBy('workoutDate', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(fromFirestore);
}

/**
 * Fetch user sessions with pagination
 * @param userId - The user ID
 * @param pageSize - Number of sessions per page (default: 20)
 * @param lastDoc - Last document from previous page for pagination
 * @returns Paginated sessions with cursor for next page
 */
export async function getPaginatedUserSessions(
    userId: string,
    pageSize: number = 20,
    lastDoc?: QueryDocumentSnapshot<DocumentData> | null
): Promise<PaginatedSessions> {
    let q = query(
        sessionsCollection,
        where('userId', '==', userId),
        orderBy('workoutDate', 'desc'),
        limit(pageSize + 1)
    );

    if (lastDoc) {
        q = query(
            sessionsCollection,
            where('userId', '==', userId),
            orderBy('workoutDate', 'desc'),
            startAfter(lastDoc),
            limit(pageSize + 1)
        );
    }

    const snapshot = await getDocs(q);
    const docs = snapshot.docs;
    const hasMore = docs.length > pageSize;
    const sessions = docs.slice(0, pageSize).map(fromFirestore);
    const newLastDoc = sessions.length > 0 ? docs[pageSize - 1] : null;

    return {
        sessions,
        lastDoc: hasMore ? newLastDoc : null,
        hasMore
    };
}

export async function getTodaysOneOffSession(userId: string, workoutDate: Date): Promise<WorkoutSession | null> {
     const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        where('programId', 'in', ['one-off-ai', 'custom-workout']),
        where('workoutDate', '==', Timestamp.fromDate(workoutDate)),
        limit(1)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        return fromFirestore(snapshot.docs[0]);
    }
    return null;
}

export async function getTodaysProgramSession(userId: string, workoutDate: Date): Promise<WorkoutSession | null> {
    const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        where('workoutDate', '==', Timestamp.fromDate(workoutDate)),
        where('programId', 'not-in', ['one-off-ai', 'custom-workout']),
        limit(1)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        return fromFirestore(snapshot.docs[0]);
    }
    return null;
}

/**
 * Ensures one WorkoutSession doc exists per sub-workout scheduled for a day, so e.g. a Run and a
 * Weight Training session on the same day can be started/finished/linked to Strava independently.
 *
 * If ANY session doc already exists for the date, it is treated as fully authoritative and returned
 * as-is (filtered to slots that still have workoutDetails) — this is what lets a day be dragged empty
 * via the training-calendar rearranger: the persisted (possibly content-less) doc for that date wins
 * over the program's default schedule rather than partially falling back to it. Only when NO doc
 * exists yet for the date do we seed one per entry in `daySessions` from the program's default.
 */
export async function getOrCreateProgramSessionsForDay(
    userId: string,
    programId: string,
    workoutDate: Date,
    daySessions: WorkoutDay[]
): Promise<WorkoutSession[]> {
    const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        where('workoutDate', '==', Timestamp.fromDate(workoutDate)),
        where('programId', 'not-in', ['one-off-ai', 'custom-workout']),
    );
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        return snapshot.docs
            .map(fromFirestore)
            .filter(s => !!s.workoutDetails)
            .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0));
    }

    const results: WorkoutSession[] = [];
    for (let i = 0; i < daySessions.length; i++) {
        const workout = daySessions[i];
        const newSessionData = {
            userId,
            programId,
            workoutDate: Timestamp.fromDate(workoutDate),
            workoutTitle: workout.title,
            programType: deriveSessionProgramType(workout),
            startedAt: Timestamp.now(),
            finishedAt: null,
            notes: '',
            workoutDetails: workout,
            skipped: false,
            sessionIndex: i,
            sessionCount: daySessions.length,
        };
        const docRef = await addDoc(sessionsCollection, newSessionData);
        results.push({
            id: docRef.id,
            userId,
            programId,
            workoutDate,
            workoutTitle: workout.title,
            programType: newSessionData.programType,
            startedAt: new Date(),
            notes: '',
            workoutDetails: workout,
            skipped: false,
            sessionIndex: i,
            sessionCount: daySessions.length,
        });
    }
    return results;
}

export interface ManualWorkoutInput {
    /** Day the workout happened (normalized to local midnight before saving). */
    date: Date;
    title: string;
    type: 'running' | 'hyrox';
    /** Free-text duration, e.g. "45" (minutes) — matches WorkoutSession.duration's existing format. */
    duration?: string;
    notes?: string;
    /** Required (and used) when type === 'running'. */
    run?: PlannedRun;
    /** Required (and used) when type === 'hyrox'. */
    exercises?: Exercise[];
}

/**
 * Logs a workout the user did outside their training plan — e.g. an extra
 * run or gym session on a day that already has (or doesn't have) a
 * program-scheduled workout. Unlike getOrCreateWorkoutSession, this always
 * creates a NEW session document rather than finding-and-overwriting one for
 * the day, so it never clobbers an existing session; sibling sessions'
 * sessionCount is kept in sync so "Session X of Y" badges stay correct.
 * The session is saved already completed (finishedAt set) since it records
 * something the user already did.
 */
export async function logManualWorkoutSession(userId: string, input: ManualWorkoutInput): Promise<WorkoutSession> {
    const dayStart = new Date(input.date);
    dayStart.setHours(0, 0, 0, 0);

    const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        where('workoutDate', '==', Timestamp.fromDate(dayStart)),
    );
    const snapshot = await getDocs(q);
    const sessionIndex = snapshot.size;
    const sessionCount = snapshot.size + 1;

    const workoutDetails: WorkoutDay = input.type === 'running'
        ? { day: 0, title: input.title, runs: input.run ? [input.run] : [], programType: 'running', exercises: [] }
        : { day: 0, title: input.title, exercises: input.exercises || [], programType: 'hyrox' };

    const completedAt = new Date(dayStart);
    completedAt.setHours(12, 0, 0, 0);

    const newSessionData = {
        userId,
        programId: 'manual-log',
        workoutDate: Timestamp.fromDate(dayStart),
        workoutTitle: input.title,
        programType: input.type as ProgramType,
        startedAt: Timestamp.fromDate(completedAt),
        finishedAt: Timestamp.fromDate(completedAt),
        notes: input.notes || '',
        duration: input.duration || null,
        extendedExercises: [],
        workoutDetails,
        skipped: false,
        sessionIndex,
        sessionCount,
    };

    const docRef = await addDoc(sessionsCollection, newSessionData);

    // Keep sibling docs' sessionCount in sync so "Session X of Y" badges
    // (history, calendar, dashboard) stay correct for the whole day.
    if (snapshot.size > 0) {
        await Promise.all(snapshot.docs.map(d => updateDoc(d.ref, { sessionCount })));
    }

    return {
        id: docRef.id,
        userId,
        programId: 'manual-log',
        workoutDate: dayStart,
        workoutTitle: input.title,
        programType: input.type,
        startedAt: completedAt,
        finishedAt: completedAt,
        notes: newSessionData.notes,
        duration: input.duration,
        extendedExercises: [],
        workoutDetails,
        skipped: false,
        sessionIndex,
        sessionCount,
    };
}


function deriveSessionProgramType(workout: WorkoutDay): ProgramType {
    const hasR = ('runs' in workout ? (workout as any).runs?.length ?? 0 : 0) > 0;
    const hasE = (workout.exercises?.length ?? 0) > 0;
    if (hasR && hasE) return 'hybrid';
    if (hasR) return 'running';
    return 'hyrox';
}

/**
 * Finds or creates a single WorkoutSession doc for a date/slot.
 *
 * A day can now have multiple sibling docs (one per sub-workout, e.g. Run + Weight Training), so
 * this only ever targets ONE specific slot: the one-off/custom-workout doc for the day (there's at
 * most one), or — for program workouts — the doc whose `sessionIndex` matches `sessionIndex`
 * (defaults to 0, i.e. the day's first/only session). It never touches sibling sub-workout docs.
 */
export async function getOrCreateWorkoutSession(userId: string, programId: string, workoutDate: Date, workout: WorkoutDay, overwrite: boolean = false, duration?: string, sessionIndex: number = 0, sessionCount: number = 1): Promise<WorkoutSession> {
    const isOneOff = ['one-off-ai', 'custom-workout'].includes(programId);

    const q = query(
        sessionsCollection,
        where('userId', '==', userId),
        where('workoutDate', '==', Timestamp.fromDate(workoutDate)),
    );
    const snapshot = await getDocs(q);

    const existingDoc = isOneOff
        ? snapshot.docs.find(d => ['one-off-ai', 'custom-workout'].includes(d.data().programId))
        : snapshot.docs.find(d => !['one-off-ai', 'custom-workout'].includes(d.data().programId) && ((d.data().sessionIndex ?? 0) === sessionIndex));

    if (existingDoc && !overwrite) {
        return fromFirestore(existingDoc);
    }

    if (existingDoc) {
        logger.log(`Overwriting existing workout session for date: ${workoutDate.toISOString()}`);
    }

    const newSessionData = {
        userId,
        programId,
        workoutDate: Timestamp.fromDate(workoutDate),
        workoutTitle: workout.title,
        programType: deriveSessionProgramType(workout),
        startedAt: Timestamp.now(),
        finishedAt: null,
        notes: '',
        duration: duration || null,
        extendedExercises: isOneOff ? workout.exercises : [],
        workoutDetails: workout,
        skipped: false,
        sessionIndex,
        sessionCount,
    };

    if (existingDoc) {
        await updateDoc(existingDoc.ref, newSessionData);
        const updatedDocData = { ...existingDoc.data(), ...newSessionData };
        return fromFirestore({ id: existingDoc.id, data: () => updatedDocData });
    }

    const docRef = await addDoc(sessionsCollection, newSessionData);

    return {
        id: docRef.id,
        userId,
        programId,
        workoutDate,
        workoutTitle: workout.title,
        programType: deriveSessionProgramType(workout),
        startedAt: new Date(),
        notes: '',
        duration: newSessionData.duration ?? undefined,
        extendedExercises: newSessionData.extendedExercises,
        workoutDetails: newSessionData.workoutDetails,
        skipped: false,
        sessionIndex,
        sessionCount,
    };
}


export async function updateWorkoutSession(sessionId: string, data: Partial<Omit<WorkoutSession, 'id'>>): Promise<void> {
    const docRef = doc(sessionsCollection, sessionId);
    const dataToUpdate: { [key: string]: any } = { ...data };

    if (data.finishedAt) {
        dataToUpdate.finishedAt = Timestamp.fromDate(data.finishedAt);
    }

    await updateDoc(docRef, dataToUpdate);
}

/**
 * Links a Strava activity to a workout session, marking it as complete.
 * If a session for that day doesn't exist, it creates one.
 */
export async function linkStravaActivityToSession(sessionId: string, activity: StravaActivity): Promise<void> {
    const auth = await getAuthInstance();
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("User not authenticated.");

    let sessionRef;
    let existingNotes = '';

    if (sessionId) {
        sessionRef = doc(sessionsCollection, sessionId);
        const snap = await getDoc(sessionRef);
        if (!snap.exists()) throw new Error("Session not found.");
        existingNotes = snap.data().notes || '';
    } else {
        const activityDate = new Date(activity.start_date_local || activity.start_date);
        activityDate.setHours(0, 0, 0, 0);

        const q = query(
            sessionsCollection,
            where('userId', '==', userId),
            where('workoutDate', '==', Timestamp.fromDate(activityDate)),
            limit(1),
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            sessionRef = snapshot.docs[0].ref;
            existingNotes = snapshot.docs[0].data().notes || '';
        } else {
            const activityDate2 = new Date(activity.start_date_local || activity.start_date);
            activityDate2.setHours(0, 0, 0, 0);
            const newSessionData = {
                userId,
                programId: 'strava-linked',
                workoutDate: Timestamp.fromDate(activityDate2),
                workoutTitle: activity.name,
                programType: (activity.sport_type.toLowerCase().includes('run') ? 'running' : 'hyrox') as ProgramType,
                startedAt: Timestamp.fromDate(new Date(activity.start_date)),
            };
            const docRef = await addDoc(sessionsCollection, newSessionData);
            sessionRef = docRef;
        }
    }

    const updateData = {
        finishedAt: Timestamp.fromDate(new Date(activity.start_date)),
        stravaId: activity.id.toString(),
        uploadedToStrava: false,
        stravaUploadedAt: Timestamp.now(),
        notes: existingNotes
            ? `${existingNotes}\n\nLinked Strava activity: ${activity.name}.`
            : `Linked Strava activity: ${activity.name}.`,
        stravaActivity: {
            distance: activity.distance,
            moving_time: activity.moving_time,
            name: activity.name,
        },
        ...(sessionId ? {} : { workoutTitle: activity.name }),
        skipped: false,
    };
    await updateDoc(sessionRef, updateData);
}
