'use server';

// src/ai/flows/marketing/draft-email.ts
//
// One email brief becomes structured content.
//
// The output is a typed block array, never HTML. The model chooses structure
// and words; src/lib/marketing/render.ts owns every visual decision. See
// src/lib/marketing/blocks.ts for why.
//
// Output is fact-checked against the same knowledge snapshot that produced it
// before it is returned, so a draft citing a wrong price never reaches the
// review screen looking finished.

import { z } from 'genkit';
import { ai, MODELS, STRUCTURED_CONFIG } from '@/ai/genkit';
import {
  aiEmailContentSchema,
  toEmailBlocks,
  emailContentSchema,
  blocksToText,
  missingContent,
} from '@/lib/marketing/blocks';
import {
  buildDraftPrompt,
  draftEmailInputSchema,
  type DraftEmailInput,
} from '@/lib/marketing/draft-prompt';
import { getPromptKnowledge } from '@/lib/marketing/knowledge';
import { validateDraft, validateLinks, type ValidationIssue } from '@/lib/marketing/validate';
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
}

const draftEmailFlow = ai.defineFlow(
  {
    name: 'draftEmailFlow',
    inputSchema: draftEmailInputSchema,
    outputSchema: aiEmailContentSchema,
  },
  async (input) => {
    const { block } = await stage('draft', 'load business facts', 30_000, getPromptKnowledge);

    const { output } = await stage('draft', 'model call', 100_000, () =>
      ai.generate({
        model: MODELS.reasoning,
        config: STRUCTURED_CONFIG,
        output: { schema: aiEmailContentSchema },
        prompt: buildDraftPrompt(input, block),
      }),
    );

    if (!output) throw new Error('The drafting flow returned no output.');
    return output;
  },
);

/**
 * Draft an email and fact-check it.
 *
 * Validation runs here rather than in the UI so every caller gets it — the
 * studio, a regenerate action, and any future batch drafting all inherit the
 * same gate.
 */
export async function draftEmail(input: DraftEmailInput): Promise<DraftEmailResult> {
  const content = await draftEmailFlow(input);
  const { snapshot } = await getPromptKnowledge();

  // Gemini is asked for the flat block shape (see blocks.ts); narrow it back to
  // the strict union before anything renders or validates.
  const { blocks, rejected, salvaged } = toEmailBlocks(content.blocks, { salvage: true });

  const { ok, issues } = validateDraft(
    { subject: content.subject, body: blocksToText(blocks) },
    snapshot,
    { briefText: `${input.brief} ${input.journeyGoal ?? ''}` },
  );

  // A block the model left incomplete is kept in place, blank where it left a
  // gap, and flagged so the reviewer completes it instead of finding it gone.
  const salvagedIssues: ValidationIssue[] = salvaged.flatMap((r) => {
    const missing = missingContent(blocks[r.index]);
    return [
      {
        severity: 'error' as const,
        kind: 'structure' as const,
        blockIndex: r.index,
        found: `${r.type} (block ${r.index + 1})`,
        message: `The model left this ${r.type} block incomplete (${r.reason}). Fill in ${missing.join(' and ') || 'the missing fields'} below, or delete the block.`,
      },
    ];
  });

  // A dropped block makes the email shorter than the model intended, which is
  // not something the reviewer should have to notice for themselves.
  const blockIssues: ValidationIssue[] = rejected.map((r) => ({
    severity: 'error',
    kind: 'structure',
    found: r.type,
    message: `The model returned a ${r.type} block that was not usable and has been dropped (${r.reason}). Redraft, or add the block by hand.`,
  }));

  // Checked against the blocks, not the flattened text validateDraft uses —
  // a URL is not something blocksToText surfaces at all.
  const linkIssues = validateLinks(
    blocks,
    defaultCtaUrl(),
  );

  return {
    subject: content.subject,
    previewText: content.previewText,
    blocks,
    html: renderBlocks(blocks, { previewText: content.previewText }),
    text: renderBlocksAsText(blocks),
    issues: [...issues, ...blockIssues, ...salvagedIssues, ...linkIssues],
    valid: ok && rejected.length === 0 && salvaged.length === 0 && linkIssues.length === 0,
  };
}
