import { describe, it, expect } from 'vitest';
import {
  ADD_LINK,
  blocksToMarkup,
  buildDestinations,
  normaliseBrand,
  parseEmailMarkup,
} from '../email-markup';
import { emailBlockSchema } from '../blocks';

const APP = 'https://app.hybridx.club';
const PROGRAMS = ['First Steps to Hyrox', 'Hyrox Fusion Balance'];

const parse = (body: string, brief = '') =>
  parseEmailMarkup(body, { destinations: buildDestinations(brief, APP), programNames: PROGRAMS });

const errors = (r: ReturnType<typeof parse>) => r.issues.filter((i) => i.severity === 'error');

describe('the failures the flat JSON schema produced', () => {
  it('keeps every section heading with its words', () => {
    // The old schema let a heading arrive with its words in the hero's field,
    // and the block was then dropped. In this format there is no such field.
    const r = parse(`# Race week
Here is the plan.

## Monday
Easy run.

## Wednesday
Short sharp session.

### Friday
Rest.

[button: Open your plan -> calendar]`);
    expect(r.blocks.filter((b) => b.type === 'heading')).toEqual([
      { type: 'heading', text: 'Monday', level: 2 },
      { type: 'heading', text: 'Wednesday', level: 2 },
      { type: 'heading', text: 'Friday', level: 3 },
    ]);
    expect(errors(r)).toEqual([]);
  });

  it('keeps every paragraph of a long email — there is no block cap', () => {
    // The flat schema capped an email at ten blocks; hero plus button left
    // eight for everything else, and paragraphs were cut to fit.
    const paragraphs = Array.from({ length: 14 }, (_, i) => `Paragraph number ${i + 1}.`);
    const r = parse(`# Headline\n\n${paragraphs.join('\n\n')}\n\n[button: Go -> dashboard]`);
    expect(r.blocks.filter((b) => b.type === 'paragraph')).toHaveLength(14);
    expect(r.blocks).toHaveLength(16);
  });

  it('produces only blocks the strict schema accepts', () => {
    const r = parse(`# Hi
Sub

Text

- a
- b

> Great plan
> — Sam

---

[program: First Steps to Hyrox | Built for a first race.]
[stats: 12 weeks = per programme | 14 days = free trial]
[button: Start -> programs]`);
    for (const block of r.blocks) expect(emailBlockSchema.safeParse(block).success).toBe(true);
    expect(r.blocks.map((b) => b.type)).toEqual([
      'hero', 'paragraph', 'bulletList', 'quote', 'divider', 'programCard', 'statRow', 'cta',
    ]);
    expect(errors(r)).toEqual([]);
  });
});

describe('hero', () => {
  it('takes the line directly under the headline as its subheading', () => {
    const r = parse('# Back on the start line\nThree weeks to race day.\n\nBody.');
    expect(r.blocks[0]).toEqual({
      type: 'hero',
      heading: 'Back on the start line',
      subheading: 'Three weeks to race day.',
    });
    expect(r.blocks[1]).toEqual({ type: 'paragraph', text: 'Body.' });
  });

  it('treats a long line under the headline as the first paragraph', () => {
    const long = 'x'.repeat(200);
    const r = parse(`# Head\n${long}`);
    expect(r.blocks[1]).toEqual({ type: 'paragraph', text: long });
  });

  it('turns a second "#" into a section heading rather than a second hero', () => {
    const r = parse('# One\n\nText\n\n# Two');
    expect(r.blocks.map((b) => b.type)).toEqual(['hero', 'paragraph', 'heading']);
  });
});

describe('buttons', () => {
  it('resolves an app destination key to the real URL', () => {
    const r = parse('# H\n\n[button: Open the coach -> coach]');
    expect(r.blocks[1]).toEqual({ type: 'cta', label: 'Open the coach', url: `${APP}/coach` });
  });

  it('uses a link from the brief exactly as written', () => {
    const brief = 'Promote the new book, on sale at https://shop.hybridx.club/book-1.';
    const r = parse('# H\n\n[button: Get the book -> link-1]', brief);
    expect(r.blocks[1]).toMatchObject({ url: 'https://shop.hybridx.club/book-1' });
    expect(errors(r)).toEqual([]);
  });

  it('flags a missing link as the reviewer\'s to add, not the model\'s', () => {
    const r = parse(`# H\n\n[button: Get the book -> ${ADD_LINK}]`);
    expect(r.blocks[1]).toEqual({ type: 'cta', label: 'Get the book', url: '' });
    const [issue] = errors(r);
    expect(issue.owner).toBe('human');
    expect(issue.blockIndex).toBe(1);
  });

  it('rejects a URL the model typed that nobody offered it', () => {
    const r = parse('# H\n\n[button: Buy -> https://made-up-shop.com/thing]');
    expect(r.blocks[1]).toMatchObject({ url: '' });
    const [issue] = errors(r);
    expect(issue.owner).toBeUndefined(); // the model can fix this
    expect(issue.message).toContain('not one of the destinations');
  });

  it('accepts an app URL typed in full, leaving the path to the link checker', () => {
    const r = parse(`# H\n\n[button: Go -> ${APP}/dashboard]`);
    expect(r.blocks[1]).toMatchObject({ url: `${APP}/dashboard` });
  });

  it('accepts an app path', () => {
    const r = parse('# H\n\n[button: Go -> /programs]');
    expect(r.blocks[1]).toMatchObject({ url: `${APP}/programs` });
  });

  it('reads a line that is only a Markdown link as a button', () => {
    const r = parse('# H\n\n[See your plan](dashboard)');
    expect(r.blocks[1]).toEqual({ type: 'cta', label: 'See your plan', url: `${APP}/dashboard` });
  });

  it('requires a button in a whole email', () => {
    expect(errors(parse('# H\n\nText.')).map((i) => i.found)).toContain('(no button)');
  });

  it('does not require a button in a fragment', () => {
    const r = parseEmailMarkup('Text.', { destinations: [], fragment: true });
    expect(r.issues).toEqual([]);
  });
});

