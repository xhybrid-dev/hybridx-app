// src/services/program-service-client.ts
// This file contains functions for client-side components. NO 'use server' here.
//
// Programs live in two collections:
//   programs        — public, readable by every signed-in athlete
//   customPrograms  — user-specific, readable only by assigned athletes
// They share an id space, so a program keeps its id if an admin moves it
// between the two. Anything that resolves a program by id has to check both.
import { collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Program } from '@/models/types';

const programsCollectionClient = collection(db, 'programs');
const customProgramsCollectionClient = collection(db, 'customPrograms');

/**
 * Ceiling on getAllPrograms(). The live catalogue is ~20 programs (14 per
 * PROGRAM_COACHING_REVIEW.md, plus the ATHX 2027 batch), so this is invisible
 * today — it exists as a bound, not a page size.
 *
 * This is a safety net, not the fix for the underlying cost: every Program
 * document embeds its full `workouts` array (up to 84 days of exercises each),
 * and getAllPrograms()/the /programs athlete-facing browse page render only
 * name/description/type/count from it. Firestore has no field projection, so
 * there is no way to fetch just those four fields without either (a) capping
 * how many full documents get pulled — what this does — or (b) denormalising a
 * summary alongside each program, which needs a schema decision and a backfill
 * of existing documents and is a separate, larger change.
 *
 * True cursor pagination was the other option and was deliberately not built:
 * the browse page splits programs into tabs by programType client-side ('hyrox'
 * tab shows hyrox+hybrid, 'running' shows running), and a paginated query that
 * tabs can rely on needs a per-tab `where('programType','in',[...])` filter,
 * which very likely needs a new Firestore composite index — another manual
 * `firebase deploy` step, and real UI work for a "load more" affordance. Not
 * worth it at ~20 documents.
 */
const ALL_PROGRAMS_LIMIT = 200;

export async function getProgramClient(programId: string): Promise<Program | null> {
    // 1. Try the public programs collection.
    const docRef = doc(db, 'programs', programId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Program;
    }

    // 2. Fall back to custom programs. The Firestore rule returns this document
    //    only if the athlete is assigned to it, or is grandfathered in because
    //    it is still their active plan; a permission error here just means "not
    //    theirs", so it resolves to null like any other miss.
    try {
        const customSnap = await getDoc(doc(db, 'customPrograms', programId));
        if (customSnap.exists()) {
            return { id: customSnap.id, ...customSnap.data() } as Program;
        }
    } catch {
        return null;
    }

    // 3. Personal (AI-generated) programs live under users/{uid}/personalPrograms
    //    and need the athlete's id — callers use getPersonalProgram for those.
    return null;
}

export async function getPersonalProgram(userId: string, programId: string): Promise<Program | null> {
    const docRef = doc(db, `users/${userId}/personalPrograms`, programId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Program;
    }
    return null;
}

/** All public programs, bounded — see {@link ALL_PROGRAMS_LIMIT}. */
export async function getAllPrograms(): Promise<Program[]> {
    const snapshot = await getDocs(query(programsCollectionClient, limit(ALL_PROGRAMS_LIMIT)));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Program));
}

/**
 * Every custom program in the system. Admin-only — the Firestore rule allows an
 * unfiltered listing of customPrograms for admins alone.
 */
export async function getAllCustomPrograms(): Promise<Program[]> {
    const snapshot = await getDocs(query(customProgramsCollectionClient, limit(ALL_PROGRAMS_LIMIT)));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Program));
}

/**
 * The custom programs assigned to this athlete.
 *
 * The array-contains filter is what makes this legal: every document it returns
 * already satisfies the read rule, whereas an unfiltered listing would be
 * rejected outright.
 */
export async function getAssignedPrograms(userId: string): Promise<Program[]> {
    const snapshot = await getDocs(
        query(customProgramsCollectionClient, where('assignedUserIds', 'array-contains', userId)),
    );
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Program));
}

export async function getPersonalPrograms(userId: string): Promise<Program[]> {
    const personalCollection = collection(db, `users/${userId}/personalPrograms`);
    const snapshot = await getDocs(personalCollection);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Program));
}

export type ProgramCollection = 'programs' | 'customPrograms';

/** Locate a program by id across both collections, reporting which one holds
 *  it so callers know where to write updates. Admin-facing. */
export async function findProgram(
    programId: string,
): Promise<{ program: Program; collection: ProgramCollection } | null> {
    const publicSnap = await getDoc(doc(db, 'programs', programId));
    if (publicSnap.exists()) {
        return { program: { id: publicSnap.id, ...publicSnap.data() } as Program, collection: 'programs' };
    }
    const customSnap = await getDoc(doc(db, 'customPrograms', programId));
    if (customSnap.exists()) {
        return { program: { id: customSnap.id, ...customSnap.data() } as Program, collection: 'customPrograms' };
    }
    return null;
}

export async function createProgram(data: Omit<Program, 'id'>): Promise<string> {
    const docRef = await addDoc(programsCollectionClient, data);
    return docRef.id;
}

/** Create a program only the given athletes can see. Admin-only by rule. */
export async function createCustomProgram(
    data: Omit<Program, 'id'>,
    assignedUserIds: string[],
): Promise<string> {
    const docRef = await addDoc(customProgramsCollectionClient, {
        ...data,
        visibility: 'custom',
        assignedUserIds,
        retainedUserIds: [],
    });
    return docRef.id;
}

export async function savePersonalProgram(userId: string, data: Omit<Program, 'id'>): Promise<string> {
    const personalCollection = collection(db, `users/${userId}/personalPrograms`);
    const docRef = await addDoc(personalCollection, data);
    return docRef.id;
}

export async function updateProgram(programId: string, data: Partial<Program>): Promise<void> {
    const docRef = doc(programsCollectionClient, programId);
    await updateDoc(docRef, data);
}

export async function updateCustomProgram(programId: string, data: Partial<Program>): Promise<void> {
    const docRef = doc(customProgramsCollectionClient, programId);
    await updateDoc(docRef, data);
}

export async function deleteProgram(programId: string): Promise<void> {
    const docRef = doc(programsCollectionClient, programId);
    await deleteDoc(docRef);
}

export async function deleteCustomProgram(programId: string): Promise<void> {
    const docRef = doc(customProgramsCollectionClient, programId);
    await deleteDoc(docRef);
}

export async function deletePersonalProgram(userId: string, programId: string): Promise<void> {
    const docRef = doc(db, `users/${userId}/personalPrograms`, programId);
    await deleteDoc(docRef);
}
