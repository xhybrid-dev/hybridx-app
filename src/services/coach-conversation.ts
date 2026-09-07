// src/services/coach-conversation.ts
//
// Persistence for Edge Coach conversations.
//
// A coach you have to re-introduce yourself to every time you open the app is
// not a coach. Threads are stored server-side (Admin SDK) so the athlete can
// close the app mid-conversation, come back tomorrow, and carry on — and so the
// coach can be handed the same thread as context on the next turn.
//
// Documents are capped: a thread keeps its most recent messages and drops the
// oldest, which keeps a long-running conversation inside Firestore's 1 MiB
// document limit without the athlete ever losing the part they can see.

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export const COACH_CONVERSATIONS_COLLECTION = 'coachConversations';

/** Messages retained per thread. Older ones are dropped as new turns arrive. */
const MAX_STORED_MESSAGES = 60;

/** Guards against an oversized paste being stored verbatim. */
const MAX_MESSAGE_CHARS = 8000;

export interface StoredCoachMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** For assistant turns: the lookups the coach made, shown in the UI. */
  consulted?: string[];
}

export interface CoachConversation {
  id: string;
  userId: string;
  title: string;
  messages: StoredCoachMessage[];
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: any): Date {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value ?? Date.now());
}

function fromFirestore(doc: FirebaseFirestore.DocumentSnapshot): CoachConversation {
  const data = doc.data() as Record<string, any>;
  return {
    id: doc.id,
    userId: data.userId,
    title: data.title || 'Coach chat',
    messages: (data.messages ?? []).map((message: any) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content ?? ''),
      createdAt: message.createdAt ?? new Date().toISOString(),
      consulted: message.consulted ?? undefined,
    })),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

/** A thread title taken from how the athlete opened it. */
export function deriveTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Coach chat';
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<CoachConversation | null> {
  const doc = await getAdminDb()
    .collection(COACH_CONVERSATIONS_COLLECTION)
    .doc(conversationId)
    .get();

  if (!doc.exists) return null;
  const conversation = fromFirestore(doc);
  // Ownership is checked here rather than in rules because every read goes
  // through the Admin SDK, which bypasses them.
  if (conversation.userId !== userId) return null;
  return conversation;
}

export async function getLatestConversation(userId: string): Promise<CoachConversation | null> {
  const snapshot = await getAdminDb()
    .collection(COACH_CONVERSATIONS_COLLECTION)
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return fromFirestore(snapshot.docs[0]);
}

export async function listConversations(userId: string, limit = 20): Promise<CoachConversation[]> {
  const snapshot = await getAdminDb()
    .collection(COACH_CONVERSATIONS_COLLECTION)
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(fromFirestore);
}

function truncate(content: string): string {
  return content.length > MAX_MESSAGE_CHARS ? content.slice(0, MAX_MESSAGE_CHARS) : content;
}

/**
 * Appends one exchange (the athlete's message and the coach's reply) to a
 * thread, creating the thread when `conversationId` is absent or unknown.
 * Returns the id the client should keep using.
 */
export async function appendExchange(input: {
  userId: string;
  conversationId?: string | null;
  userMessage: string;
  assistantMessage: string;
  consulted?: string[];
}): Promise<string> {
  const db = getAdminDb();
  const collection = db.collection(COACH_CONVERSATIONS_COLLECTION);
  const now = new Date();

  const newMessages: StoredCoachMessage[] = [
    { role: 'user', content: truncate(input.userMessage), createdAt: now.toISOString() },
    {
      role: 'assistant',
      content: truncate(input.assistantMessage),
      createdAt: new Date(now.getTime() + 1).toISOString(),
      ...(input.consulted?.length ? { consulted: input.consulted } : {}),
    },
  ];

  const existing = input.conversationId
    ? await getConversation(input.userId, input.conversationId)
    : null;

  if (!existing) {
    const doc = await collection.add({
      userId: input.userId,
      title: deriveTitle(input.userMessage),
      messages: newMessages,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    });
    return doc.id;
  }

  const messages = [...existing.messages, ...newMessages].slice(-MAX_STORED_MESSAGES);

  await collection.doc(existing.id).update({
    messages,
    updatedAt: Timestamp.fromDate(now),
  });

  return existing.id;
}