describe('programme cards', () => {
  it('corrects the spelling of a real programme to the catalogue\'s', () => {
    const r = parse('# H\n\n[program: first steps to HYROX | For a first race.]\n\n[button: Go -> programs]');
    expect(r.blocks[1]).toMatchObject({ programName: 'First Steps to Hyrox' });
    expect(errors(r)).toEqual([]);
  });

  it('flags a programme that does not exist', () => {
    const r = parse('# H\n\n[program: Ultra Engine Builder | Big engine.]\n\n[button: Go -> programs]');
    expect(errors(r)[0]).toMatchObject({ kind: 'fact', found: 'Ultra Engine Builder' });
  });
});

describe('prose clean-up', () => {
  it('strips bold, italics and code marks', () => {
    const r = parse('# H\n\nThis is **really** *important* and `exact`.\n\n[button: Go -> home]');
    expect(r.blocks[1]).toEqual({ type: 'paragraph', text: 'This is really important and exact.' });
  });

  it('keeps the words of an inline link and warns about the link', () => {
    const r = parse('# H\n\nRead [the guide](https://x.com/guide) first.\n\n[button: Go -> home]');
    expect(r.blocks[1]).toEqual({ type: 'paragraph', text: 'Read the guide first.' });
    expect(r.issues.some((i) => i.severity === 'warning' && i.found === 'https://x.com/guide')).toBe(true);
  });

  it('joins soft-wrapped lines into one paragraph', () => {
    const r = parse('# H\n\nOne line\nwrapped here.\n\n[button: Go -> home]');
    expect(r.blocks[1]).toEqual({ type: 'paragraph', text: 'One line wrapped here.' });
  });

  it('reads numbered lists as bullets', () => {
    const r = parse('# H\n\n1. First\n2) Second\n\n[button: Go -> home]');
    expect(r.blocks[1]).toEqual({ type: 'bulletList', items: ['First', 'Second'] });
  });

  it('removes a code fence the model wrapped the body in', () => {
    const r = parse('```markdown\n# H\n\n[button: Go -> home]\n```');
    expect(r.blocks.map((b) => b.type)).toEqual(['hero', 'cta']);
  });

  it('keeps the words of an unknown directive instead of dropping them', () => {
    const r = parse('# H\n\n[callout: Race entries close Friday]\n\n[button: Go -> home]');
    expect(r.blocks[1]).toEqual({ type: 'paragraph', text: 'Race entries close Friday' });
    expect(r.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('reports a stats row with too few figures rather than inventing one', () => {
    const r = parse('# H\n\n[stats: 12 weeks = per programme]\n\n[button: Go -> home]');
    expect(r.blocks.some((b) => b.type === 'statRow')).toBe(false);
    expect(errors(r)[0].message).toContain('two or three');
  });
});

describe('normaliseBrand', () => {
  it('capitalises HYROX and the brand', () => {
    expect(normaliseBrand('Train for Hyrox with HybridX and Hybrid-X.')).toBe(
      'Train for HYROX with HYBRIDX and HYBRIDX.',
    );
  });

  it('leaves programme names exactly as the catalogue spells them', () => {
    expect(normaliseBrand('Start first steps to hyrox for your hyrox debut.', PROGRAMS)).toBe(
      'Start First Steps to Hyrox for your HYROX debut.',
    );
  });
});

describe('buildDestinations', () => {
  it('offers brief links first, then app pages, without trailing punctuation', () => {
    const d = buildDestinations('See https://a.com/x. Or https://a.com/x again, or https://b.com/y', APP);
    expect(d.slice(0, 2)).toEqual([
      { key: 'link-1', url: 'https://a.com/x', source: 'brief' },
      { key: 'link-2', url: 'https://b.com/y', source: 'brief' },
    ]);
    expect(d.find((x) => x.key === 'home')?.url).toBe(APP);
    expect(d.find((x) => x.key === 'dashboard')?.url).toBe(`${APP}/dashboard`);
  });
});

describe('blocksToMarkup', () => {
  it('round-trips through the parser', () => {
    const destinations = buildDestinations('', APP);
    const source = parse(`# Headline
Supporting line

Paragraph one.

## Section
- a
- b

> Quote text
> — Sam

---

[program: Hyrox Fusion Balance | Balanced.]
[stats: 12 weeks = length | 4 days = per week]
[button: Go -> dashboard]`).blocks;

    const again = parseEmailMarkup(blocksToMarkup(source, destinations), {
      destinations,
      programNames: PROGRAMS,
    }).blocks;
    expect(again).toEqual(source);
  });

  it('writes a button with no link as the add-link marker', () => {
    expect(blocksToMarkup([{ type: 'cta', label: 'Buy', url: '' }])).toBe(`[button: Buy -> ${ADD_LINK}]`);
  });
});
