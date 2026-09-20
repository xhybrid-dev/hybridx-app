// src/ai/flows/adjust-training-plan.ts
'use server';
/**
 * @fileOverview AI-driven training plan adjuster.
 *
 * - adjustTrainingPlan - Condenses a training plan to a 3 or 4-day plan.
 * - AdjustTrainingPlanInput - The input type for the adjustTrainingPlan function.
 * - AdjustTrainingPlanOutput - The return type for the adjustTrainingPlan function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { WorkoutDaySchema } from '@/ai/schemas';

import { assertUser } from '@/lib/api-auth';

const AdjustTrainingPlanInputSchema = z.object({
  currentWorkouts: z.array(WorkoutDaySchema).describe('The original array of workout objects for a 5-day week.'),
  targetDays: z.enum(['3', '4']).describe('The target number of training days per week.'),
});
export type AdjustTrainingPlanInput = z.infer<typeof AdjustTrainingPlanInputSchema>;

// Internal schema for the prompt, which expects a stringified version of the workouts
const AdjustTrainingPlanPromptInputSchema = z.object({
  workoutsJSON: z.string().describe('The JSON string of the original workout objects.'),
  targetDays: z.enum(['3', '4']),
});

const AdjustTrainingPlanOutputSchema = z.object({
  adjustedWorkouts: z.array(WorkoutDaySchema).describe('The new, condensed array of workout objects for the target number of days.'),
});
export type AdjustTrainingPlanOutput = z.infer<typeof AdjustTrainingPlanOutputSchema>;

export async function adjustTrainingPlan(input: AdjustTrainingPlanInput): Promise<AdjustTrainingPlanOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:adjust-plan', { max: 5 });
  return adjustTrainingPlanFlow(input);
}

const prompt = ai.definePrompt({
  name: 'adjustTrainingPlanPrompt',
  input: {schema: AdjustTrainingPlanPromptInputSchema},
  output: {schema: AdjustTrainingPlanOutputSchema},
  prompt: `You are an expert strength and conditioning coach. Your task is to intelligently condense a training plan into a {{{targetDays}}}-day plan.

  Each workout has an "exercises" array (strength/gym work) and a "runs" array (running segments). Both can be populated on the same day for hybrid sessions. Empty arrays mean no work of that type is scheduled.

  **CRITICAL INSTRUCTIONS:**
  1.  **Analyze the Plan:** Review the original workouts to understand the weekly structure, intensity, and goals (strength days, run days, hybrid sessions, recovery).

  2.  **Prioritize & Combine:**
      *   Identify the most critical workouts that must be kept.
      *   Combine complementary sessions when reducing days — for example, a short run can be added after a strength session to create a hybrid day.
      *   Lower priority workouts (secondary recovery sessions, light accessory work) can be dropped if necessary.
      *   Avoid pairing heavy leg strength with intense interval running on the same day.

  3.  **Smart Weekly Distribution:**
      *   The final output MUST contain exactly {{{targetDays}}} workout objects.
      *   Spread workouts intelligently throughout the 7-day week with proper recovery placement.
      *   **DO NOT cluster all workouts at the end of the week.**
      *   Place rest days strategically, especially after heavy or hybrid sessions.
      *   For 3-day plans: use days 1, 3, 5 (or similar alternating pattern).
      *   For 4-day plans: use days 1, 2, 4, 5 (or 1, 3, 4, 6) with rest after heavy sessions.

  4.  **Maintain Integrity:** Retain the program's core effectiveness in a condensed format.

  **Original Plan:**
  {{{workoutsJSON}}}

  Generate the adjusted {{{targetDays}}}-day workout plan. Each workout must have both an "exercises" array and a "runs" array (either or both can be empty).`,
});

const adjustTrainingPlanFlow = ai.defineFlow(
  {
    name: 'adjustTrainingPlanFlow',
    inputSchema: AdjustTrainingPlanInputSchema,
    outputSchema: AdjustTrainingPlanOutputSchema,
  },
  async input => {
    const workoutsJSON = JSON.stringify(input.currentWorkouts);
    const {output} = await prompt({ workoutsJSON, targetDays: input.targetDays });
    return output!;
  }
);
