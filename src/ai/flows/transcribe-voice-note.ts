// src/ai/flows/transcribe-voice-note.ts
//
// Turns a voice note to the coach into text.
//
// Talking is the fastest way to tell your coach something — walking out of the
// gym, on the drive home, lying in bed with a cold — so the coach takes voice
// notes. Gemini hears the audio directly; the transcript is what gets stored,
// answered and remembered. The audio itself is never kept.
//
// Server-only: called from /api/ai/coach-voice.

import { ai, MODELS } from '@/ai/genkit';

/** Container types browsers record in, and that the model accepts. */
export const VOICE_NOTE_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
] as const;

/** The mime type without codec parameters, or null when it isn't one we take. */
export function normaliseVoiceMimeType(raw: string | null | undefined): string | null {
  const base = (raw ?? '').split(';')[0].trim().toLowerCase();
  return (VOICE_NOTE_MIME_TYPES as readonly string[]).includes(base) ? base : null;
}

const PROMPT = `Transcribe this voice note from an athlete to their training coach.

- Write down what they said, in their words. Don't summarise, answer or add anything.
- Drop filler ("um", "er", "like, you know") and false starts, and punctuate it so it reads naturally.
- Keep training terms as athletes write them: HYROX, SkiErg, wall balls, sled push, RPE, 5k, PB, Zone 2.
- British English spelling.
- If there is no intelligible speech, return exactly: [no speech]`;

/**
 * Returns the transcript, or an empty string when nothing was said. Throws
 * when the model call itself fails, so the route can say so.
 */
export async function transcribeVoiceNote(audio: Buffer, mimeType: string): Promise<string> {
  const { text } = await ai.generate({
    model: MODELS.fast,
    prompt: [
      { media: { url: `data:${mimeType};base64,${audio.toString('base64')}`, contentType: mimeType } },
      { text: PROMPT },
    ],
    config: { temperature: 0 },
  });

  const transcript = (text ?? '').trim();
  if (!transcript || /^\[no speech\]$/i.test(transcript)) return '';
  return transcript;
}
