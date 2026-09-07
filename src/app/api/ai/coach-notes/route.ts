// src/app/api/ai/coach-notes/route.ts
//
// What the coach currently remembers about the signed-in athlete.
//
// A plain Firestore read with no model call, so the surfaces that aren't the
// chat — the dashboard greeting, the daily tip, the journal response — can be
// written with the same memory the conversation has, without paying for it.
//
// DELETE lets the athlete drop a note. That matters: memory the athlete cannot
// correct is memory they will stop trusting, and "I'm not actually away any
// more" should take one tap, not an argument with a chatbot.

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { extractCoachNotes } from '@/ai/flows/extract-coach-notes';
import { applyNoteWrites, formatNotesForPrompt, getActiveNotes, resolveNote } from '@/services/coach-notes';
import { invalidateCoachContext } from '@/services/coach-context';

export async function GET(request: Request) {
  const auth = await requireUser(request, { bucket: 'ai:coach-notes', windowMs: 60_000, max: 60 });
  if ('response' in auth) return auth.response;

  try {
    const notes = await getActiveNotes(auth.uid);
    return NextResponse.json({
      notes: notes.map(note => ({
        id: note.id,
        category: note.category,
        content: note.content,
        expiresAt: note.expiresAt ? note.expiresAt.toISOString() : null,
      })),
      // The same rendering the coach's own prompts use, so a caller passing
      // this into a flow and the chat cannot drift apart.
      promptText: formatNotesForPrompt(notes),
    });
  } catch (error) {
    logger.error(
      '[coach-notes] GET failed:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ notes: [], promptText: null });
  }
}

/**
 * Hand the coach something to remember from outside the chat — today it's the
 * journal, where athletes write the things they never think to say out loud.
 * The text is read for standing facts the same way a conversation is; most
 * entries produce nothing, which is the intended outcome.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request, {
    bucket: 'ai:coach-notes:write',
    windowMs: 60_000,
    max: 10,
  });
  if ('response' in auth) return auth.response;

  try {
    const body = await request.json();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return NextResponse.json({ error: 'Text is required.' }, { status: 400 });
    if (text.length > 8000) {
      return NextResponse.json({ error: 'Text is too long.' }, { status: 400 });
    }

    const source = body.source === 'journal' ? 'journal' : 'manual';
    const existingNotes = await getActiveNotes(auth.uid);
    const writes = await extractCoachNotes({ athleteMessage: text, existingNotes });
    const counts = writes.length
      ? await applyNoteWrites(auth.uid, writes, { source })
      : { added: 0, updated: 0, resolved: 0 };

    invalidateCoachContext(auth.uid);

    const notes = await getActiveNotes(auth.uid);
    return NextResponse.json({
      ...counts,
      notes: notes.map(note => ({
        id: note.id,
        category: note.category,
        content: note.content,
        expiresAt: note.expiresAt ? note.expiresAt.toISOString() : null,
      })),
    });
  } catch (error) {
    logger.error(
      '[coach-notes] POST failed:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: 'Could not update what the coach remembers.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request, {
    bucket: 'ai:coach-notes:delete',
    windowMs: 60_000,
    max: 30,
  });
  if ('response' in auth) return auth.response;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Note id is required.' }, { status: 400 });

  try {
    const removed = await resolveNote(auth.uid, id);
    if (!removed) return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
    // Forgetting has to take effect at once, or the coach quotes it straight back.
    invalidateCoachContext(auth.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      '[coach-notes] DELETE failed:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: 'Could not forget that just now.' }, { status: 500 });
  }
}
