// src/ai/flows/strava-description.ts
'use server';
/**
 * @fileOverview AI-driven description generator for Strava activities.
 *
 * - generateStravaDescription - A function that creates an engaging summary for a workout.
 * - StravaDescriptionInput - The input type for the generateStravaDescription function.
 * - StravaDescriptionOutput - The return type for the generateStravaDescription function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const StravaDescriptionInputSchema = z.object({
  workoutTitle: z.string().describe('The title of the workout.'),
  workoutType: z.enum(['hyrox', 'running']).describe('The type of the workout.'),
  exercises: z.string().describe('A JSON string of the exercises or runs in the workout.'),
  userNotes: z.string().optional().describe('Optional notes from the user about the workout.'),
});
export type StravaDescriptionInput = z.infer<typeof StravaDescriptionInputSchema>;

const StravaDescriptionOutputSchema = z.object({
  description: z.string().describe('A concise, engaging summary of the workout suitable for a Strava activity description.'),
});
export type StravaDescriptionOutput = z.infer<typeof StravaDescriptionOutputSchema>;


export async function generateStravaDescription(input: StravaDescriptionInput): Promise<StravaDescriptionOutput> {
  return generateStravaDescriptionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateStravaDescriptionPrompt',
  input: {schema: StravaDescriptionInputSchema},
  output: {schema: StravaDescriptionOutputSchema},
  prompt: `You are an AI training partner, writing a fun and engaging description for a completed workout to be posted on Strava.

  **Instructions:**
  1.  Start with a strong, positive opening line about the workout.
  2.  Briefly summarize the key components of the session based on the provided exercises.
  3.  If the user provided notes, weave their personal experience into the summary (e.g., if they said it was 'tough but rewarding', mention that).
  4.  Keep the tone upbeat, motivating, and concise (2-4 sentences).
  5.  **Crucially**, end the description with the line: "Powered by HYBRIDX.CLUB #hybridx"

  **Workout Details:**
  - Title: {{{workoutTitle}}}
  - Type: {{{workoutType}}}
  - Exercises: {{{exercises}}}
  {{#if userNotes}}- User Notes: "{{{userNotes}}}"{{/if}}

  **Example Output:**
  "Crushed today's 'Engine Builder' session! It was a real grind through the rows and burpees, but feeling stronger for it. Tough but rewarding as the notes say.

Powered by HYBRIDX.CLUB #hybridx"
  `,
});

const generateStravaDescriptionFlow = ai.defineFlow(
  {
    name: 'generateStravaDescriptionFlow',
    inputSchema: StravaDescriptionInputSchema,
    outputSchema: StravaDescriptionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
