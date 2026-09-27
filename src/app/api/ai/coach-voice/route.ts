// src/app/api/ai/coach-voice/route.ts
//
// POST a recorded voice note (multipart, field "audio"); get back the
// transcript. The client then sends that transcript to /api/ai/coach-chat as a
// voice note, so a spoken message and a typed one go through exactly the same
// coach — same briefing, same memory, same thread.
//
// Transcription is its own step, rather than folded into the chat call, so the
// athlete sees their words appear in the thread while the coach is still
// thinking, and a failed transcription never costs them a coach turn.

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { normaliseVoiceMimeType, transcribeVoiceNote } from '@/ai/flows/transcribe-voice-note';

/** A few minutes of compressed speech is well under this. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireUser(request, { bucket: 'ai:coach-voice', windowMs: 60_000, max: 10 });
  if ('response' in auth) return auth.response;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get('audio');
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: 'Could not read that recording.' }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'The recording was empty.' }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording is too long — keep voice notes to a few minutes.' }, { status: 413 });
  }

  const mimeType = normaliseVoiceMimeType(file.type);
  if (!mimeType) {
    return NextResponse.json({ error: 'That audio format is not supported.' }, { status: 415 });
  }

  try {
    const transcript = await transcribeVoiceNote(Buffer.from(await file.arrayBuffer()), mimeType);
    return NextResponse.json({ transcript });
  } catch (error) {
    logger.error(
      '[coach-voice] Transcription failed:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "Couldn't make out that voice note just now. Try again, or type it instead." },
      { status: 500 },
    );
  }
}
