'use server';

// src/ai/flows/marketing/judge-email.ts
//
// A model scores a drafted email against a fixed rubric.
//
// Used only by the drafting eval, never in the studio: it measures whether a
// prompt change made drafts better across the whole case set. A judge is
// noisy on any one email, so read its averages across a run, not a single
// score. The rubric is spelled out with anchors so a 3 means the same thing
// from one run to the next.

import { z } from 'genkit';
import { ai, MODELS, STRUCTURED_CONFIG } from '@/ai/genkit';

const judgeSchema = z.object({
  oneAction: z.number().describe('1–5: the whole email drives one clear action.'),
  readerFirst: z.number().describe("1–5: opens on the reader's situation, not the brand."),
  specificity: z.number().describe('1–5: concrete HYROX / brief detail rather than generic fitness copy.'),
  voice: z.number().describe('1–5: concise, direct, motivating, honest; no clichés or corporate tone.'),
  briefFidelity: z.number().describe('1–5: does exactly what the brief asked, about what the brief named.'),
  weakness: z.string().describe('The single biggest weakness, in one sentence.'),
});

export type JudgeScores = z.infer<typeof judgeSchema>;

const judgeEmailFlow = ai.defineFlow(
  {
    name: 'judgeEmailFlow',
    inputSchema: z.object({ brief: z.string(), email: z.string() }),
    outputSchema: judgeSchema,
  },
  async ({ brief, email }) => {
    const { output } = await ai.generate({
      model: MODELS.reasoning,
      config: STRUCTURED_CONFIG,
      output: { schema: judgeSchema },
      prompt: `You are a demanding email marketing editor reviewing a draft for HYBRIDX, a brand for HYROX athletes.

Score the email from 1 to 5 on each criterion. Anchors:
5 = would send as-is; better than most professional lifecycle email.
4 = good; one small edit.
3 = acceptable but generic or slightly off; needs a real edit.
2 = weak; needs rewriting.
1 = fails the criterion.

Criteria:
- oneAction: the email exists to get the reader to do one thing, and every part moves toward it.
- readerFirst: it opens on the reader's situation or goal, not on the brand or a feature list.
- specificity: concrete, HYROX- or brief-specific detail; not interchangeable with any fitness app's email.
- voice: concise, direct, motivating and honest. Penalise clichés, hype, exclamation, waffle, corporate tone.
- briefFidelity: it does what the brief asked, about what the brief named, and adds nothing the brief did not ask for.

Be strict. Most first drafts are a 3.

## Brief
${brief}

## Email
${email}`,
    });
    if (!output) throw new Error('The judge returned no output.');
    const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
    return {
      ...output,
      oneAction: clamp(output.oneAction),
      readerFirst: clamp(output.readerFirst),
      specificity: clamp(output.specificity),
      voice: clamp(output.voice),
      briefFidelity: clamp(output.briefFidelity),
    };
  },
);

export async function judgeEmail(input: { brief: string; email: string }): Promise<JudgeScores> {
  return judgeEmailFlow(input);
}
