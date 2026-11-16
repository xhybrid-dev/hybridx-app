'use server';

// src/ai/flows/marketing/draft-email.ts
//
// One email brief becomes checked, structured content.
//
//   1. Draft.   The model writes the email as a short Markdown-like document
//               (src/lib/marketing/email-markup.ts) plus a one-line angle.
//               Structured output is four strings, so there is no block-array
//               grammar limit and no per-type field confusion.
//   2. Check.   The document is parsed into the strict blocks render.ts uses,
//               then fact-checked and link-checked against the same knowledge
//               snapshot that produced it.
//   3. Repair.  Any error the model can fix is sent back to it with the exact
//               message, up to twice, inside a time budget. What reaches the
//               reviewer is either clean or carries only issues a person must
//               resolve (a link the brief never gave).
//
// The output is still a typed block array, never HTML. The model chooses
// structure and words; render.ts owns every visual decision.

import { z } from 'genkit';
import { ai, MODELS, STRUCTURED_CONFIG } from '@/ai/genkit';
import { emailContentSchema } from '@/lib/marketing/blocks';
import {
  buildDraftPrompt,
  buildRepairPrompt,
  draftEmailInputSchema,
  type DraftEmailInput,
  type DraftModelOutput,
} from '@/lib/marketing/draft-prompt';
import { formatKnowledgeForDraft, getKnowledgeSnapshot } from '@/lib/marketing/knowledge';
import { buildDestinations } from '@/lib/marketing/email-markup';
import {
  blockingIssues,
  evaluateDraft,
  repairableIssues,
  type EvaluatedDraft,
} from '@/lib/marketing/draft-evaluate';
import type { ValidationIssue } from '@/lib/marketing/validate';
import { defaultCtaUrl } from '@/lib/marketing/app-routes';
import { stage } from '@/lib/marketing/stage';
import { renderBlocks, renderBlocksAsText } from '@/lib/marketing/render';

export type { DraftEmailInput };

export interface DraftEmailResult {
  subject: string;
  previewText: string;
  blocks: z.infer<typeof emailContentSchema>['blocks'];
  html: string;
  text: string;
  /** Fact-check findings. Errors mean the draft should not be sent as-is. */
  issues: ValidationIssue[];
  valid: boolean;
  /** The model's one-line statement of who this is for and what it asks. */
  angle?: string;
  /** Model calls it took: 1 is a clean first draft, more means repairs ran. */
  attempts?: number;
}

const aiDraftSchema = z.object({
  // First, so the model commits to a reader and an action before writing.
  angle: z
    .string()
    .describe('One sentence: who this reader is right now and the single action this email gets them to take.'),
  subject: z.string().describe('Under 60 characters.'),
  previewText: z.string().describe('One short sentence that adds to the subject.'),
  body: z.string().describe('The whole email in the body format described in the prompt.'),
});

/**
 * Total server time for one email, including repairs. The studio abandons an
 * action at 150s, so this stays well inside it: a repair is only attempted
 * when there is still time for it to finish.
 */
const DRAFT_BUDGET_MS = 125_000;
const FIRST_CALL_TIMEOUT_MS = 100_000;
const MIN_REPAIR_WINDOW_MS = 30_000;
const MAX_REPAIRS = 2;

const draftEmailModelFlow = ai.defineFlow(
  {
    name: 'draftEmailFlow',
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: aiDraftSchema,
  },
  async ({ prompt }) => {
    const { output } = await ai.generate({
      model: MODELS.reasoning,
      config: STRUCTURED_CONFIG,
      output: { schema: aiDraftSchema },
      prompt,
    });
    if (!output) throw new Error('The drafting model returned no output.');
    return output;
  },
);

/**
 * Draft an email, check it, and have the model repair what it can.
 *
 * Validation runs here rather than in the UI so every caller gets it — the
 * studio, the weekly brief, and any future batch drafting all inherit the
 * same gate and the same repair loop.
 */
export async function draftEmail(input: DraftEmailInput): Promise<DraftEmailResult> {
  const started = Date.now();
  const parsedInput = draftEmailInputSchema.parse(input);

  const snapshot = await stage('draft', 'load business facts', 30_000, getKnowledgeSnapshot);
  const appUrl = defaultCtaUrl();
  const briefText = `${parsedInput.brief} ${parsedInput.journeyGoal ?? ''}`;
  const destinations = buildDestinations(briefText, appUrl);
  const prompt = buildDraftPrompt(parsedInput, {
    facts: formatKnowledgeForDraft(snapshot),
    destinations,
  });

  const evaluate = (output: DraftModelOutput) =>
    evaluateDraft(output, { snapshot, destinations, appUrl, briefText });

  let output: DraftModelOutput = await stage('draft', 'model call', FIRST_CALL_TIMEOUT_MS, () =>
    draftEmailModelFlow({ prompt }),
  );
  let attempts = 1;
  let best: { output: DraftModelOutput; result: EvaluatedDraft } = { output, result: evaluate(output) };

  for (let repair = 1; repair <= MAX_REPAIRS; repair++) {
    const toFix = repairableIssues(best.result.issues);
    if (!toFix.length) break;

    const remaining = DRAFT_BUDGET_MS - (Date.now() - started);
    if (remaining < MIN_REPAIR_WINDOW_MS) break;

    try {
      output = await stage('draft', `repair ${repair}`, remaining - 5_000, () =>
        draftEmailModelFlow({ prompt: buildRepairPrompt(prompt, best.output, toFix) }),
      );
    } catch {
      // A repair that fails or runs out of time leaves the best draft so far,
      // with its issues shown — still more useful than an error.
      break;
    }
    attempts++;

    const result = evaluate(output);
    // Keep whichever attempt has fewer blocking problems. A repair that makes
    // things worse (it happens) must not replace a better draft.
    if (blockingIssues(result.issues).length <= blockingIssues(best.result.issues).length) {
      best = { output, result };
    }
  }

  const { subject, previewText, blocks, issues } = best.result;
  console.log(
    `[studio:draft] done in ${Date.now() - started}ms, ${attempts} call(s), ` +
      `${blocks.length} blocks, ${blockingIssues(issues).length} blocking issue(s)`,
  );

  return {
    subject,
    previewText,
    blocks,
    html: renderBlocks(blocks, { previewText }),
    text: renderBlocksAsText(blocks),
    issues,
    valid: blockingIssues(issues).length === 0,
    angle: best.output.angle,
    attempts,
  };
}
