// src/lib/marketing/draft-evaluate.ts
//
// One model answer in, checked blocks and issues out.
//
// Pure, and apart from the flow, so the same function decides both "is this
// draft finished?" in production and in tests — and so the repair loop in
// draft-email.ts and the review screen can never disagree about what counts
// as a problem.

import { blocksToText, type GeneratableBlock } from './blocks';
import { normaliseBrand, parseEmailMarkup, type Destination } from './email-markup';
import type { KnowledgeSnapshot } from './knowledge';
import { validateDraft, validateLinks, type ValidationIssue } from './validate';
import type { DraftModelOutput } from './draft-prompt';

export interface EvaluatedDraft {
  subject: string;
  previewText: string;
  blocks: GeneratableBlock[];
  issues: ValidationIssue[];
}

export function evaluateDraft(
  output: DraftModelOutput,
  context: {
    snapshot: KnowledgeSnapshot;
    destinations: Destination[];
    appUrl: string;
    /** Brief and journey goal: prices the marketer wrote there are theirs. */
    briefText: string;
  },
): EvaluatedDraft {
  const programNames = context.snapshot.programs.map((p) => p.name);
  const subject = normaliseBrand(output.subject.trim(), programNames);
  const previewText = normaliseBrand(output.previewText.trim(), programNames);

  const parsed = parseEmailMarkup(output.body, {
    destinations: context.destinations,
    programNames,
  });

  const facts = validateDraft(
    { subject, body: blocksToText(parsed.blocks) },
    context.snapshot,
    { briefText: context.briefText },
  );
  const links = validateLinks(parsed.blocks, context.appUrl);

  const extra: ValidationIssue[] = [];
  if (previewText && previewText.toLowerCase() === subject.toLowerCase()) {
    extra.push({
      severity: 'warning',
      found: previewText,
      message: 'The preview text repeats the subject. It should add to it.',
    });
  }
  if (!previewText) {
    extra.push({ severity: 'error', found: '(empty)', message: 'The preview text is empty.' });
  }

  return {
    subject,
    previewText,
    blocks: parsed.blocks,
    issues: [...parsed.issues, ...facts.issues, ...links, ...extra],
  };
}

/** Errors the model can be asked to fix — everything blocking except what only a person knows. */
export function repairableIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error' && i.owner !== 'human');
}

export function blockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error');
}
