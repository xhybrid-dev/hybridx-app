// src/lib/marketing/validate.ts
//
// Post-generation fact checking.
//
// Prompting a model to use only supplied facts works most of the time. "Most of
// the time" is not good enough when the output goes to thousands of people
// under your own brand, so every generated draft is checked against the same
// snapshot that produced it before a human ever sees it.
//
// This deliberately checks a small number of things very reliably rather than
// attempting general truth-checking: prices, trial lengths, programme names and
// fabricated statistics are the claims that (a) recur, (b) are checkable
// mechanically, and (c) cause real damage when wrong.

import type { KnowledgeSnapshot } from './knowledge';
import { emailBlockSchema, missingContent, type EmailBlock } from './blocks';
import { isKnownAppPath } from './app-routes';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  /**
   * What kind of problem this is.
   *
   * 'fact' means a claim in the copy could not be matched against live data —
   * a price, a trial length, a programme name. 'structure' means the model's
   * output was not usable as a block and something was dropped. They surface
   * together but are not the same thing, and calling a dropped heading "a
   * claim that could not be verified against live HYBRIDX data" sends the
   * reader looking for a pricing error that does not exist.
   *
   * Optional so existing producers default to 'fact', which is what they are.
   */
  kind?: 'fact' | 'structure';
  /** Zero-based index of the block this concerns, when it concerns one. */
  blockIndex?: number;
  /** What was found, quoted from the draft. */
  found: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Currency amounts, e.g. £5, £5.99, $10, €7/month. */
const PRICE_PATTERN = /[£$€]\s?\d+(?:\.\d{1,2})?/g;

/** Trial-length claims, e.g. "14-day free trial", "free for 30 days", "1-month trial". */
const TRIAL_PATTERNS = [
  /(\d+)[-\s]?day(?:s)?\s+(?:free\s+)?trial/gi,
  /(?:free|trial)\s+for\s+(\d+)\s+days?/gi,
  /(\d+)[-\s]?(?:month|week)(?:s)?\s+(?:free\s+)?trial/gi,
  /(?:one|two|three)[-\s]?month\s+(?:free\s+)?trial/gi,
];

/** Statistic-shaped claims the model has no basis for, e.g. "87% of athletes". */
const STAT_PATTERN = /\b\d{1,3}(?:\.\d+)?%\s+of\s+(?:our\s+)?(?:athletes|users|members|customers|hyrox)/gi;

