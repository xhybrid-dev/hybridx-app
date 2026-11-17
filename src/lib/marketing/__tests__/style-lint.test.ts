import { describe, it, expect } from 'vitest';
import { lintStyle, styleScore } from '../style-lint';
import { buildDestinations, parseEmailMarkup } from '../email-markup';

const email = (body: string, subject = 'Your first session takes 35 minutes') => ({
  subject,
  previewText: 'Open the app and press start.',
  blocks: parseEmailMarkup(body, { destinations: buildDestinations('', 'https://app.hybridx.club') }).blocks,
});

const rules = (body: string, subject?: string) => lintStyle(email(body, subject)).map((f) => f.rule);

const GOOD = `# Your first session takes 35 minutes
No plan to read first.

Hi [First Name],

You signed up to race, not to read a plan. Today's session is short and already scaled to you.

Finish it and your coach adjusts next week around how it went.

[button: Start today's session -> dashboard]`;

describe('lintStyle', () => {
  it('passes a tight, reader-first email', () => {
    expect(rules(GOOD)).toEqual([]);
    expect(styleScore(email(GOOD))).toMatchObject({ passed: 8, total: 8 });
  });

  it('catches clichés', () => {
    expect(rules(GOOD.replace('is short', 'will take your training to the next level'))).toContain('cliches');
  });

  it('catches a generic button', () => {
    expect(rules(GOOD.replace("Start today's session", 'Learn more'))).toContain('specific-button');
  });

  it('catches an opening about us, skipping the greeting', () => {
    expect(rules(GOOD.replace('You signed up to race', "We're excited to have you. You signed up to race"))).toContain(
      'reader-first',
    );
  });

  it('catches long paragraphs and long sentences', () => {
    // 40 words in one sentence, then three more sentences in the same paragraph.
    const long = `${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}.`;
    const r = rules(GOOD.replace("Today's session is short and already scaled to you.", `${long} One. Two. Three.`));
    expect(r).toContain('short-paragraphs');
    expect(r).toContain('readable-sentences');
  });

  it('catches more "we" than "you"', () => {
    expect(rules('# Head\n\nWe built it. Our team made it for us. We love it.\n\n[button: See it -> dashboard]')).toContain('you-focus');
  });

  it('catches leading with AI', () => {
    expect(rules(GOOD, 'Meet your AI coach')).toContain('no-ai-hook');
  });

  it('allows one exclamation mark but not more', () => {
    expect(rules(GOOD.replace('scaled to you.', 'scaled to you!'))).not.toContain('exclamations');
    expect(rules(GOOD.replace('scaled to you.', 'scaled to you!').replace('how it went.', 'how it went!'))).toContain('exclamations');
  });
});
