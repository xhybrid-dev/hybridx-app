'use server';

// src/ai/flows/marketing/compose-journey.ts
//
// Prompt in, campaign plan out.
//
// "Win back athletes who cancelled in the last 60 days — three emails over two
// weeks, lead with the race planner" becomes a trigger, an audience, and a
// sequence of email briefs with waits and exit rules between them.
//
// This flow plans; it does not write the emails. Separating the two means the
// plan can be reviewed and edited before any copy is generated, and a single
// email can be redrafted later without disturbing the sequence around it.

import { z } from 'genkit';
import { ai, MODELS } from '@/ai/genkit';
import { HYBRIDX_BRAND_CONTEXT } from '@/ai/brand-context';
import { getPromptKnowledge } from '@/lib/marketing/knowledge';
import { stage } from '@/lib/marketing/stage';
import { ALL_TRIGGERS, TRIGGER_DESCRIPTIONS } from '@/lib/marketing/journeys';

const plannedStepSchema = z.object({
  kind: z.enum(['email', 'wait']),
  /** For an email step: the brief the drafting flow will work from. */
  brief: z.string().optional().describe('What this email must achieve, and the angle to take.'),
  workingTitle: z.string().optional().describe('Short internal label, e.g. "Day 3 — social proof".'),
  /** For a wait step. */
  hours: z.number().optional().describe('Hours to wait before the next step.'),
});

const composeJourneyOutputSchema = z.object({
  name: z.string().describe('Short internal name for this journey.'),
  goal: z.string().describe('One sentence: what this journey is for.'),
  trigger: z.object({
    type: z.enum(ALL_TRIGGERS),
    days: z.number().optional(),
    tag: z.string().optional(),
    /**
     * Narrow an event trigger to one intake route.
     *
     * This is how "welcome the people who took the ATHX guide" differs from
     * "welcome everyone", and without it that request could not be planned:
     * the audience field filters who *stays* in a journey, but the trigger is
     * what decides who enters it in the first place.
     */
    route: z
      .string()
      .optional()
      .describe('Route id from the funnel list in the facts. Event triggers only.'),
  }),
  audienceDescription: z.string().describe('Plain-English description of who should receive this.'),
  audience: z
    .object({
      anyTags: z.array(z.string()).optional(),
      noneTags: z.array(z.string()).optional(),
      subscriptionStatus: z.array(z.string()).optional(),
      maxCompletedWorkouts: z.number().optional(),
      inactiveForDays: z.number().optional(),
    })
    .describe('Machine-readable audience filter, using only tags listed in the facts.'),
  steps: z.array(plannedStepSchema).min(1).max(12),
  exitOnConversion: z
    .enum(['subscriptionActive', 'workoutLogged', 'programStarted', 'none'])
    .describe('What should stop this journey early because its purpose has been met.'),
  reasoning: z.string().describe('Two sentences on why this shape suits the goal.'),
});

export type ComposeJourneyOutput = z.infer<typeof composeJourneyOutputSchema>;

const composeJourneyInputSchema = z.object({
  prompt: z.string().describe("The marketer's description of what they want."),
});

export type ComposeJourneyInput = z.infer<typeof composeJourneyInputSchema>;

const TRIGGER_REFERENCE = Object.entries(TRIGGER_DESCRIPTIONS)
  .map(([name, description]) => `- ${name}: ${description}`)
  .join('\n');

const composeJourneyFlow = ai.defineFlow(
  {
    name: 'composeJourneyFlow',
    inputSchema: composeJourneyInputSchema,
    outputSchema: composeJourneyOutputSchema,
  },
  async ({ prompt }) => {
    const { block } = await stage('compose', 'load business facts', 30_000, getPromptKnowledge);

    const { output } = await stage('compose', 'model call', 100_000, () => ai.generate({
      // Planning quality matters more here than latency — this runs once per
      // journey, and everything downstream inherits its structure.
      model: MODELS.reasoning,
      output: { schema: composeJourneyOutputSchema },
      prompt: `You are a lifecycle marketing strategist for HYBRIDX.

${HYBRIDX_BRAND_CONTEXT}

${block}

## Available triggers
${TRIGGER_REFERENCE}

## Your task
Turn the request below into a concrete campaign plan.

Rules:
- Choose exactly one trigger. Use "manual" for a one-off broadcast the marketer
  will send by hand, and "scheduled" for a one-off with a set date. Use an event
  or derived trigger only when the request describes something that should
  happen automatically for each person.
- A one-off broadcast is a plan with a single email step and no waits.
- Alternate email and wait steps. Never place two email steps back to back.
- Space emails sensibly: a welcome series moves quickly (hours to a couple of
  days); a winback breathes (three to seven days). Never more than five emails.
- Each email brief must state a distinct job. If two briefs could produce the
  same email, merge them.
- Use only tags that appear in the segment list in the facts above. If no tag
  fits, leave audience.anyTags empty and describe the audience in words instead.
- When the request names a funnel — a guide, a magnet, a landing page — set
  trigger.route to that funnel's route id from the list above, and put its tag
  in audience.anyTags as well. The trigger decides who enters; the audience
  decides who qualifies. Setting only one of them is a campaign that reaches
  the wrong people or nobody.
- trigger.route applies to event triggers only. A manual or scheduled broadcast
  is aimed with audience.anyTags alone, because nobody enters it by an event.
- Prefer consentGranted over subscriberCreated for anything that greets a new
  arrival from a confirmed opt-in funnel: someone who has been sent a
  confirmation link has not yet clicked it, and greeting them before they do
  mails an address that never agreed to hear from us.
- Pick exitOnConversion so the journey stops as soon as its purpose is met. A
  winback ends when the subscription becomes active; an activation series ends
  when a workout is logged. Use "none" only for pure newsletters.
- Never invent a price, trial length, programme name or statistic.

## Request
${prompt}`,
    }));

    if (!output) throw new Error('The planner returned no output.');
    return output;
  },
);

export async function composeJourney(input: ComposeJourneyInput): Promise<ComposeJourneyOutput> {
  return composeJourneyFlow(input);
}