/** Strip HTML so checks run against the words a reader will actually see. */
function toText(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Normalise a programme name for comparison: lowercase, punctuation-insensitive. */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Check that every block is still a shape the app can render.
 *
 * Every block reaching here was, at some point, a real `EmailBlock` — it did
 * not need this check when the only way to produce one was `toEmailBlocks`,
 * which already narrows AI output through this same schema and drops
 * anything that fails it. What changed is that a block can now be hand-edited
 * in the campaign editor: clear a bulletList's textarea down to nothing, or a
 * hero's headline, and the in-memory object is no longer a valid block, but
 * nothing stopped `updateCampaignContent` from writing it to Firestore anyway
 * — the render or the send would have been where it surfaced, not the editor.
 */
export function validateBlockShapes(blocks: EmailBlock[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  blocks.forEach((block, index) => {
    const parsed = emailBlockSchema.safeParse(block);
    if (parsed.success) {
      // Present but blank is as unusable as absent — a button with no link.
      const missing = missingContent(block);
      if (missing.length) {
        issues.push({
          severity: 'error',
          kind: 'structure',
          blockIndex: index,
          found: `${block.type} (block ${index + 1})`,
          message: `This ${block.type} block needs its ${missing.join(' and ')} filled in before it can be sent.`,
        });
      }
      return;
    }

    const reason = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    issues.push({
      severity: 'error',
      kind: 'structure',
      blockIndex: index,
      found: `${block.type} (block ${index + 1})`,
      message: `This ${block.type} block is incomplete and would not render correctly: ${reason}.`,
    });
  });

  return issues;
}

/**
 * Check every link in the blocks against the app's real routes.
 *
 * Separate from `validateDraft` because it needs the blocks themselves, not
 * the flattened text `validateDraft` checks against — the one place a URL
 * exists in a drafted email is inside a block, and blockText deliberately
 * does not surface it (a URL is not something a reader reads aloud, so it was
 * never part of the "text a person sees" that function extracts).
 */
export function validateLinks(blocks: EmailBlock[], appUrl: string): ValidationIssue[] {
  const appHost = (() => {
    try {
      return new URL(appUrl).host;
    } catch {
      return null;
    }
  })();

  const issues: ValidationIssue[] = [];
  const check = (raw: string | undefined, where: string) => {
    if (!raw) return;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      issues.push({
        severity: 'error',
        kind: 'fact',
        found: raw,
        message: `${where} is not a valid URL.`,
      });
      return;
    }
    // Only app.hybridx.club links are checkable against a route list — an
    // external link (a Strava post, a HYROX event page) is legitimately
    // outside it, and the fact-check is not the place to police those.
    if (appHost && parsed.host === appHost && !isKnownAppPath(parsed.pathname)) {
      issues.push({
        severity: 'error',
        kind: 'fact',
        found: raw,
        message: `${where} links to "${parsed.pathname}", which is not a page the app has. It would 404 for the reader.`,
      });
    }
  };

  for (const block of blocks) {
    if (block.type === 'cta') check(block.url, 'The button');
    if (block.type === 'programCard' && block.url) check(block.url, 'The programme card link');
    if (block.type === 'image' && block.linkUrl) check(block.linkUrl, 'The image link');
  }

  return issues;
}

/**
 * Check a draft against the facts it was given.
 *
 * Errors block; warnings are surfaced for the human reviewing the draft.
 */
export function validateDraft(
  content: { subject?: string; body: string },
  snapshot: KnowledgeSnapshot,
  options: { briefText?: string } = {},
): ValidationResult {
  const text = toText(`${content.subject ?? ''} ${content.body}`);
  const issues: ValidationIssue[] = [];

  // --- Price -------------------------------------------------------------
  const allowedPrices = new Set(
    (snapshot.priceLabel.match(PRICE_PATTERN) ?? []).map((p) => p.replace(/\s/g, '')),
  );
  // A price the marketer wrote into the brief is theirs, e.g. a book at £12.99 —
  // only prices the model produced from nowhere are errors.
  for (const p of options.briefText?.match(PRICE_PATTERN) ?? []) {
    allowedPrices.add(p.replace(/\s/g, ''));
  }
  for (const match of new Set(text.match(PRICE_PATTERN) ?? [])) {
    if (!allowedPrices.has(match.replace(/\s/g, ''))) {
      issues.push({
        severity: 'error',
        found: match,
        message: `States a price of ${match}, but the current price is ${snapshot.priceLabel}.`,
      });
    }
  }

  // --- Trial length ------------------------------------------------------
  for (const pattern of TRIAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const phrase = match[0];
      const number = match[1] ? Number(match[1]) : null;

      // A day-count that matches the real trial is fine; anything else — a
      // month, a week, a different day count — is wrong.
      const isCorrectDayCount =
        number !== null && /day/i.test(phrase) && number === snapshot.trialDays;

      if (!isCorrectDayCount) {
        issues.push({
          severity: 'error',
          found: phrase.trim(),
          message: `Claims "${phrase.trim()}", but the trial is ${snapshot.trialDays} days.`,
        });
      }
    }
  }

  // --- Programme names ---------------------------------------------------
  // Only flags names presented as programmes, since prose legitimately contains
  // words that also appear in programme titles.
  const realPrograms = new Set(snapshot.programs.map((p) => normaliseName(p.name)));
  const quoted = text.matchAll(/["“']([A-Z][^"”']{4,60})["”']/g);
  for (const match of quoted) {
    const candidate = match[1];
    if (!/program|plan|cycle|prep|performance|steps|fusion|elite/i.test(candidate)) continue;
    if (realPrograms.size === 0) {
      issues.push({
        severity: 'warning',
        found: candidate,
        message: 'Names what looks like a programme, but no programmes were available to check against.',
      });
      continue;
    }
    if (!realPrograms.has(normaliseName(candidate))) {
      issues.push({
        severity: 'error',
        found: candidate,
        message: `"${candidate}" is not one of the current programmes.`,
      });
    }
  }

  // --- Invented statistics ----------------------------------------------
  for (const match of new Set(text.match(STAT_PATTERN) ?? [])) {
    issues.push({
      severity: 'error',
      found: match,
      message: `Cites a statistic ("${match}") that has no source in the supplied facts.`,
    });
  }

  // --- Deliverability and completeness ----------------------------------
  if (content.subject !== undefined) {
    const subject = content.subject.trim();
    if (!subject) {
      issues.push({ severity: 'error', found: '(empty)', message: 'The subject line is empty.' });
    } else if (subject.length > 78) {
      issues.push({
        severity: 'warning',
        found: subject,
        message: `Subject is ${subject.length} characters; most inboxes truncate beyond about 60.`,
      });
    }
    if (/^(re|fwd):/i.test(subject)) {
      issues.push({
        severity: 'warning',
        found: subject,
        message: 'A fake "Re:" or "Fwd:" prefix reads as deceptive and hurts sender reputation.',
      });
    }
  }

  // Unfilled merge tokens reach the reader as literal braces.
  for (const match of new Set(text.match(/\{\{[^}]+\}\}/g) ?? [])) {
    issues.push({
      severity: 'error',
      found: match,
      message: `Unresolved template placeholder ${match} would be sent literally.`,
    });
  }

  if (/HybridX|Hybrid X|Hybrid-X/.test(text)) {
    issues.push({
      severity: 'warning',
      found: 'HybridX',
      message: 'The brand is written HYBRIDX, never "HybridX", "Hybrid X" or "Hybrid-X".',
    });
  }

  if (/\bHyrox\b/.test(text)) {
    issues.push({
      severity: 'warning',
      found: 'Hyrox',
      message: 'HYROX is always written in capitals.',
    });
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}
