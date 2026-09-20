// src/ai/flows/parse-treadmill-workout.ts
'use server';
/**
 * @fileOverview AI parser that digests free-text treadmill workout information
 * into structured segments for the treadmill file fixer.
 *
 * Information priority (per product spec):
 *   1. The user's workout notes — what was ACTUALLY run. These win whenever
 *      they describe structure (splits, paces, inclines).
 *   2. The planned/prescribed workout — used to fill gaps or as the full
 *      structure when the notes carry no usable detail.
 * Anything the text does not state is returned as an empty string so the
 * user can fill it in manually (priority 3).
 *
 * - parseTreadmillWorkout - Parse notes + plan into treadmill segments.
 * - ParseTreadmillWorkoutInput - Input type.
 * - ParseTreadmillWorkoutOutput - Output type.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

import { assertUser } from '@/lib/api-auth';

const ParsedTreadmillSegmentSchema = z.object({
  name: z
    .string()
    .describe('Short label for the segment, e.g. "0–5 min", "Interval 3/6", "Warm-up".'),
  mode: z
    .enum(['time', 'distance'])
    .describe('Whether the segment is defined by its duration or by its distance.'),
  value: z
    .string()
    .describe(
      'Duration as "mm:ss" when mode is "time" (e.g. "5:00", "2:30"); distance in km as a decimal string when mode is "distance" (e.g. "0.4", "2").',
    ),
  pace: z
    .string()
    .describe(
      'Running pace per km as "mm:ss" (e.g. "6:00", "4:30"). Empty string "" when the text does not state or clearly imply a pace.',
    ),
  incline: z
    .string()
    .describe(
      'Treadmill incline percent as a decimal string (e.g. "5", "2.5"). "0" when the text says flat/no incline. Empty string "" when unknown.',
    ),
});
export type ParsedTreadmillSegment = z.infer<typeof ParsedTreadmillSegmentSchema>;

const ParseTreadmillWorkoutInputSchema = z.object({
  workoutTitle: z.string().optional().describe('Title of the workout session.'),
  notes: z
    .string()
    .optional()
    .describe("The user's free-text workout notes describing what they actually ran."),
  plannedWorkout: z
    .string()
    .optional()
    .describe(
      'Description of the prescribed workout: free text and/or a JSON list of planned runs (type, distance km, target pace sec/km, description, interval count).',
    ),
  activityMovingTimeSec: z
    .number()
    .optional()
    .describe('Moving time in seconds that the watch recorded, for sanity-checking totals.'),
});
export type ParseTreadmillWorkoutInput = z.infer<typeof ParseTreadmillWorkoutInputSchema>;

const ParseTreadmillWorkoutOutputSchema = z.object({
  segments: z
    .array(ParsedTreadmillSegmentSchema)
    .describe('The workout as an ordered list of treadmill segments. Empty if nothing parseable.'),
  source: z
    .enum(['notes', 'planned', 'both', 'none'])
    .describe(
      'Where the structure came from: "notes" (user notes), "planned" (prescribed workout), "both" (notes structure with gaps filled from the plan), or "none" (nothing parseable).',
    ),
  summary: z
    .string()
    .describe('One short sentence describing what was parsed, e.g. "8 segments from your workout notes".'),
});
export type ParseTreadmillWorkoutOutput = z.infer<typeof ParseTreadmillWorkoutOutputSchema>;

export async function parseTreadmillWorkout(
  input: ParseTreadmillWorkoutInput,
): Promise<ParseTreadmillWorkoutOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:parse-treadmill', { max: 10 });
  return parseTreadmillWorkoutFlow(input);
}

const prompt = ai.definePrompt({
  name: 'parseTreadmillWorkoutPrompt',
  input: {schema: ParseTreadmillWorkoutInputSchema},
  output: {schema: ParseTreadmillWorkoutOutputSchema},
  config: { temperature: 0.1 },
  prompt: `You convert messy, shorthand treadmill workout text into a precise list of structured segments. Accuracy matters: the output is used to rebuild a workout file, so never invent numbers that are not stated or clearly implied.

**Source priority:**
1. WORKOUT NOTES describe what the athlete ACTUALLY ran. If they contain any usable structure (time splits, distances, paces, inclines), build the segments from the notes. Use the planned workout only to fill gaps the notes leave open (source: "both") — e.g. the plan states an incline the notes omit.
2. If the notes are missing, empty, or carry no parseable structure (e.g. "felt great today"), build the segments from the PLANNED WORKOUT instead (source: "planned").
3. If neither contains usable structure, return an empty segments array with source "none".

**How to read shorthand (be liberal — athletes type fast):**
- Minute ranges like "0-5", "5-10", "32:30-35" are start–end times of the segment. Convert to a duration: "0-5" → mode "time", value "5:00"; "32:30 -35" → value "2:30". Use ranges to keep segments in chronological order.
- Pace notations "6minkm", "6 min km", "6:00/km", "6:00 pace", "@ 4:30" all mean a pace per km: pace "6:00" / "4:30". A bare "3:30" next to a time range is almost always the pace.
- Speeds like "12kmh", "12 km/h" convert to pace: pace per km = 60 ÷ speed minutes (12 km/h → "5:00").
- Percentages like "5%", "incline 5", "@5 incline" are the treadmill incline: incline "5". A range like "4-5%" becomes the midpoint: "4.5".
- Distance segments: "2km @ 5:30", "400m reps" → mode "distance", value in km ("2", "0.4").
- Interval prescriptions like "6 x 400m @ 4:30 w/ 90s jog recovery" expand into individual segments, alternating work and recovery (work: mode "distance" value "0.4" pace "4:30"; recovery: mode "time" value "1:30", pace only if stated). Name them "Interval 1/6", "Recovery 1/5", etc.
- Warm-up / cool-down mentions with a time or distance become their own segments.
- RPE, heart rate ("HR 150", "Z2"), cadence and calorie numbers are NOT paces or inclines — ignore them as segment values.
- Total-only descriptions ("35 min steady 4-5% incline") become a single segment: mode "time", value "35:00", incline "4.5", pace "" unless stated.

**Unknown fields:** if a segment's pace or incline is not stated and not clearly implied by its context, return "" (empty string) for that field — the athlete fills it in by hand. Never guess a pace from an effort word alone ("easy", "steady"). For planned runs given as JSON, a "targetPace" in seconds per km converts to "mm:ss" (390 → "6:30").

**Sanity checks:** keep segments in chronological order; keep it to at most 60 segments; when a recorded moving time is provided and your parsed total is wildly different, re-read the text — you likely misread a range or unit.

**Worked example** — notes:
"0-5 - 6minkm 5%
5-10 5 minkm 6%
10-15 4 min km 1%
15-20 8 min km 10%
20 -25 6minkm 5%
25 -30 5 minkm 6%
30-32:30 4 minkm 1%
32:30 -35 3:30 1%"
parses to eight time segments of 5:00 / 5:00 / 5:00 / 5:00 / 5:00 / 5:00 / 2:30 / 2:30 with paces 6:00, 5:00, 4:00, 8:00, 6:00, 5:00, 4:00, 3:30 and inclines 5, 6, 1, 10, 5, 6, 1, 1 (source "notes").

**Input:**
{{#if workoutTitle}}- Workout title: {{{workoutTitle}}}{{/if}}
{{#if activityMovingTimeSec}}- Recorded moving time: {{{activityMovingTimeSec}}} seconds{{/if}}
{{#if notes}}- WORKOUT NOTES:
"""
{{{notes}}}
"""{{else}}- WORKOUT NOTES: (none){{/if}}
{{#if plannedWorkout}}- PLANNED WORKOUT:
"""
{{{plannedWorkout}}}
"""{{else}}- PLANNED WORKOUT: (none){{/if}}`,
});

const parseTreadmillWorkoutFlow = ai.defineFlow(
  {
    name: 'parseTreadmillWorkoutFlow',
    inputSchema: ParseTreadmillWorkoutInputSchema,
    outputSchema: ParseTreadmillWorkoutOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  },
);
