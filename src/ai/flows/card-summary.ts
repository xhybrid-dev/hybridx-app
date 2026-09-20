// src/ai/flows/card-summary.ts
'use server';
/**
 * Generates a short, snappy social-ready summary for the workout share card.
 * Uses only data that is actually available — never fabricates metrics.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

import { assertUser } from '@/lib/api-auth';

const CardSummaryInputSchema = z.object({
  workoutTitle: z.string().describe('The title of the workout.'),
  workoutType: z.enum(['hyrox', 'running']).describe('The type of workout.'),
  distanceKm: z.number().optional().describe('Distance covered in kilometres.'),
  durationMinutes: z.number().optional().describe('Total duration in minutes.'),
  paceMinPerKm: z.number().optional().describe('Average pace in minutes per km.'),
  stravaActivityName: z.string().optional().describe('The name Strava gave the activity.'),
  userNotes: z.string().optional().describe('Optional private notes from the user — use for context only, do not quote directly.'),
});

export type CardSummaryInput = z.infer<typeof CardSummaryInputSchema>;

const CardSummaryOutputSchema = z.object({
  summary: z.string().describe('A snappy 1-2 sentence workout summary for a social share card. Max 160 characters.'),
});

const prompt = ai.definePrompt({
  name: 'cardSummaryPrompt',
  input: { schema: CardSummaryInputSchema },
  output: { schema: CardSummaryOutputSchema },
  prompt: `You write short, punchy workout summaries for a social share card.

Rules:
- Maximum 160 characters total
- 1-2 sentences only
- Only use metrics that are explicitly provided — never invent heart rate, pace, or splits
- Sound like a confident athlete, not a chatbot
- Highlight what made this session valuable (aerobic base, strength, speed, recovery, etc.)
- Do NOT start with "I" or repeat the workout title verbatim

Workout: {{{workoutTitle}}} ({{workoutType}})
{{#if distanceKm}}Distance: {{distanceKm}}km{{/if}}
{{#if durationMinutes}}Duration: {{durationMinutes}} minutes{{/if}}
{{#if paceMinPerKm}}Avg pace: {{paceMinPerKm}} min/km{{/if}}
{{#if stravaActivityName}}Strava activity: {{stravaActivityName}}{{/if}}
{{#if userNotes}}Context (do not quote): {{userNotes}}{{/if}}

Examples of good output:
- "12.6km Zone 2 run in 67 minutes. Aerobic base locked in."
- "PHA circuit complete — strength and conditioning done right."
- "Hour on the erg. Every stroke counts when building engine capacity."
`,
});

const cardSummaryFlow = ai.defineFlow(
  {
    name: 'cardSummaryFlow',
    inputSchema: CardSummaryInputSchema,
    outputSchema: CardSummaryOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

export async function generateCardSummary(input: CardSummaryInput): Promise<string> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:card-summary', { max: 20 });
  const result = await cardSummaryFlow(input);
  return result.summary;
}
