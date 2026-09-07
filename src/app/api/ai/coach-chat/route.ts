// src/app/api/ai/coach-chat/route.ts
//
// The Edge Coach endpoint.
//
// GET  — the athlete's most recent thread plus a snapshot of where their
//        training currently stands, so the chat opens already knowing them.
// POST — one turn of conversation: brief the coach, let it use its tools,
//        persist the exchange, and hand back any plan change it drafted.
//
// The athlete's id always comes from the verified Firebase token, never the
// request body: every read the coach makes is scoped to whoever is signed in.

import { NextResponse, after } from 'next/server';

import { requireUser } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { coachChat, type CoachMessage } from '@/ai/flows/coach-chat';
import { extractCoachNotes } from '@/ai/flows/extract-coach-notes';
import { buildCoachContext } from '@/services/coach-context';
import { applyNoteWrites, getActiveNotes } from '@/services/coach-notes';
import {
  appendExchange,
  getConversation,
  getLatestConversation,
} from '@/services/coach-conversation';

const MAX_MESSAGE_CHARS = 4000;

export async function GET(request: Request) {
  const auth = await requireUser(request, { bucket: 'ai:coach-chat:get', windowMs: 60_000, max: 30 });
  if ('response' in auth) return auth.response;

  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');

    const [conversation, context] = await Promise.all([
      conversationId
        ? getConversation(auth.uid, conversationId)
        : getLatestConversation(auth.uid),
      buildCoachContext(auth.uid),
    ]);

    return NextResponse.json({
      conversation: conversation
        ? {
            id: conversation.id,
            title: conversation.title,
            messages: conversation.messages,
            updatedAt: conversation.updatedAt.toISOString(),
          }
        : null,
      snapshot: context.snapshot,
    });
  } catch (error) {
    logger.error('[coach-chat] GET failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Could not load your coach.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Each turn can fan out into several Gemini calls plus Strava, so the limit
  // is tighter than a plain CRUD route's.
  const auth = await requireUser(request, { bucket: 'ai:coach-chat', windowMs: 60_000, max: 12 });
  if ('response' in auth) return auth.response;

  try {
    const body = await request.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

    if (!message) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
        { status: 400 },
      );
    }

    // History comes from the stored thread rather than the request, so a client
    // cannot put words in the coach's mouth by inventing prior turns.
    const existing = conversationId ? await getConversation(auth.uid, conversationId) : null;
    const history: CoachMessage[] = (existing?.messages ?? []).map(stored => ({
      role: stored.role,
      content: stored.content,
    }));

    const result = await coachChat({ userId: auth.uid, message, history });

    const savedConversationId = await appendExchange({
      userId: auth.uid,
      conversationId: existing?.id ?? null,
      userMessage: message,
      assistantMessage: result.answer,
      consulted: result.consulted,
    });

    // Update what the coach remembers after the reply has gone out. This is a
    // second model call, and making the athlete wait for it would add a second
    // or two to every message for something they never see happen.
    after(async () => {
      try {
        const existingNotes = await getActiveNotes(auth.uid);
        const writes = await extractCoachNotes({
          athleteMessage: message,
          coachReply: result.answer,
          existingNotes,
        });
        if (writes.length === 0) return;
        const counts = await applyNoteWrites(auth.uid, writes, { source: 'chat' });
        logger.info(
          `[coach-chat] notes updated for ${auth.uid}: +${counts.added} ~${counts.updated} -${counts.resolved}`,
        );
      } catch (error) {
        logger.error(
          '[coach-chat] Note extraction failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    return NextResponse.json({
      conversationId: savedConversationId,
      answer: result.answer,
      consulted: result.consulted,
      planProposal: result.planProposal,
      snapshot: result.snapshot,
    });
  } catch (error) {
    logger.error(
      '[coach-chat] POST failed:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: 'The coach could not answer that just now. Try again in a moment.' },
      { status: 500 },
    );
  }
}
