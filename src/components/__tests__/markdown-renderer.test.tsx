import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { MarkdownRenderer } from '@/components/markdown-renderer';

const render = (content: string) => renderToStaticMarkup(<MarkdownRenderer content={content} />);

describe('MarkdownRenderer', () => {
  it('hands styling to the typography plugin and unpins the width', () => {
    const html = render('Hello.');
    expect(html).toContain('prose prose-lg max-w-none');
    // No prose-invert: the tokens prose is wired to already flip with the
    // theme, so inverting would swap in a separate, unconfigured palette.
    expect(html).not.toContain('prose-invert');
  });

  it('emits real elements for prose to style, not paragraphs pretending to be headings', () => {
    const html = render('# Title\n\n## Section\n\n- one\n- two\n\n> quoted');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Section</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
  });

  it('renders a table rather than a block of pipes (needs GFM)', () => {
    const html = render('| Week | Focus |\n| --- | --- |\n| 1 | Base |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Week</th>');
    expect(html).toContain('<td>Base</td>');
  });

  it('opens links away from the app and drops the opener', () => {
    // The one thing typography cannot express: what a link does, not how it
    // looks. Article content is generated, so it can link anywhere.
    const html = render('See [the guide](https://example.com).');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('escapes raw HTML instead of running it', () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('separates fenced blocks from inline code', () => {
    expect(render('```js\nconst a = 1;\n```')).toContain('<pre>');
    const inline = render('Use `npm ci`.');
    expect(inline).toContain('<code>npm ci</code>');
    expect(inline).not.toContain('<pre>');
  });
});
