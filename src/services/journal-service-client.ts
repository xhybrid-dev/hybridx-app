// src/services/journal-service-client.ts
// Client-side Firestore CRUD for journal entries. NO 'use server' here.

import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  startAfter,
  getDoc,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JournalEntry, MoodLevel, JournalTag } from '@/models/types';

export interface PaginatedJournalEntries {
  entries: JournalEntry[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export type CreateJournalEntryData = {
  date: Date;
  content: string;
  mood?: MoodLevel;
  tags?: JournalTag[];
};

export type UpdateJournalEntryData = Partial<{
  date: Date;
  content: string;
  mood: MoodLevel;
  tags: JournalTag[];
  aiInsight: string;
  aiInsightGeneratedAt: Date;
  aiInterpretation: string;
  aiCoachResponse: string;
  aiAnalysisGeneratedAt: Date;
}>;

function fromFirestore(doc: QueryDocumentSnapshot<DocumentData>): JournalEntry {
  const data = doc.data();
  return {
    id: doc.id,
    userId: data.userId,
    date: data.date instanceof Timestamp ? data.date.toDate() : new Date(data.date),
    content: data.content || '',
    mood: data.mood,
    tags: data.tags || [],
    aiInsight: data.aiInsight,
    aiInsightGeneratedAt: data.aiInsightGeneratedAt
      ? data.aiInsightGeneratedAt instanceof Timestamp
        ? data.aiInsightGeneratedAt.toDate()
        : new Date(data.aiInsightGeneratedAt)
      : undefined,
    aiInterpretation: data.aiInterpretation,
    aiCoachResponse: data.aiCoachResponse,
    aiAnalysisGeneratedAt: data.aiAnalysisGeneratedAt
      ? data.aiAnalysisGeneratedAt instanceof Timestamp
        ? data.aiAnalysisGeneratedAt.toDate()
        : new Date(data.aiAnalysisGeneratedAt)
      : undefined,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(data.updatedAt),
  };
}

const journalCollection = collection(db, 'journalEntries');

export async function createJournalEntry(
  userId: string,
  data: CreateJournalEntryData
): Promise<JournalEntry> {
  const now = Timestamp.now();
  const docRef = await addDoc(journalCollection, {
    userId,
    date: Timestamp.fromDate(data.date),
    content: data.content,
    mood: data.mood ?? null,
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  });
  const snap = await getDoc(docRef);
  return fromFirestore(snap as QueryDocumentSnapshot<DocumentData>);
}

export async function updateJournalEntry(
  entryId: string,
  data: UpdateJournalEntryData
): Promise<void> {
  const ref = doc(journalCollection, entryId);
  const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };
  if (data.date !== undefined) updates.date = Timestamp.fromDate(data.date);
  if (data.content !== undefined) updates.content = data.content;
  if (data.mood !== undefined) updates.mood = data.mood;
  if (data.tags !== undefined) updates.tags = data.tags;
  if (data.aiInsight !== undefined) updates.aiInsight = data.aiInsight;
  if (data.aiInsightGeneratedAt !== undefined)
    updates.aiInsightGeneratedAt = Timestamp.fromDate(data.aiInsightGeneratedAt);
  if (data.aiInterpretation !== undefined) updates.aiInterpretation = data.aiInterpretation;
  if (data.aiCoachResponse !== undefined) updates.aiCoachResponse = data.aiCoachResponse;
  if (data.aiAnalysisGeneratedAt !== undefined)
    updates.aiAnalysisGeneratedAt = Timestamp.fromDate(data.aiAnalysisGeneratedAt);
  await updateDoc(ref, updates as any);
}

export async function deleteJournalEntry(entryId: string): Promise<void> {
  const ref = doc(journalCollection, entryId);
  await deleteDoc(ref);
}

export async function getUserJournalEntries(
  userId: string,
  limitCount = 100
): Promise<JournalEntry[]> {
  const q = query(
    journalCollection,
    where('userId', '==', userId),
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  const entries = snapshot.docs.map(d => fromFirestore(d as QueryDocumentSnapshot<DocumentData>));
  // Sort client-side to avoid requiring a composite Firestore index
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function getPaginatedJournalEntries(
  userId: string,
  pageSize = 20,
  lastDoc: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<PaginatedJournalEntries> {
  // Query without orderBy to avoid requiring a composite index.
  // We fetch pageSize+1 docs (using cursor if paginating) and sort client-side.
  let q = query(
    journalCollection,
    where('userId', '==', userId),
    limit(pageSize + 1)
  );
  if (lastDoc) {
    q = query(
      journalCollection,
      where('userId', '==', userId),
      startAfter(lastDoc),
      limit(pageSize + 1)
    );
  }
  const snapshot = await getDocs(q);
  const docs = snapshot.docs as QueryDocumentSnapshot<DocumentData>[];
  const hasMore = docs.length > pageSize;
  const entries = docs
    .slice(0, pageSize)
    .map(d => fromFirestore(d))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return {
    entries,
    lastDoc: docs.length > 0 ? docs[Math.min(docs.length, pageSize) - 1] : null,
    hasMore,
  };
}

export async function getJournalEntry(entryId: string): Promise<JournalEntry | null> {
  const ref = doc(journalCollection, entryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return fromFirestore(snap as QueryDocumentSnapshot<DocumentData>);
}
