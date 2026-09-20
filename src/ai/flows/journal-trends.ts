'use server';
/**
 * @fileOverview Cross-entry journal trend analysis.
 *
 * Analyses multiple journal entries alongside training history to surface
 * mood patterns, recurring themes, and big-picture coaching advice.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

import { assertUser } from '@/lib/api-auth';

const JournalTrendsInputSchema = z.object({
  entries: z.string().describe("JSON array of the athlete's recent journal entries (date, content, mood, tags)."),
  recentSessions: z.string().describe("JSON array of recent workout sessions (date, title, notes, skipped, duration)."),
  stravaContext: z.string().optional().describe("ATL/CTL/TSB training load summary from Strava if available."),
  userName: z.string().describe("The athlete's first name."),
});
export type JournalTrendsInput = z.infer<typeof JournalTrendsInputSchema>;

const JournalTrendsOutputSchema = z.object({
  periodSummary: z.string().describe("1–2 sentence overview of the athlete's overall period based on their journal and training."),
  moodPattern: z.string().describe("A specific observation about how the athlete's mood has tracked over the entries — trends, dips, improvements, correlations."),
  keyThemes: z.array(z.string()).describe("3–5 recurring themes identified across the entries (e.g. 'Return to consistency', 'Form under fatigue', 'Mental resilience')."),
  coachingAdvice: z.string().describe("2–3 paragraphs of pattern-based coaching advice drawn from aggregate journal and training data. Specific, not generic."),
});
export type JournalTrendsOutput = z.infer<typeof JournalTrendsOutputSchema>;

export async function journalTrends(input: JournalTrendsInput): Promise<JournalTrendsOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:journal-trends', { max: 20 });
  return journalTrendsFlow(input);
}

const journalTrendsFlow = ai.defineFlow(
  {
    name: 'journalTrendsFlow',
    inputSchema: JournalTrendsInputSchema,
    outputSchema: JournalTrendsOutputSchema,
  },
  async (input) => {
    const stravaSection = input.stravaContext
      ? `\nStrava training load data:\n${input.stravaContext}`
      : '';

    const llmResponse = await ai.generate({
      prompt: `You are an expert hybrid performance and HYROX coach who has just finished reading ${input.userName}'s recent training journal entries alongside their workout history. Your job is to give pattern-based intelligence — not entry-by-entry feedback, but what you see across the whole picture.

Journal entries (most recent first):
${input.entries}

Recent workout sessions:
${input.recentSessions}
${stravaSection}

Analyse this data and return:

1. PERIOD SUMMARY (field: "periodSummary")
1–2 sentences summarising this athlete's overall period. What is the dominant story of this window of time?

2. MOOD PATTERN (field: "moodPattern")
What specific pattern do you see in how this athlete's mood and mental state has changed over these entries? Call out correlations if they exist — e.g. mood dips after high training load, improvement when consistency returns, recurring emotional themes. Be specific. Do not generalise.

3. KEY THEMES (field: "keyThemes")
Identify 3–5 recurring themes across the entries. These should be short, specific phrases that name a real pattern you see — not generic categories. Examples: "Returning from time off", "Fatigue management", "Mental barriers on long runs", "Building back strength". Name themes you actually see.

4. COACHING ADVICE (field: "coachingAdvice")
2–3 paragraphs of coaching advice based on the patterns you've identified. Reference specific things from the entries. If training data shows a correlation, name it. Give practical direction for what this athlete should focus on in the period ahead. Be direct. No hollow encouragement.`,
      output: { schema: JournalTrendsOutputSchema },
    });

    return llmResponse.output!;
  }
);
