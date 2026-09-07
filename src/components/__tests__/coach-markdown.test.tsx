import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { CoachMarkdown } from '@/components/coach-markdown';

// Rendered to static HTML rather than into a DOM: this asserts the thing that
// actually broke — what markdown turns into — without pulling in jsdom.
const render = (content: string, variant?: 'block' | 'compact' | 'inline') =>
  renderToStaticMarkup(<CoachMarkdown content={content} variant={variant} />);

describe('CoachMarkdown', () => {
  it('renders emphasis rather than printing the asterisks', () => {
    const html = render('Keep it **easy** today, not *hard*.');
    expect(html).toContain('<strong class="font-semibold">easy</strong>');
    expect(html).toContain('<em class="italic">hard</em>');
    expect(html).not.toContain('**');
  });

  it('gives lists their markers back', () => {
    // Tailwind preflight strips list-style, so an unstyled <ul> renders as
    // unmarked text — the class is what makes it look like a list at all.
    const html = render('- sled push\n- wall balls');
    expect(html).toContain('list-disc');
    expect(html).toContain('<li class="leading-relaxed">sled push</li>');

    const ordered = render('1. warm up\n2. work set');
    expect(ordered).toContain('list-decimal');
  });

  it('nests a sub-list inside its parent item, without a gap mid-list', () => {
    const html = render('- session\n    - warm up\n    - main set');

    // The sub-list must live inside the <li>, not after it.
    expect(html).toMatch(/<li[^>]*>session\s*<ul/);
    expect(html).toContain('<li class="leading-relaxed">warm up</li>');
    // And the outer list cancels the inner one's bottom margin, which would
    // otherwise open a gap in the middle of the list. (Class attributes are
    // HTML-escaped on the way out, so match the unambiguous tail of it.)
    expect(html).toContain('_ul]:mb-0');
  });

  it('renders a table instead of a wall of pipes (needs GFM)', () => {
    const html = render('| Day | Session |\n| --- | --- |\n| Mon | Easy run |');
    expect(html).toContain('<table');
    expect(html).toContain('<th class="px-2 py-1 font-semibold">Day</th>');
    expect(html).toContain('<td class="px-2 py-1 align-top">Easy run</td>');
    // Wide tables scroll inside themselves rather than stretching the bubble.
    expect(html).toContain('overflow-x-auto');
  });

  it('supports the rest of GFM', () => {
    expect(render('~~dropped~~')).toContain('line-through');
    expect(render('- [x] done\n- [ ] not')).toContain('type="checkbox"');
  });

  it('treats a single newline as a line break', () => {
    // Someone typing a message means a new line by pressing return once; without
    // remark-breaks these two lines run together into one sentence.
    const html = render('Nice work today.\nRest up tonight.');
    expect(html).toContain('<br');
  });

  it('separates a fenced code block from inline code', () => {
    const block = render('```js\nconst pace = 300;\n```');
    expect(block).toContain('<pre class="overflow-x-auto');

    const inline = render('Set it to `300`.');
    expect(inline).not.toContain('<pre');
    expect(inline).toContain('<code class="rounded');
  });

  it('opens links away from the app and drops the opener', () => {
    const html = render('See [the guide](https://example.com/guide).');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('escapes raw HTML instead of running it', () => {
    // Model output is untrusted text. rehype-raw is deliberately not enabled,
    // so tags arrive as visible characters rather than as elements.
    const html = render('<img src=x onerror="alert(1)"> and <b>bold</b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('styles headings the model produces even though it is told not to', () => {
    const html = render('### Today\nEasy run.');
    expect(html).toContain('font-semibold');
    expect(html).not.toContain('###');
  });

  it('flattens blocks in the inline variant so a one-liner stays one line', () => {
    const html = render('**Nice.**\n\n- a\n- b', 'inline');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<p');
    expect(html).toContain('<strong class="font-semibold">Nice.</strong>');
  });

  it('tightens spacing in the compact variant', () => {
    expect(render('one\n\ntwo', 'compact')).toContain('mb-2');
    expect(render('one\n\ntwo', 'block')).toContain('mb-3');
  });

  it('renders an empty reply as nothing at all', () => {
    const html = render('');
    // A wrapper with no content — no stray empty paragraph taking up space.
    expect(html).toMatch(/^<div class="[^"]*"><\/div>$/);
  });
});
