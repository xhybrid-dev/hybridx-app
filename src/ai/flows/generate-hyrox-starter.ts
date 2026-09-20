// src/ai/flows/generate-hyrox-starter.ts
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { ExerciseSchema } from '@/ai/schemas';

import { assertUser } from '@/lib/api-auth';

const GenerateHyroxStarterInputSchema = z.object({
  userName: z.string().describe("The user's first name."),
});

const StarterWorkoutSchema = z.object({
  day: z.number().describe('Day number within the plan: 1, 2, or 3.'),
  title: z.string().describe('A punchy, motivating title for the session (e.g. "Foundation Builder", "Engine Room", "Full Circuit").'),
  exercises: z.array(ExerciseSchema).describe('Exercises for this session — clear sets/reps/durations.'),
  // z.enum, not z.literal: literals compile to `const`, which Gemini's
  // responseSchema rejects with a 400. See src/lib/marketing/blocks.ts.
  programType: z.enum(['hyrox']),
});

const GenerateHyroxStarterOutputSchema = z.object({
  workouts: z
    .array(StarterWorkoutSchema)
    .length(3)
    .describe('Three distinct beginner Hyrox sessions: Day 1 strength, Day 2 cardio/conditioning, Day 3 full-body hybrid.'),
});

export type GenerateHyroxStarterOutput = z.infer<typeof GenerateHyroxStarterOutputSchema>;

export async function generateHyroxStarter(input: {
  userName: string;
}): Promise<GenerateHyroxStarterOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:hyrox-starter', { max: 5 });
  return generateHyroxStarterFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateHyroxStarterPrompt',
  input: { schema: GenerateHyroxStarterInputSchema },
  output: { schema: GenerateHyroxStarterOutputSchema },
  prompt: `You are an elite HYROX coach building a 3-session beginner starter plan for {{{userName}}}, who just joined the platform and hasn't committed to a full program yet.

Create 3 distinct, beginner-friendly Hyrox-style sessions:

**Day 1 — Strength Foundation**
Focus on compound, accessible movements. Think squats, deadlifts, lunges, push-ups, dumbbell rows. Clear rep schemes (e.g. 3×10). Builds base strength relevant to Hyrox race stations.

**Day 2 — Cardio & Conditioning**
Hyrox-specific cardio work. Use: rowing machine (500m–1km pieces), ski erg intervals, assault bike, farmers carry, sled push simulation (weighted plate pushes), burpee broad jumps, wall balls. Keep it high-energy, accessible.

**Day 3 — Full-Body Hybrid**
Combines short runs (if possible) with functional strength and core. Circuit-style. Think AMRAP or For-Time formats. Uses wall balls, sandbag lunges, pull-ups/ring rows, kettlebell swings, box jumps, core work.

Rules:
- All workouts must be completable in 30–45 minutes by a beginner
- No Olympic lifting, no complex gymnastics, no heavy barbell cycling
- Use encouraging, action-oriented language in titles
- Provide specific, unambiguous exercise details (sets × reps, duration, or distance)
- Keep movement selection consistent with what HYROX athletes train`,
});

const generateHyroxStarterFlow = ai.defineFlow(
  {
    name: 'generateHyroxStarterFlow',
    inputSchema: GenerateHyroxStarterInputSchema,
    outputSchema: GenerateHyroxStarterOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
