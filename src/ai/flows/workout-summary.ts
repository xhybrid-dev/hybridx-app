
// src/ai/flows/workout-summary.ts
'use server';
/**
 * @fileOverview AI-driven summary for the day's workout.
 *
 * - workoutSummary - A function that generates a short summary and tips for a specific workout.
 * - WorkoutSummaryInput - The input type for the workoutSummary function.
 * - WorkoutSummaryOutput - The return type for the workoutSummary function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const WorkoutSummaryInputSchema = z.object({
  userName: z.string().describe("The user's first name."),
  workoutTitle: z.string().describe('The title of the workout.'),
  exercises: z.string().describe('A comma-separated list of exercises for the workout.'),
  userNotes: z.string().optional().describe("Optional notes from the user about how the workout felt."),
  coachNotes: z.string().optional().describe("What the coach remembers the athlete has told them — time pressure, a niggle, travel, kit they don't have. One per line."),
});
export type WorkoutSummaryInput = z.infer<typeof WorkoutSummaryInputSchema>;

const WorkoutSummaryOutputSchema = z.object({
  summary: z.string().describe("A single, encouraging sentence summarizing the workout's focus with a useful tip, considering the user's notes."),
});
export type WorkoutSummaryOutput = z.infer<typeof WorkoutSummaryOutputSchema>;

export async function workoutSummary(input: WorkoutSummaryInput): Promise<WorkoutSummaryOutput> {
  return workoutSummaryFlow(input);
}

const prompt = ai.definePrompt({
  name: 'workoutSummaryPrompt',
  input: {schema: WorkoutSummaryInputSchema},
  output: {schema: WorkoutSummaryOutputSchema},
  prompt: `You are an AI coach for an athlete named {{{userName}}}.

  Today's workout is "{{{workoutTitle}}}" and includes these exercises: {{{exercises}}}.

  {{#if coachNotes}}
  What {{{userName}}} has told you recently:
  {{{coachNotes}}}

  If any of it bears on today — short on time, a sore knee, no sled where they are, travelling — make your tip the one that helps them get this session done anyway. Don't recite what they told you; just coach as though you remembered.
  {{/if}}

  {{#if userNotes}}
  The user's notes from the session: "{{{userNotes}}}"
  
  Based on the workout and their notes, create a single, encouraging sentence that summarizes the focus and provides a short, actionable tip that relates to their notes if possible.
  Example if user notes mention tired legs: "Great push on today's leg-focused session, {{{userName}}}. Remember to prioritize recovery and stretching for those tired legs!"
  {{else}}
  Based on this, create a single, encouraging sentence that summarizes the focus of the workout and provides a short, actionable tip.
  Example: "Today's focus is on building full-body strength; remember to brace your core on the heavy lifts for stability and power."
  {{/if}}
  `,
});

const workoutSummaryFlow = ai.defineFlow(
  {
    name: 'workoutSummaryFlow',
    inputSchema: WorkoutSummaryInputSchema,
    outputSchema: WorkoutSummaryOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
