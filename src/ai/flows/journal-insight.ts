'use server';
/**
 * @fileOverview AI coaching insight for athlete journal entries.
 *
 * Returns two distinct sections:
 *  - interpretation: what the coach hears / reads between the lines
 *  - coachResponse: direct coaching advice
 *
 * Also returns a combined `insight` string for backward compatibility.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

import { assertUser } from '@/lib/api-auth';

const JournalInsightInputSchema = z.object({
  journalContent: z.string().describe("The athlete's journal entry text."),
  mood: z.string().optional().describe("The athlete's self-reported mood (great/good/okay/tired/struggling)."),
  tags: z.array(z.string()).optional().describe("Category tags the athlete attached to this entry."),
  entryDate: z.string().describe("The date of the journal entry in ISO format (YYYY-MM-DD)."),
  userData: z.string().describe("A JSON string containing the athlete's profile, recent workout sessions, and any Strava training summary."),
  coachNotes: z.string().optional().describe("What the coach remembers the athlete has told them in earlier conversations. One per line."),
});
export type JournalInsightInput = z.infer<typeof JournalInsightInputSchema>;

const JournalInsightOutputSchema = z.object({
  interpretation: z.string().describe("What the coach reads in the entry — emotional themes, underlying concerns, what the athlete is really expressing. 1–2 paragraphs. No coaching yet — just understanding."),
  coachResponse: z.string().describe("Direct coaching response: references what the athlete wrote, connects to training data, ends with one actionable focus. 2–3 paragraphs."),
  insight: z.string().describe("Combined insight for backward compatibility (interpretation + coachResponse joined)."),
});
export type JournalInsightOutput = z.infer<typeof JournalInsightOutputSchema>;

export async function journalInsight(input: JournalInsightInput): Promise<JournalInsightOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:journal-insight', { max: 20 });
  return journalInsightFlow(input);
}

const journalInsightFlow = ai.defineFlow(
  {
    name: 'journalInsightFlow',
    inputSchema: JournalInsightInputSchema,
    outputSchema: JournalInsightOutputSchema,
  },
  async (input) => {
    const moodContext = input.mood ? `Self-reported mood: ${input.mood}.` : '';
    const tagsContext =
      input.tags && input.tags.length > 0
        ? `Tagged by athlete as: ${input.tags.join(', ')}.`
        : '';

    const llmResponse = await ai.generate({
      prompt: `You are an expert hybrid performance and HYROX coach reading your athlete's training journal. You will return two separate responses.

Date of entry: ${input.entryDate}
${moodContext}
${tagsContext}

Journal entry:
"""
${input.journalContent}
"""

Athlete data (profile, recent sessions, Strava training summary if available):
${input.userData}

${input.coachNotes ? `What this athlete has told you in earlier conversations — treat it as current and let it inform both sections, without reciting it back to them:\n${input.coachNotes}` : ''}

---

SECTION 1 — INTERPRETATION (field: "interpretation")
Read this entry as a coach who listens deeply. Do NOT give advice yet — only understand.
- What is the emotional state beneath the surface words? (not just the reported mood, but the subtext)
- What key themes or concerns is this athlete working through?
- What do they seem to need most right now — acknowledgement, challenge, reassurance, or clarity?
Write 1–2 paragraphs. No bullet points. Speak as if you are reflecting back to yourself what you heard, before you respond.

SECTION 2 — COACH'S RESPONSE (field: "coachResponse")
Now respond directly to the athlete as their coach.
- Reference specific things they wrote — do not be generic
- Connect to their training data if relevant (e.g. if they mention fatigue and recent load is genuinely high, name it)
- Be direct and practical — like a coach who respects their athlete, not a cheerleader
- Celebrate achievements concretely; name what they did well and why it matters
- End with exactly one actionable focus for the coming days
Write 2–3 paragraphs. No bullet points. No headers. This is a personal coaching response.`,
      output: { schema: JournalInsightOutputSchema },
    });

    const output = llmResponse.output!;
    // Ensure backward-compatible combined insight field
    return {
      interpretation: output.interpretation,
      coachResponse: output.coachResponse,
      insight: output.insight || `${output.interpretation}\n\n${output.coachResponse}`,
    };
  }
);
