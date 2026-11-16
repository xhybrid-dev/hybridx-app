'use server';

// src/ai/flows/marketing/revise-block.ts
//
// Rewrite one block on instruction — "shorter", "harder CTA", "less corporate".
//
// Scoped to a single block rather than the whole email. HXMailer's reviser
// regenerated the entire HTML body, so improving one paragraph risked changing
// everything else and losing edits the marketer had already made.
//
// The block goes to the model, and comes back, in the same text format the
// drafter writes (src/lib/marketing/email-markup.ts) rather than as a flat
// JSON block. That format has no field to put words in by mistake, which was
// how a revised heading could come back empty.

import { z } from 'genkit';
import { ai, MODELS } from '@/ai/genkit';
import { HYBRIDX_BRAND_CONTEXT } from '@/ai/brand-context';
import { MERGE_TOKEN_HINT, type GeneratableBlock } from '@/lib/marketing/blocks';
import {
  ADD_LINK,
  blocksToMarkup,
  buildDestinations,
  parseEmailMarkup,
} from '@/lib/marketing/email-markup';
import { formatKnowledgeForDraft, getKnowledgeSnapshot } from '@/lib/marketing/knowledge';
import { validateLinks } from '@/lib/marketing/validate';
import { defaultCtaUrl } from '@/lib/marketing/app-routes';

export interface ReviseBlockInput {
  /** The block to revise. */
  block: unknown;
  /** What to change, e.g. "make it shorter and more direct". */
  instruction: string;
  /** Surrounding copy, so the revision fits. */
  emailContext?: string;
}

const revisionSchema = z.object({
  markup: z.string().describe('The revised block, in the same format it was given in.'),
});

const reviseBlockFlow = ai.defineFlow(
  {
    name: 'reviseBlockFlow',
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: revisionSchema,
  },
  async ({ prompt }) => {
    const { output } = await ai.generate({
      // A single-block rewrite is a small, well-constrained edit, so the faster
      // model is the right trade here.
      model: MODELS.fast,
      output: { schema: revisionSchema },
      prompt,
    });
    if (!output) throw new Error('The revision flow returned no output.');
    return output;
  },
);

/** Every URL a block carries, so it can be offered back as a destination. */
function blockUrls(block: GeneratableBlock): string {
  if (block.type === 'cta') return block.url;
  if (block.type === 'programCard') return block.url ?? '';
  if (block.type === 'image') return `${block.url} ${block.linkUrl ?? ''}`;
  return '';
}

export async function reviseBlock(input: ReviseBlockInput): Promise<GeneratableBlock> {
  const original = input.block as GeneratableBlock;
  const snapshot = await getKnowledgeSnapshot();
  const appUrl = defaultCtaUrl();
  const destinations = buildDestinations(`${blockUrls(original)} ${input.emailContext ?? ''}`, appUrl);
  const programNames = snapshot.programs.map((p) => p.name);

  const destinationLines = destinations.map((d) => `- ${d.key} → ${d.url}`).join('\n');

  const prompt = `You are editing one block of a HYBRIDX marketing email.

${HYBRIDX_BRAND_CONTEXT}

${formatKnowledgeForDraft(snapshot)}

## Format
The block is written in the email's plain-text format:
"# " headline (with an optional supporting line directly under it), "## " heading,
plain paragraph, "- " bullets, "> " quote (last line "> — Name" for attribution),
[button: Label -> destination], [program: Exact Name | description],
[stats: value = label | value = label].
Return the revised block in the same format: one block, the same kind as the
original. No bold, HTML or inline links.

## Button destinations
${destinationLines}
- ${ADD_LINK} → no link available yet

## Rules
- Return the SAME kind of block you were given. Never change the kind.
- Change only what the instruction asks for.
- Preserve any merge tokens present in the original. ${MERGE_TOKEN_HINT}
- Keep the button destination unless the instruction is explicitly about it.
- Never introduce a price, trial length, programme name or statistic that is
  not in the facts above.

${input.emailContext ? `## Surrounding email\n${input.emailContext}\n` : ''}
## Block to revise
${blocksToMarkup([original], destinations)}

## Instruction
${input.instruction}`;

  const { markup } = await reviseBlockFlow({ prompt });
  const parsed = parseEmailMarkup(markup, { destinations, programNames, fragment: true });

  // Same kind only. If the model split a paragraph in two, keep its first part
  // of the right kind rather than replacing the block with something else.
  const revised = parsed.blocks.find((b) => b.type === original.type);
  if (!revised) {
    throw new Error(
      `The revision came back as ${parsed.blocks.map((b) => b.type).join(', ') || 'nothing'}, not a ${original.type} block. Try again or edit by hand.`,
    );
  }

  const blocking = parsed.issues.filter(
    (i) => i.severity === 'error' && i.owner !== 'human' && (i.blockIndex === undefined || parsed.blocks[i.blockIndex] === revised),
  );
  if (blocking.length) throw new Error(blocking[0].message);

  // "Make the button link to the programs page" is exactly the instruction
  // where a link should change — and can be invented just as easily here as
  // in a first draft. Same failure, same check.
  const linkIssues = validateLinks([revised], appUrl);
  if (linkIssues.length) throw new Error(linkIssues[0].message);

  return revised;
}
