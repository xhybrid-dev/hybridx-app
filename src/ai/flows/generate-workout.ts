// src/ai/flows/generate-workout.ts
'use server';
/**
 * @fileOverview AI-driven workout generator for a single, creative session.
 *
 * - generateWorkout - A function that generates a complete, one-off HYROX-style workout.
 * - GenerateWorkoutInput - The input type for the generateWorkout function.
 * - GenerateWorkoutOutput - The return type for the generateWorkout function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { ExerciseSchema } from '@/ai/schemas';

import { assertUser } from '@/lib/api-auth';

const GenerateWorkoutInputSchema = z.object({
  userName: z.string().describe("The user's first name."),
  experience: z.enum(['beginner', 'intermediate', 'advanced']).describe('The user fitness experience level.'),
});
export type GenerateWorkoutInput = z.infer<typeof GenerateWorkoutInputSchema>;

const GenerateWorkoutOutputSchema = z.object({
  title: z.string().describe("A creative and motivating title for the workout (e.g., 'Engine Builder', 'Grip Gauntlet', 'Full Body Blitz')."),
  programType: z.enum(['hyrox', 'running']).describe("The type of workout generated."),
  exercises: z.array(ExerciseSchema).describe('An array of exercises for the workout.'),
  // Omit 'runs' for now to keep the hyrox focus, can be added later if needed.
});
export type GenerateWorkoutOutput = z.infer<typeof GenerateWorkoutOutputSchema>;

export async function generateWorkout(input: GenerateWorkoutInput): Promise<GenerateWorkoutOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:generate-workout', { max: 10 });
  return generateWorkoutFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateWorkoutPrompt',
  input: {schema: GenerateWorkoutInputSchema},
  output: {schema: GenerateWorkoutOutputSchema},
  prompt: `You are an elite strength and conditioning coach specializing in HYROX and functional fitness. Your task is to generate a single, creative, and effective one-off workout for an athlete named {{{userName}}}.

  The workout should be a full session and well-structured. It can be a strength focus, a metabolic conditioning (metcon) piece, a running workout, or a hybrid of both. Be imaginative with the workout structure and title.

  The athlete's experience level is: {{{experience}}}. You MUST tailor the complexity and volume of the workout to this level.
  - Beginners should have simpler movements and lower volume.
  - Intermediate athletes can handle more complex movements and moderate volume.
  - Advanced athletes can be challenged with high-skill movements, heavy weights, and high volume.

  Ensure the output is a valid JSON object matching the provided schema, with a creative title and a list of exercises. For 'programType', choose 'hyrox' for strength/metcon/hybrid workouts and 'running' for pure running sessions.`,
});

const generateWorkoutFlow = ai.defineFlow(
  {
    name: 'generateWorkoutFlow',
    inputSchema: GenerateWorkoutInputSchema,
    outputSchema: GenerateWorkoutOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
