// src/lib/marketing/style-lint.ts
//
// Mechanical style rules for marketing email.
//
// The fact-checker answers "is it true?". This answers part of "is it good?"
// — the part that does not need taste: clichés, hype, generic buttons, an
// opening about us instead of the reader, paragraphs and sentences too long
// to read on a phone. The drafting eval's first baseline passed every
// mechanical check and still scored lowest on voice and reader-first; these
// rules put a number on exactly those, without asking a model's opinion.
//
// One list, three readers: the drafting prompt (so the model avoids them),
// the review screen (as warnings), and the eval (as a style score).

import type { EmailBlock } from './blocks';

/** Phrases that mark copy as generic. Lowercase; matched on word boundaries. */
export const CLICHES = [
  'next level',
  'level up',
  'unleash',
  'unlock your potential',
  'unlock your full potential',
  'game-changer',
  'game changer',
  'crush your goals',
  'crush it',
  'elevate your',
  'journey',
  'look no further',
  "don't miss out",
  'whether you’re',
  "whether you're",
  "in today's",
  "we're excited",
  'we are excited',
  "we're thrilled",
  'thrilled to',
  'revolutionise',
  'revolutionize',
  'cutting-edge',
  'state-of-the-art',
  'seamless',
  'supercharge',
  'transform your',
  'beast mode',
  'no excuses',
  'dive into',
  'embark',
  'harness',
] as const;

/** Button labels that say nothing about what happens next. */
export const GENERIC_BUTTONS = [
  'learn more',
  'click here',
  'read more',
  'find out more',
  'discover more',
  'see more',
  'more info',
  'get started',
] as const;

/** Openings about the sender rather than the reader. */
const SENDER_FIRST = /^(we\b|we['’](re|ve|ll)\b|our\b|at hybridx\b|hybridx (is|has|now)\b|introducing\b|exciting news\b|i['’]m (excited|thrilled)\b)/i;

const GREETING = /^(hi|hey|hello|dear)\b[^.!?]{0,40}[,!.]?$/i;

export type StyleRule =
  | 'cliches'
  | 'exclamations'
  | 'specific-button'
  | 'reader-first'
  | 'short-paragraphs'
  | 'readable-sentences'
  | 'you-focus'
  | 'no-ai-hook';

export const STYLE_RULES: Record<StyleRule, string> = {
  cliches: 'No marketing clichés',
  exclamations: 'At most one exclamation mark',
  'specific-button': 'Button says what happens next',
  'reader-first': 'Opens on the reader, not on us',
  'short-paragraphs': 'Paragraphs of three sentences or fewer',
  'readable-sentences': 'Sentences short enough to read on a phone',
  'you-focus': 'More "you" than "we"',
  'no-ai-hook': 'Does not lead with AI',
};

export interface StyleFinding {
  rule: StyleRule;
  found: string;
  message: string;
}

export interface StyleInput {
  subject: string;
  previewText: string;
  blocks: readonly EmailBlock[];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /\w/.test(s));
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(haystack);
}

export function lintStyle(email: StyleInput): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const add = (rule: StyleRule, found: string, message: string) => findings.push({ rule, found, message });

  const paragraphs = email.blocks
    .filter((b): b is Extract<EmailBlock, { type: 'paragraph' }> => b.type === 'paragraph')
    .map((b) => b.text);
  const hero = email.blocks.find((b): b is Extract<EmailBlock, { type: 'hero' }> => b.type === 'hero');
  const readable = email.blocks
    .map((b) => {
      switch (b.type) {
        case 'hero':
          return [b.heading, b.subheading].filter(Boolean).join('. ');
        case 'heading':
        case 'paragraph':
        case 'quote':
          return b.text;
        case 'bulletList':
          return b.items.join('. ');
        case 'programCard':
          return b.description;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
  const all = `${email.subject}\n${email.previewText}\n${readable}`;

  // --- Clichés ------------------------------------------------------------
  const cliches = CLICHES.filter((c) => containsPhrase(all, c));
  if (cliches.length) {
    add('cliches', cliches.join(', '), `Generic phrasing: ${cliches.map((c) => `"${c}"`).join(', ')}. Say the specific thing instead.`);
  }

  // --- Exclamation marks --------------------------------------------------
  const bangs = (readable.match(/!/g) ?? []).length + (email.subject.includes('!') ? 2 : 0);
  if (bangs > 1) add('exclamations', `${bangs} "!"`, 'Too many exclamation marks; let the content carry the energy.');

  // --- Button -------------------------------------------------------------
  for (const b of email.blocks) {
    if (b.type !== 'cta') continue;
    const label = b.label.trim().toLowerCase().replace(/[.!]$/, '');
    if ((GENERIC_BUTTONS as readonly string[]).includes(label) || wordCount(label) > 5) {
      add('specific-button', b.label, 'The button should name the action in the reader’s terms, in two to five words.');
    }
  }

  // --- Opening ------------------------------------------------------------
  const opening = paragraphs.find((p) => !GREETING.test(p.trim()));
  if (opening && SENDER_FIRST.test(opening.trim())) {
    add('reader-first', opening.slice(0, 60), 'The first paragraph opens on us. Open on the reader’s situation or goal.');
  }
  if (hero && SENDER_FIRST.test(hero.heading.trim())) {
    add('reader-first', hero.heading, 'The headline is about us. Make it about the reader.');
  }

  // --- Paragraphs and sentences --------------------------------------------
  const longParas = paragraphs.filter((p) => sentences(p).length > 3 || wordCount(p) > 70);
  if (longParas.length) {
    add('short-paragraphs', longParas[0].slice(0, 60), `${longParas.length} paragraph(s) run past three sentences. Split them.`);
  }

  const allSentences = paragraphs.flatMap(sentences);
  if (allSentences.length) {
    const avg = allSentences.reduce((n, s) => n + wordCount(s), 0) / allSentences.length;
    const longest = allSentences.reduce((a, b) => (wordCount(b) > wordCount(a) ? b : a));
    if (avg > 20 || wordCount(longest) > 35) {
      add(
        'readable-sentences',
        longest.slice(0, 60),
        `Sentences average ${avg.toFixed(0)} words; the longest is ${wordCount(longest)}. Aim for under 20, none over 35.`,
      );
    }
  }

  // --- You versus we -------------------------------------------------------
  const you = (readable.match(/\byou(r|rs|rself|['’](re|ve|ll|d))?\b/gi) ?? []).length;
  const we = (readable.match(/\b(we|our|ours|us|we['’](re|ve|ll|d))\b/gi) ?? []).length;
  if (we > you) add('you-focus', `${you} you / ${we} we`, 'The email talks about us more than the reader.');

  // --- AI as the hook --------------------------------------------------------
  const lead = [email.subject, hero?.heading ?? '', opening ?? ''].join(' ');
  if (/\bAI\b|AI-powered|artificial intelligence/i.test(lead)) {
    add('no-ai-hook', 'AI', 'AI is how it works, not the hook. Lead with what the athlete gets.');
  }

  return findings;
}

/** How many of the rules an email passes — the eval's style score. */
export function styleScore(email: StyleInput): { passed: number; total: number; failed: StyleRule[] } {
  const failed = [...new Set(lintStyle(email).map((f) => f.rule))];
  const total = Object.keys(STYLE_RULES).length;
  return { passed: total - failed.length, total, failed };
}
