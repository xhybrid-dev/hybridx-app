// src/app/api/ai/coach-chat/route.ts
//
// The Talk to Coach endpoint — typed messages and transcribed voice notes alike.
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
import { coachChat, describeForModel, type CoachMessage } from '@/ai/flows/coach-chat';
import { extractCoachNotes } from '@/ai/flows/extract-coach-notes';
import { buildCoachContext, invalidateCoachContext } from '@/services/coach-context';
import { getUser, updateUserAdmin } from '@/services/user-service';
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
      buildCoachContext(auth.uid, new Date(), { timeZone: auth.timeZone }),
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
    const kind: 'text' | 'voice' = body.kind === 'voice' ? 'voice' : 'text';
    // The session a message was sent from ("how did Engine Builder go?"), so
    // "legs were gone" is read against the right workout.
    const about =
      typeof body.about === 'string' && body.about.trim()
        ? body.about.replace(/\s+/g, ' ').trim().slice(0, 120)
        : null;

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
    // cannot put words in the coach's mouth by inventing prior turns. With no
    // thread named — a voice note from the dashboard, a question from a
    // workout — it joins the athlete's ongoing conversation rather than
    // starting a fresh one: talking to your coach is one running thread.
    const existing = conversationId
      ? await getConversation(auth.uid, conversationId)
      : await getLatestConversation(auth.uid);
    const history: CoachMessage[] = (existing?.messages ?? []).map(stored => ({
      role: stored.role,
      content: describeForModel(stored.content, stored.kind, stored.about),
    }));

    const result = await coachChat({
      userId: auth.uid,
      message,
      history,
      timeZone: auth.timeZone,
      kind,
      about,
    });

    const savedConversationId = await appendExchange({
      userId: auth.uid,
      conversationId: existing?.id ?? null,
      userMessage: message,
      assistantMessage: result.answer,
      consulted: result.consulted,
      userKind: kind,
      about,
    });

    // Remember where they are, so the jobs that run without a browser behind
    // them — the nightly adjustment, notifications — get the same calendar the
    // athlete sees. Fire and forget: it must never delay or fail a reply.
    if (auth.timeZone) {
      after(async () => {
        try {
          const current = await getUser(auth.uid);
          if (current && current.timeZone !== auth.timeZone) {
            await updateUserAdmin(auth.uid, { timeZone: auth.timeZone });
            invalidateCoachContext(auth.uid);
          }
        } catch (error) {
          logger.error(
            '[coach-chat] Could not store timezone:',
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    }

    // Update what the coach remembers after the reply has gone out. This is a
    // second model call, and making the athlete wait for it would add a second
    // or two to every message for something they never see happen.
    after(async () => {
      try {
        const existingNotes = await getActiveNotes(auth.uid);
        const writes = await extractCoachNotes({
          athleteMessage: about ? `(About their session "${about}") ${message}` : message,
          coachReply: result.answer,
          existingNotes,
        });
        if (writes.length === 0) return;
        const counts = await applyNoteWrites(auth.uid, writes, { source: kind === 'voice' ? 'voice' : 'chat' });
        // The next turn must open with what was just remembered.
        invalidateCoachContext(auth.uid);
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
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('[coach-chat] POST failed:', detail);
    return NextResponse.json(
      {
        error: 'The coach could not answer that just now. Try again in a moment.',
        // Admins see why, in the chat itself — otherwise a broken model or a
        // missing index is only visible in Cloud Logging.
        ...((await isAdmin(auth.uid)) ? { detail: detail.slice(0, 500) } : {}),
      },
      { status: 500 },
    );
  }
}

async function isAdmin(uid: string): Promise<boolean> {
  try {
    return !!(await getUser(uid))?.isAdmin;
  } catch {
    return false;
  }
}
