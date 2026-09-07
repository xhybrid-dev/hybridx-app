// src/ai/flows/extract-coach-notes.ts
//
// Turns what the athlete just said into what the coach will remember.
//
// Runs after every chat turn (and after a journal entry is written) on the fast
// model, given the exchange and everything already remembered. It returns
// changes rather than a fresh list, so "the knee is fine now" resolves the old
// note instead of sitting next to it contradicting it, and "actually I'm back
// on the 20th" edits the holiday rather than adding a second one.
//
// Deliberately conservative: most exchanges produce nothing. A note is only
// worth keeping if it would change what the coach says to them next week.

import { ai, MODELS } from '@/ai/genkit';
import { z } from 'genkit';
import { COACH_NOTE_CATEGORIES, type CoachNote, type CoachNoteWrite } from '@/services/coach-notes';

const NoteWriteSchema = z.object({
  action: z.enum(['add', 'update', 'resolve']),
  id: z
    .string()
    .optional()
    .describe('The existing note id. Required for update and resolve, omitted for add.'),
  category: z
    .enum(['availability', 'constraint', 'goal', 'preference', 'context', 'commitment'])
    .optional(),
  content: z
    .string()
    .optional()
    .describe('One sentence about the athlete, in the third person, readable months later.'),
  expiresAt: z
    .string()
    .optional()
    .describe('YYYY-MM-DD when this stops being true. Omit if there is no natural end.'),
});

const ExtractCoachNotesOutputSchema = z.object({
  writes: z.array(NoteWriteSchema).describe('Changes to what the coach remembers. Usually empty.'),
});

export interface ExtractCoachNotesInput {
  /** What the athlete said. */
  athleteMessage: string;
  /** What the coach replied — commitments often live in the reply. */
  coachReply?: string;
  existingNotes: CoachNote[];
  now?: Date;
}

const PROMPT = `You maintain a coach's memory of one athlete.

You are given what the athlete just said, what the coach replied, and everything the coach already remembers. Return only the CHANGES to that memory.

WHAT IS WORTH REMEMBERING
Only things that would change what the coach says to this athlete days or weeks from now:
- availability: travel, holidays, a work crunch, a period they can't train as planned. Always pin dates when they gave any ("away next week" → work out the actual dates from today's date).
- constraint: injuries, niggles, illness, a missing gym or piece of kit.
- goal: a race they entered, a target time, something they are chasing.
- preference: how they want to be coached, sessions they love or dread, when in the day they train.
- context: work, sleep, family, stress — the life the training sits inside.
- commitment: something the athlete said they would do ("I'll get three in this week").

WHAT IS NOT
- Anything already in the training data: sessions completed, missed, times, distances, loads. The coach reads those directly.
- One-off feelings about a single session ("legs were heavy today"). That's a journal note, not a standing fact.
- Advice the coach gave. You remember the athlete, not the coach.
- Anything you are inferring rather than being told.

HOW TO WRITE A NOTE
- One sentence, third person, about the athlete: "Away in Spain 12–19 September." "Right knee sore on lunges since early September." "Prefers to train before work."
- Self-contained. It will be read months later with none of this conversation around it.
- Pin dates absolutely (14 September), never relatively (next Tuesday).

CHANGING WHAT IS ALREADY THERE
- If this contradicts or moves on from an existing note, "update" that note by id — don't add a rival.
- If something is now over or resolved ("knee's fine", "back from holiday", they did the thing they committed to), "resolve" that note by id.
- If it is genuinely new, "add" it.
- If nothing here is worth remembering, return an empty list. That is the normal outcome.`;

/**
 * Extracts memory changes from one exchange. Never throws: losing a note is a
 * smaller failure than failing the athlete's message, so callers get an empty
 * list if the model is unavailable.
 */
export async function extractCoachNotes(
  input: ExtractCoachNotesInput,
): Promise<CoachNoteWrite[]> {
  const now = input.now ?? new Date();

  const existing = input.existingNotes.length
    ? input.existingNotes
        .map(note => {
          const until = note.expiresAt ? `, through ${note.expiresAt.toISOString().slice(0, 10)}` : '';
          return `- id=${note.id} [${note.category}${until}] ${note.content}`;
        })
        .join('\n')
    : '(nothing remembered yet)';

  const { output } = await ai.generate({
    model: MODELS.fast,
    prompt: `${PROMPT}

TODAY IS ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-GB', { weekday: 'long' })}).

ALREADY REMEMBERED:
${existing}

THE ATHLETE SAID:
"""
${input.athleteMessage}
"""

${input.coachReply ? `THE COACH REPLIED:\n"""\n${input.coachReply}\n"""` : ''}`,
    output: { schema: ExtractCoachNotesOutputSchema },
    config: { temperature: 0 },
  });

  const writes = output?.writes ?? [];

  return writes
    .filter(write => {
      if (write.action === 'resolve') return !!write.id;
      if (!write.content?.trim()) return false;
      // A category outside the known set means the model invented one; the
      // note is still useful, so it lands as context rather than being dropped.
      return true;
    })
    .map(write => ({
      action: write.action,
      id: write.id,
      category: COACH_NOTE_CATEGORIES.includes(write.category as never)
        ? (write.category as CoachNoteWrite['category'])
        : 'context',
      content: write.content?.trim(),
      expiresAt: write.expiresAt ?? undefined,
    }));
}
