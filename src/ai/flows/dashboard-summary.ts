
// src/ai/flows/dashboard-summary.ts
'use server';
/**
 * @fileOverview AI-driven summary for the user dashboard.
 *
 * - dashboardSummary - A function that generates a short coach-style summary of the user's progress.
 * - DashboardSummaryInput - The input type for the dashboardSummary function.
 * - DashboardSummaryOutput - The return type for the dashboardSummary function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

import { assertUser } from '@/lib/api-auth';

const DashboardSummaryInputSchema = z.object({
  userName: z.string().describe('The first name of the user.'),
  programName: z.string().describe('The name of the user active training program.'),
  daysCompleted: z.number().describe('The total number of days the user has completed in their program.'),
  weeklyConsistency: z.string().describe('A brief summary of workouts completed in the last 4 weeks.'),
  todayStravaActivity: z.string().optional().describe("Brief description of any Strava activities the athlete has already completed today, e.g. 'a 10.2km run (52m) and a 45min strength session'."),
  coachNotes: z.string().optional().describe("What the coach remembers the athlete has told them — a holiday, a busy month, a niggle, something they committed to. One per line."),
});
export type DashboardSummaryInput = z.infer<typeof DashboardSummaryInputSchema>;

const DashboardSummaryOutputSchema = z.object({
  summary: z.string().describe('1-2 sentences in the voice of a real sports coach — honest and direct, complimentary when earned, but straightforward when consistency is slipping.'),
});
export type DashboardSummaryOutput = z.infer<typeof DashboardSummaryOutputSchema>;

export async function dashboardSummary(input: DashboardSummaryInput): Promise<DashboardSummaryOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:dashboard', { max: 20 });
  return dashboardSummaryFlow(input);
}

const prompt = ai.definePrompt({
  name: 'dashboardSummaryPrompt',
  input: {schema: DashboardSummaryInputSchema},
  output: {schema: DashboardSummaryOutputSchema},
  prompt: `You are a straight-talking sports coach giving {{{userName}}} a quick daily check-in on their dashboard. You care about results and you're honest, but encouraging — you give credit where it's due, but you don't sugarcoat things when the numbers aren't there.

Write 1–2 short sentences. Sound like a real human coach, not a motivational poster. No hollow phrases like "amazing", "fantastic", "you're crushing it", or "keep up the great work". Use the athlete's first name naturally if it fits.

{{#if coachNotes}}
What this athlete has told you before (remember it without making a show of remembering):
{{{coachNotes}}}

This changes how you read the numbers below. A quiet week you already know was a holiday or a work crunch is not a lapse, and saying it is will cost you their trust. Where it fits, acknowledge it in passing or follow up on it — how the trip went, whether the niggle settled, whether they got in what they said they would.
{{/if}}

Athlete data:
- Program: {{{programName}}}
- Total sessions completed: {{{daysCompleted}}}
- Recent training (last 4 weeks): {{{weeklyConsistency}}}
{{#if todayStravaActivity}}- Already trained today: {{{todayStravaActivity}}}{{/if}}

Coaching tone guidelines — pick the one that fits the data, adjusted for anything you already know:
- Strong, consistent week (3+ sessions, stable or improving trend): genuine but brief acknowledgement, one forward-looking nudge.
- Slight dip this week but solid prior weeks: understand the drop and redirect focus to today and progressing forward.
- Low output for 2+ weeks in a row (1–2 sessions/week): be direct — name the pattern, ask or imply they need to get back on track. Don't pretend it's fine, but be encouraging to motivate the athlete. Unless you already know why (travel, injury, a brutal work stretch) — then meet them where they are and talk about getting going again, not about the gap.
- Very few or zero sessions recently: honest check-in, don't dress it up — "the last couple of weeks have been quiet" type tone.
- Already trained today: acknowledge the specific activity concisely, no gushing. If consistency has been patchy, you can still note that one session doesn't erase the trend.

Never use exclamation marks unless the situation genuinely earns it. Keep the total response under 40 words.`,
});

const dashboardSummaryFlow = ai.defineFlow(
  {
    name: 'dashboardSummaryFlow',
    inputSchema: DashboardSummaryInputSchema,
    outputSchema: DashboardSummaryOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
