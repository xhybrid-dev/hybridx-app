import { describe, it, expect } from 'vitest';
import { evaluateDraft, repairableIssues, blockingIssues } from '../draft-evaluate';
import { buildDestinations } from '../email-markup';
import { buildDraftPrompt, buildRepairPrompt } from '../draft-prompt';
import type { KnowledgeSnapshot } from '../knowledge';

const APP = 'https://app.hybridx.club';

const snapshot: KnowledgeSnapshot = {
  trialDays: 14,
  priceLabel: '£5/month',
  programs: [
    { id: 'p1', name: 'First Steps to Hyrox', description: 'Beginner', programType: 'hyrox', weeks: 12 },
  ],
  features: ['Edge Coach'],
  intakeRoutes: [],
  totalMailable: 100,
  topSegments: [],
  bestCampaigns: [],
  worstCampaigns: [],
  capturedAt: new Date().toISOString(),
};

const evaluate = (body: string, extra: { subject?: string; previewText?: string; brief?: string } = {}) =>
  evaluateDraft(
    {
      angle: 'a',
      subject: extra.subject ?? 'Your first session takes 35 minutes',
      previewText: extra.previewText ?? 'Open the app and press start.',
      body,
    },
    {
      snapshot,
      destinations: buildDestinations(extra.brief ?? '', APP),
      appUrl: APP,
      briefText: extra.brief ?? '',
    },
  );

describe('evaluateDraft', () => {
  it('passes a clean email with no issues at all', () => {
    const r = evaluate(`# Your first session
No setup needed.

Hi [First Name], your 14-day free trial is running. Just £5/month after that.

[program: First Steps to Hyrox | Built for a first race.]

[button: Start today's session -> dashboard]`);
    expect(r.issues).toEqual([]);
    expect(r.blocks.map((b) => b.type)).toEqual(['hero', 'paragraph', 'programCard', 'cta']);
  });

  it('fixes brand casing in the subject and preview rather than warning', () => {
    const r = evaluate('# H\n\n[button: Go -> home]', {
      subject: 'Your Hyrox plan from HybridX',
      previewText: 'Built for hyrox.',
    });
    expect(r.subject).toBe('Your HYROX plan from HYBRIDX');
    expect(r.previewText).toBe('Built for HYROX.');
    expect(r.issues.filter((i) => /HYROX|brand/.test(i.message))).toEqual([]);
  });

  it('sends a wrong price back to the model to fix', () => {
    const r = evaluate('# H\n\nOnly £9.99 a month.\n\n[button: Go -> home]');
    expect(repairableIssues(r.issues).map((i) => i.found)).toEqual(['£9.99']);
  });

  it('accepts a price the brief supplied for another product', () => {
    const r = evaluate('# H\n\nThe book is £12.99.\n\n[button: Get it -> link-1]', {
      brief: 'Launch the book at £12.99, https://shop.hybridx.club/book',
    });
    expect(blockingIssues(r.issues)).toEqual([]);
  });

  it('leaves a missing link for the reviewer and does not ask the model to fix it', () => {
    const r = evaluate('# H\n\n[button: Get the book -> ADD-LINK]');
    expect(blockingIssues(r.issues)).toHaveLength(1);
    expect(repairableIssues(r.issues)).toEqual([]);
  });

  it('flags an app link that would 404', () => {
    const r = evaluate(`# H\n\n[button: Go -> ${APP}/not-a-page]`);
    expect(repairableIssues(r.issues)[0].message).toContain('404');
  });

  it('warns when the preview repeats the subject', () => {
    const r = evaluate('# H\n\n[button: Go -> home]', { subject: 'Same', previewText: 'Same' });
    expect(r.issues.some((i) => i.severity === 'warning' && i.message.includes('repeats'))).toBe(true);
  });
});

describe('the drafting prompt', () => {
  const context = { facts: '## LIVE BUSINESS FACTS\n- App price: £5/month', destinations: buildDestinations('https://shop.x/book', APP) };

  it('offers brief links and app pages as button destinations', () => {
    const prompt = buildDraftPrompt({ brief: 'Launch the book https://shop.x/book' }, context);
    expect(prompt).toContain('- link-1 → https://shop.x/book');
    expect(prompt).toContain(`- dashboard → ${APP}/dashboard`);
    expect(prompt).toContain('ADD-LINK');
  });

  it('shows the full text of earlier emails, not just their subjects', () => {
    const prompt = buildDraftPrompt(
      { brief: 'b', siblingEmails: [{ subject: 'First one', body: '# Earlier headline\n\nEarlier argument.' }] },
      context,
    );
    expect(prompt).toContain('subject: First one');
    expect(prompt).toContain('Earlier argument.');
  });

  it('puts the brief last, where it carries the most weight', () => {
    const prompt = buildDraftPrompt({ brief: 'THE BRIEF TEXT' }, context);
    expect(prompt.trimEnd().endsWith('THE BRIEF TEXT')).toBe(true);
  });

  it('repairs by quoting the previous draft and each problem', () => {
    const prompt = buildRepairPrompt(
      'ORIGINAL',
      { angle: 'a', subject: 's', previewText: 'p', body: '# Old body' },
      [{ severity: 'error', found: '£9.99', message: 'Wrong price.' }],
    );
    expect(prompt).toContain('ORIGINAL');
    expect(prompt).toContain('# Old body');
    expect(prompt).toContain('- £9.99: Wrong price.');
  });
});
