// src/lib/marketing/eval/score.ts
//
// Mechanical checks on one drafted email.
//
// These are the things that can be decided without taste: did it parse
// cleanly, does the button go where it should, is it the right length, did it
// stay on the brief's product. The model judge (judge-email.ts) scores the
// rest. Kept apart so a change in the judge's mood cannot move these numbers.

import { blocksToText, type EmailBlock } from '../blocks';
import type { ValidationIssue } from '../validate';
import type { EvalCase } from './cases';
import { parseEmailMarkup } from '../email-markup';
import { STYLE_RULES, styleScore, type StyleRule } from '../style-lint';

export interface EvalCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface ScoredDraft {
  checks: EvalCheck[];
  passed: number;
  total: number;
  words: number;
}

export interface ScoreInput {
  subject: string;
  previewText: string;
  blocks: EmailBlock[];
  issues: ValidationIssue[];
}

/** Fill {price} and {trialDays} from the live facts. */
export function fillFacts(text: string, facts: { priceLabel: string; trialDays: number }): string {
  const price = facts.priceLabel.match(/[£$€]\s?\d+(?:\.\d{1,2})?/)?.[0] ?? facts.priceLabel;
  return text.replaceAll('{price}', price).replaceAll('{trialDays}', String(facts.trialDays));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** "/dashboard" matches the app URL with that path; a full URL must match exactly. */
function ctaMatches(url: string, targets: string[], appUrl: string): boolean {
  const base = appUrl.replace(/\/$/, '');
  return targets.some((t) => {
    if (t.startsWith('http')) return url === t;
    const want = t === '/' ? base : `${base}${t}`;
    return url.replace(/\/$/, '') === want || (t !== '/' && url.startsWith(`${want}/`));
  });
}

export function scoreDraft(
  c: EvalCase,
  draft: ScoreInput,
  facts: { priceLabel: string; trialDays: number },
  appUrl: string,
): ScoredDraft {
  const checks: EvalCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail?: string) =>
    checks.push({ id, label, pass, ...(detail && !pass ? { detail } : {}) });

  const body = blocksToText(draft.blocks);
  const everything = `${draft.subject}\n${draft.previewText}\n${body}`.toLowerCase();
  const words = countWords(body);

  // --- Structure ---------------------------------------------------------
  const errors = draft.issues.filter((i) => i.severity === 'error');
  const modelErrors = errors.filter((i) => i.owner !== 'human');
  add(
    'clean',
    'No blocking issues left for the reviewer to repair',
    modelErrors.length === 0,
    modelErrors.map((i) => `${i.found}: ${i.message}`).join(' · '),
  );

  const humanLink = errors.some((i) => i.owner === 'human');
  if (c.expect.needsHumanLink) {
    add('human-link', 'Leaves the missing link for the reviewer instead of guessing', humanLink);
  } else {
    add('no-missing-link', 'No button left without a link', !humanLink);
  }

  add('hero', 'Opens with a headline', draft.blocks[0]?.type === 'hero', draft.blocks[0]?.type);

  const ctas = draft.blocks.filter((b): b is Extract<EmailBlock, { type: 'cta' }> => b.type === 'cta');
  add('one-cta', 'Exactly one button', ctas.length === 1, `${ctas.length} buttons`);

  if (c.expect.ctaTo?.length && !c.expect.needsHumanLink) {
    const ok = ctas.some((b) => ctaMatches(b.url, c.expect.ctaTo!, appUrl));
    add('cta-target', 'Button leads where the brief points', ok, ctas.map((b) => b.url || '(none)').join(', '));
  }

  // --- Length and inbox ----------------------------------------------------
  const [min, max] = c.expect.words ?? [80, 300];
  add('length', `Body is ${min}–${max} words`, words >= min && words <= max, `${words} words`);
  add('subject-length', 'Subject under 60 characters', draft.subject.length > 0 && draft.subject.length <= 60, `${draft.subject.length} characters`);
  add(
    'preview',
    'Preview text present and different from the subject',
    !!draft.previewText.trim() && draft.previewText.trim().toLowerCase() !== draft.subject.trim().toLowerCase(),
  );

  // --- Brief fidelity ------------------------------------------------------
  for (const [i, alternatives] of (c.expect.mentions ?? []).entries()) {
    const filled = alternatives.map((a) => fillFacts(a, facts));
    add(
      `mentions-${i}`,
      `Mentions ${filled.map((a) => `"${a}"`).join(' or ')}`,
      filled.some((a) => everything.includes(a.toLowerCase())),
    );
  }
  const avoids = (c.expect.avoids ?? []).map((a) => fillFacts(a, facts));
  if (avoids.length) {
    const found = avoids.filter((a) => everything.includes(a.toLowerCase()));
    add('avoids', 'Stays off what the brief did not ask for', found.length === 0, found.map((a) => `"${a}"`).join(', '));
  }

  return { checks, passed: checks.filter((x) => x.pass).length, total: checks.length, words };
}

