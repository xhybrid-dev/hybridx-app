'use server';
// src/ai/flows/training-load-analysis.ts
// AI flow that analyses an athlete's Strava training load metrics and provides
// holistic coaching advice on fatigue, overtraining risk, and training balance.

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

import { assertUser } from '@/lib/api-auth';

const TrainingLoadAnalysisInputSchema = z.object({
  userName: z.string(),
  userGoal: z.string().describe("e.g. 'strength', 'endurance', 'hybrid'"),
  trainingSummaryText: z.string().describe("Formatted training load summary from Strava data."),
  upcomingWorkouts: z.string().optional().describe("Brief description of next 3–7 days of planned training."),
  userQuestion: z.string().optional().describe("Optional specific question from the athlete."),
});

export type TrainingLoadAnalysisInput = z.infer<typeof TrainingLoadAnalysisInputSchema>;

const TrainingLoadAnalysisOutputSchema = z.object({
  fatigueAssessment: z.string().describe("Plain-English assessment of the athlete's current fatigue and readiness."),
  trainingBalance: z.string().describe("Commentary on the mix of training types (running, strength, cycling etc.) vs their goal."),
  recommendations: z.array(z.string()).describe("3–5 specific, actionable recommendations."),
  weekAhead: z.string().describe("Tailored advice for the coming week given current load."),
  riskFlags: z.array(z.string()).describe("Any overtraining, undertraining, or imbalance flags. Empty array if none."),
});

export type TrainingLoadAnalysisOutput = z.infer<typeof TrainingLoadAnalysisOutputSchema>;

export async function analyzeTrainingLoad(
  input: TrainingLoadAnalysisInput,
): Promise<TrainingLoadAnalysisOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:training-load', { max: 10 });
  return trainingLoadAnalysisFlow(input);
}

const prompt = ai.definePrompt({
  name: 'trainingLoadAnalysisPrompt',
  input: { schema: TrainingLoadAnalysisInputSchema },
  output: { schema: TrainingLoadAnalysisOutputSchema },
  prompt: `You are an elite endurance and hybrid performance coach with deep expertise in training periodisation, fatigue management, and athlete readiness. You use data-driven analysis — specifically ATL (Acute Training Load), CTL (Chronic Training Load), and TSB (Training Stress Balance) — to guide athletes.

**Athlete Profile:**
- Name: {{{userName}}}
- Training Goal: {{{userGoal}}}

**Current Training Load Data (from Strava):**
{{{trainingSummaryText}}}

{{#if upcomingWorkouts}}
**Planned Training This Week:**
{{{upcomingWorkouts}}}
{{/if}}

{{#if userQuestion}}
**Athlete's Specific Question:**
"{{{userQuestion}}}"
{{/if}}

**Your Task:**

1. **Fatigue Assessment**: Interpret the ATL, CTL, and TSB values.
   - TSB strongly negative (< −25): athlete is accumulating fatigue, overreaching risk.
   - TSB near zero (−10 to +10): athlete is in active training, normal.
   - TSB positive (> +10): athlete is fresh, may be tapering or undertrained.
   - Compare ATL vs CTL to determine if this week is harder or easier than their recent baseline.

2. **Training Balance**: Assess the mix of activity types vs the athlete's goal:
   - Hybrid/HYROX athletes should balance running, strength, and possibly rowing.
   - Endurance athletes should have a majority of running/cycling/swimming.
   - Strength athletes need sufficient strength volume.
   - Flag if one modality is disproportionately dominant or absent.

3. **Recommendations**: Provide 3–5 specific, actionable suggestions for the coming days (e.g., "Include a full rest day before your next intense session", "Your cycling volume is high — consider swapping one ride for a strength session").

4. **Week Ahead**: Given current load and any planned training, give tailored guidance on how to approach the next 7 days.

5. **Risk Flags**: Identify any red flags such as:
   - 3+ consecutive high-load days
   - No recovery/easy days visible in recent data
   - Sudden spike in weekly load vs CTL baseline
   - Complete absence of a key training modality for the athlete's goal
   - If there are no concerns, return an empty array.

Be specific, data-led, and encouraging. Reference actual numbers from the data. Avoid generic fitness advice.`,
});

const trainingLoadAnalysisFlow = ai.defineFlow(
  {
    name: 'trainingLoadAnalysisFlow',
    inputSchema: TrainingLoadAnalysisInputSchema,
    outputSchema: TrainingLoadAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  },
);
