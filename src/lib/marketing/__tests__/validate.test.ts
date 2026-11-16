import { describe, it, expect } from 'vitest';
import { validateDraft, validateProgramCards } from '../validate';
import type { KnowledgeSnapshot } from '../knowledge';

const snapshot: KnowledgeSnapshot = {
  trialDays: 14,
  priceLabel: '£5/month',
  programs: [
    { id: 'p1', name: 'First Steps to Hyrox', description: '', programType: 'hyrox', weeks: 12 },
    { id: 'p2', name: 'Hyrox Fusion Balance', description: '', programType: 'hyrox', weeks: 12 },
  ],
  features: [],
  intakeRoutes: [],
  totalMailable: 100,
  topSegments: [],
  bestCampaigns: [],
  worstCampaigns: [],
  capturedAt: new Date().toISOString(),
};

const errors = (body: string, subject?: string) =>
  validateDraft({ subject, body }, snapshot).issues.filter((i) => i.severity === 'error');

describe('price checking', () => {
  it('accepts the current price', () => {
    expect(errors('Just £5/month after your trial.')).toHaveLength(0);
  });

  it('rejects a price that is not the current one — the stale-offer failure', () => {
    const found = errors('Only £9.99 a month!');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('£5/month');
  });

  it('rejects a foreign-currency price the model invented', () => {
    expect(errors('Just $5 per month')).toHaveLength(1);
  });

  it('tolerates spacing differences in the price', () => {
    expect(errors('Only £ 5 each month')).toHaveLength(0);
  });
});

describe('trial length checking', () => {
  it('accepts the real trial length', () => {
    expect(errors('Start your 14-day free trial today.')).toHaveLength(0);
    expect(errors('It is free for 14 days.')).toHaveLength(0);
  });

  it('rejects a different day count', () => {
    const found = errors('Start your 30-day free trial.');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('14 days');
  });

  it('rejects a month-long trial claim — the exact drift in the ported brand file', () => {
    // brand-context.ts came over from HXMailer claiming "1-month free trial"
    // while TRIAL_DAYS was already 14.
    expect(errors('Enjoy your 1-month free trial.').length).toBeGreaterThan(0);
    expect(errors('Get a one-month free trial.').length).toBeGreaterThan(0);
  });

  it('rejects a week-based trial claim', () => {
    expect(errors('A 2-week free trial awaits.').length).toBeGreaterThan(0);
  });
});

describe('programme names', () => {
  it('accepts a real programme', () => {
    expect(errors('Try "First Steps to Hyrox" this week.')).toHaveLength(0);
  });

  it('is insensitive to punctuation and case in a real name', () => {
    expect(errors('Try "first steps to hyrox" today.')).toHaveLength(0);
  });

  it('rejects an invented programme', () => {
    const found = errors('Start our "Ultimate Hyrox Domination Program" now.');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('not one of the current programmes');
  });

  it('does not flag ordinary quoted prose that is not programme-shaped', () => {
    expect(errors('She said "This was the hardest session yet" afterwards.')).toHaveLength(0);
  });
});

describe('invented statistics', () => {
  it('rejects a percentage claim with no source', () => {
    const found = errors('87% of athletes improve their time.');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('no source');
  });

  it('allows percentages that are not claims about people', () => {
    expect(errors('Increase your pace by 5% each week.')).toHaveLength(0);
  });
});

describe('template placeholders', () => {
  it('rejects an unresolved placeholder that would be sent literally', () => {
    const found = errors('Hi {{firstName}}, welcome aboard.');
    expect(found).toHaveLength(1);
    expect(found[0].found).toBe('{{firstName}}');
  });

  it('allows the [First Name] merge tokens this system actually resolves', () => {
    expect(errors('Hi [First Name], welcome aboard.')).toHaveLength(0);
  });
});

describe('subject line', () => {
  it('rejects an empty subject', () => {
    expect(errors('Body text', '')).toHaveLength(1);
  });

  it('warns on a subject that inboxes will truncate', () => {
    const result = validateDraft({ subject: 'A'.repeat(90), body: 'Body' }, snapshot);
    expect(result.ok).toBe(true); // a warning, not a blocker
    expect(result.issues.some((i) => i.message.includes('truncate'))).toBe(true);
  });

  it('warns about a deceptive Re: prefix', () => {
    const result = validateDraft({ subject: 'Re: your training plan', body: 'Body' }, snapshot);
    expect(result.issues.some((i) => i.message.includes('deceptive'))).toBe(true);
  });
});

describe('brand style', () => {
  it('warns when the brand is miscased', () => {
    const result = validateDraft({ body: 'Welcome to HybridX!' }, snapshot);
    expect(result.issues.some((i) => i.found === 'HybridX')).toBe(true);
    expect(result.ok).toBe(true); // style, not fact — does not block
  });

  it('warns when HYROX is not capitalised', () => {
    const result = validateDraft({ body: 'Train for Hyrox with us.' }, snapshot);
    expect(result.issues.some((i) => i.found === 'Hyrox')).toBe(true);
  });
});

describe('overall result', () => {
  it('passes a clean draft', () => {
    const result = validateDraft(
      {
        subject: 'Your HYROX plan is ready',
        body: '<p>Hi [First Name], start your 14-day free trial. Just £5/month after that.</p>',
      },
      snapshot,
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('checks the text a reader sees, not the markup', () => {
    // A wrong price hidden inside markup still reaches the reader.
    const result = validateDraft({ body: '<div><span>£99</span>/month</div>' }, snapshot);
    expect(result.ok).toBe(false);
  });

  it('ignores prices inside style and script blocks', () => {
    const result = validateDraft(
      { body: '<style>.a{content:"£99"}</style><p>Just £5/month.</p>' },
      snapshot,
    );
    expect(result.ok).toBe(true);
  });

  it('fails when any error is present, regardless of warnings', () => {
    const result = validateDraft(
      { subject: 'Re: hi', body: 'Only £99/month for HybridX.' },
      snapshot,
    );
    expect(result.ok).toBe(false);
  });

  it('flags a programme name when no catalogue is available rather than passing silently', () => {
    const empty = { ...snapshot, programs: [] };
    const result = validateDraft({ body: 'Join the "Elite Performance Program" now.' }, empty);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('programme-name false positives', () => {
  it('does not flag quoted prose that merely contains "plan" or "prep"', () => {
    // Used to be an error: any quoted phrase with plan|prep|performance was
    // treated as an invented programme.
    expect(errors('Your "Race week prep" starts Monday and the "Plan for Saturday" is light.')).toHaveLength(0);
  });

  it('suggests the real programme for a near-miss name', () => {
    const found = errors('Try "Hyrox Fusion Plan" this block.');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Did you mean "Hyrox Fusion Balance"?');
  });

  it('does not warn about "Hyrox" inside a real programme name', () => {
    const result = validateDraft({ body: 'Start "First Steps to Hyrox" today.' }, snapshot);
    expect(result.issues.some((i) => i.found === 'Hyrox')).toBe(false);
  });
});

describe('validateProgramCards', () => {
  it('accepts a real programme in a card', () => {
    expect(
      validateProgramCards([{ type: 'programCard', programName: 'first steps to hyrox', description: 'x' }], snapshot),
    ).toEqual([]);
  });

  it('rejects a card naming a programme that does not exist', () => {
    const issues = validateProgramCards(
      [{ type: 'paragraph', text: 'x' }, { type: 'programCard', programName: 'Engine Builder', description: 'x' }],
      snapshot,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', blockIndex: 1, kind: 'fact' });
  });
});
