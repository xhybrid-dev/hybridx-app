import { describe, it, expect } from 'vitest';
import { EVAL_CASES, type EvalCase } from '../eval/cases';
import { fillFacts, scoreDraft, summariseRun, type EvalCaseResult } from '../eval/score';
import { isKnownAppPath } from '../app-routes';
import { buildDestinations, parseEmailMarkup } from '../email-markup';

const APP = 'https://app.hybridx.club';
const FACTS = { priceLabel: '£5/month', trialDays: 14 };

const draftFrom = (body: string, subject = 'A good subject', previewText = 'A different preview') => {
  const { blocks, issues } = parseEmailMarkup(body, { destinations: buildDestinations(body, APP) });
  return { subject, previewText, blocks, issues };
};

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const failing = (c: EvalCase, body: string, subject?: string, preview?: string) =>
  scoreDraft(c, draftFrom(body, subject, preview), FACTS, APP).checks.filter((x) => !x.pass).map((x) => x.id);

describe('the case set', () => {
  it('has unique ids', () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only expects buttons to lead to pages the app has', () => {
    for (const c of EVAL_CASES) {
      for (const target of c.expect.ctaTo ?? []) {
        if (!target.startsWith('http')) expect(isKnownAppPath(target), `${c.id}: ${target}`).toBe(true);
      }
    }
  });
});

describe('scoreDraft', () => {
  const base: EvalCase = {
    id: 't',
    archetype: 'activation',
    input: { brief: 'b' },
    expect: { ctaTo: ['/dashboard'], mentions: [['session']], avoids: ['{price}'] },
  };

  it('passes a good draft on every check', () => {
    expect(failing(base, `# Head\n\n${words(100)} session\n\n[button: Start -> dashboard]`)).toEqual([]);
  });

  it('catches a button to the wrong page', () => {
    expect(failing(base, `# Head\n\n${words(100)} session\n\n[button: Start -> coach]`)).toEqual(['cta-target']);
  });

  it('catches a missing mention and a pitch the brief did not ask for', () => {
    const f = failing(base, `# Head\n\n${words(100)} only £5 a month\n\n[button: Start -> dashboard]`);
    expect(f).toEqual(['mentions-0', 'avoids']);
  });

  it('catches length, subject and preview problems', () => {
    const f = failing(base, `# Head\n\nsession\n\n[button: Start -> dashboard]`, 'x'.repeat(70), 'x'.repeat(70));
    expect(f).toEqual(['length', 'subject-length', 'preview']);
  });

  it('rewards leaving a missing link for the reviewer when the brief gave none', () => {
    const c: EvalCase = { ...base, expect: { needsHumanLink: true } };
    expect(failing(c, `# Head\n\n${words(100)}\n\n[button: Get the guide -> ADD-LINK]`)).toEqual([]);
    expect(failing(c, `# Head\n\n${words(100)}\n\n[button: Get the guide -> dashboard]`)).toEqual(['human-link']);
  });

  it('fills live facts into expectations', () => {
    expect(fillFacts('{price} after {trialDays} days', FACTS)).toBe('£5 after 14 days');
  });
});

describe('summariseRun', () => {
  it('averages drafted cases and counts failures apart', () => {
    const ok = (passed: number, total: number, clean: boolean): EvalCaseResult => ({
      caseId: 'x',
      archetype: 'welcome',
      ms: 10_000,
      attempts: clean ? 1 : 2,
      scored: {
        passed,
        total,
        words: 150,
        checks: [{ id: 'clean', label: '', pass: clean }],
      },
      judge: { oneAction: 4, readerFirst: 3, specificity: 3, voice: 4, briefFidelity: 5, weakness: '' },
    });
    const s = summariseRun([ok(8, 8, true), ok(6, 8, false), { caseId: 'y', archetype: 'event', ms: 2000, error: 'boom' }]);
    expect(s).toMatchObject({
      cases: 3,
      failedToDraft: 1,
      checksPassed: 14,
      checksTotal: 16,
      cleanRate: 0.5,
      perfectRate: 0.5,
      avgAttempts: 1.5,
      avgSeconds: 7.3,
    });
    expect(s.judge?.overall).toBe(3.8);
  });
});