// ---------------------------------------------------------------------------
// A whole run
// ---------------------------------------------------------------------------

export interface JudgeSummary {
  oneAction: number;
  readerFirst: number;
  specificity: number;
  voice: number;
  briefFidelity: number;
}

export interface EvalCaseResult {
  caseId: string;
  archetype: EvalCase['archetype'];
  ms: number;
  /** Set when drafting itself failed; nothing else is then present. */
  error?: string;
  attempts?: number;
  angle?: string;
  subject?: string;
  previewText?: string;
  /** The email in the drafting format, for reading results without a renderer. */
  markup?: string;
  scored?: ScoredDraft;
  judge?: JudgeSummary & { weakness: string };
}

export interface EvalRunSummary {
  cases: number;
  failedToDraft: number;
  checksPassed: number;
  checksTotal: number;
  /** Share of drafted cases that needed no repair by the reviewer. */
  cleanRate: number;
  /** Share of drafted cases that passed every mechanical check. */
  perfectRate: number;
  avgWords: number;
  avgAttempts: number;
  avgSeconds: number;
  /** Mean judge score per criterion, and overall; null when not judged. */
  judge: (JudgeSummary & { overall: number }) | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function summariseRun(results: EvalCaseResult[]): EvalRunSummary {
  const drafted = results.filter((r) => r.scored);
  const judged = drafted.filter((r) => r.judge);
  const criteria = ['oneAction', 'readerFirst', 'specificity', 'voice', 'briefFidelity'] as const;

  const judge = judged.length
    ? (() => {
        const per = Object.fromEntries(
          criteria.map((k) => [k, round(mean(judged.map((r) => r.judge![k])))]),
        ) as unknown as JudgeSummary;
        return { ...per, overall: round(mean(criteria.map((k) => per[k]))) };
      })()
    : null;

  return {
    cases: results.length,
    failedToDraft: results.length - drafted.length,
    checksPassed: drafted.reduce((n, r) => n + r.scored!.passed, 0),
    checksTotal: drafted.reduce((n, r) => n + r.scored!.total, 0),
    cleanRate: round(mean(drafted.map((r) => (r.scored!.checks.find((c) => c.id === 'clean')?.pass ? 1 : 0)))),
    perfectRate: round(mean(drafted.map((r) => (r.scored!.passed === r.scored!.total ? 1 : 0)))),
    avgWords: Math.round(mean(drafted.map((r) => r.scored!.words))),
    avgAttempts: round(mean(drafted.map((r) => r.attempts ?? 1))),
    avgSeconds: round(mean(results.map((r) => r.ms / 1000)), 1),
    judge,
  };
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------
//
// Computed from the saved email text rather than stored with the run, so a
// rule added later scores every earlier run too — the baseline included —
// without drafting anything again.

/** Re-read a saved result's email and score it against the style rules. */
export function styleOfResult(r: EvalCaseResult): ReturnType<typeof styleScore> | null {
  if (!r.markup) return null;
  const { blocks } = parseEmailMarkup(r.markup, { destinations: [], fragment: true });
  return styleScore({ subject: r.subject ?? '', previewText: r.previewText ?? '', blocks });
}

export interface StyleSummary {
  passed: number;
  total: number;
  /** Emails failing each rule, worst first. */
  failures: Array<{ rule: StyleRule; label: string; emails: number }>;
}

export function summariseStyle(results: EvalCaseResult[]): StyleSummary | null {
  const scored = results.map(styleOfResult).filter((s): s is NonNullable<typeof s> => !!s);
  if (!scored.length) return null;
  const counts = new Map<StyleRule, number>();
  for (const s of scored) for (const rule of s.failed) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return {
    passed: scored.reduce((n, s) => n + s.passed, 0),
    total: scored.reduce((n, s) => n + s.total, 0),
    failures: [...counts.entries()]
      .map(([rule, emails]) => ({ rule, label: STYLE_RULES[rule], emails }))
      .sort((a, b) => b.emails - a.emails),
  };
}
