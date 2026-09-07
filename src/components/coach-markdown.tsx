'use client';
//
// One renderer for everything the coach says.
//
// The coach's words appear in four places — the chat thread, the dashboard
// panel, the journal response, the daily lines — and each had grown its own
// half-map of markdown elements. That is how a reply comes out with literal
// asterisks in it: whatever the model reaches for that the map doesn't name
// renders unstyled, and Tailwind's preflight has already stripped headings and
// list markers back to plain text, so an unmapped element is invisible rather
// than merely ugly.
//
// So: one component, every element the model can produce, used everywhere.
//
// Raw HTML is deliberately not enabled (no rehype-raw). Model output is
// untrusted text; react-markdown escapes it by default and that is the
// behaviour we want.

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

/**
 * `block` — a full reply: paragraphs, lists, the occasional table.
 * `compact` — the same, with tighter spacing for a small panel.
 * `inline` — a single line (a greeting, a daily tip). Emphasis and links still
 *   render, but a stray heading or list is flattened rather than given
 *   block spacing it has no room for.
 */
export type CoachMarkdownVariant = 'block' | 'compact' | 'inline';

function buildComponents(variant: CoachMarkdownVariant): Components {
  const inline = variant === 'inline';
  const gap = variant === 'compact' ? 'mb-2' : 'mb-3';
  const listGap = variant === 'compact' ? 'mb-2 pl-4' : 'mb-3 pl-5';

  // In the inline variant every block collapses to a span, so a stray heading
  // or list in a one-line summary can never blow out the layout it sits in.
  const Span = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;

  const heading = (classes: string) =>
    inline
      ? Span
      : ({ children }: { children?: React.ReactNode }) => <p className={classes}>{children}</p>;

  return {
    p: ({ children }) =>
      inline ? <span>{children}</span> : <p className={cn(gap, 'leading-relaxed')}>{children}</p>,

    // The prompt asks for no headings, but models produce them anyway. Without
    // these they render at body size with no spacing — indistinguishable from
    // the text around them.
    h1: heading('mb-2 mt-3 text-base font-semibold first:mt-0'),
    h2: heading('mb-2 mt-3 text-base font-semibold first:mt-0'),
    h3: heading('mb-1 mt-3 text-sm font-semibold first:mt-0'),
    h4: heading('mb-1 mt-3 text-sm font-semibold first:mt-0'),
    h5: heading('mb-1 mt-2 text-sm font-semibold first:mt-0'),
    h6: heading('mb-1 mt-2 text-sm font-semibold first:mt-0'),

    ul: ({ children }) =>
      inline ? (
        <span>{children}</span>
      ) : (
        // `[&_ul]` / `[&_ol]` stop a nested list inheriting the outer list's
        // bottom margin, which otherwise leaves a gap mid-list.
        <ul className={cn('list-disc space-y-1', listGap, '[&_ul]:mb-0 [&_ol]:mb-0 [&_ul]:mt-1 [&_ol]:mt-1')}>
          {children}
        </ul>
      ),
    ol: ({ children }) =>
      inline ? (
        <span>{children}</span>
      ) : (
        <ol className={cn('list-decimal space-y-1', listGap, '[&_ul]:mb-0 [&_ol]:mb-0 [&_ul]:mt-1 [&_ol]:mt-1')}>
          {children}
        </ol>
      ),
    li: ({ children }) =>
      inline ? <span>{children} </span> : <li className="leading-relaxed">{children}</li>,

    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through opacity-70">{children}</del>,

    a: ({ children, href }) => (
      <a
        href={href}
        // Model output can carry a link anywhere; open it away from the app and
        // never hand the opened page a usable window.opener.
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-medium underline underline-offset-2"
      >
        {children}
      </a>
    ),

    blockquote: ({ children }) =>
      inline ? (
        <span>{children}</span>
      ) : (
        <blockquote className={cn('border-l-2 border-border pl-3 italic opacity-90', gap)}>
          {children}
        </blockquote>
      ),

    // `pre` owns the scroll container; `code` styles the run of text. Splitting
    // them is what stops a fenced block being painted as an inline pill and
    // pushing the whole bubble sideways.
    pre: ({ children }) =>
      inline ? (
        <span>{children}</span>
      ) : (
        <pre className={cn('overflow-x-auto rounded-md bg-background/70 p-3 text-xs', gap)}>
          {children}
        </pre>
      ),
    code: ({ children, className }) => {
      const isBlock = /language-/.test(className ?? '');
      if (isBlock) return <code className="font-mono">{children}</code>;
      return (
        <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]">
          {children}
        </code>
      );
    },

    hr: () => (inline ? null : <hr className="my-3 border-border" />),

    // Tables only exist at all because of remark-gfm; a week's plan laid out as
    // one is otherwise delivered as a wall of pipe characters.
    table: ({ children }) =>
      inline ? (
        <span>{children}</span>
      ) : (
        <div className={cn('overflow-x-auto', gap)}>
          <table className="w-full border-collapse text-left text-xs">{children}</table>
        </div>
      ),
    thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-b border-border/50 last:border-0">{children}</tr>,
    th: ({ children }) => <th className="px-2 py-1 font-semibold">{children}</th>,
    td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,

    img: ({ alt }) => <span className="text-xs opacity-70">{alt || ''}</span>,
  };
}

const BLOCK_COMPONENTS = buildComponents('block');
const COMPACT_COMPONENTS = buildComponents('compact');
const INLINE_COMPONENTS = buildComponents('inline');

export function CoachMarkdown({
  content,
  variant = 'block',
  className,
}: {
  content: string;
  variant?: CoachMarkdownVariant;
  className?: string;
}) {
  const components =
    variant === 'inline'
      ? INLINE_COMPONENTS
      : variant === 'compact'
        ? COMPACT_COMPONENTS
        : BLOCK_COMPONENTS;

  return (
    <div
      className={cn(
        'leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        variant === 'inline' && 'inline',
        className,
      )}
    >
      <ReactMarkdown
        // gfm: tables, strikethrough, autolinks, task lists.
        // breaks: a single newline is a line break, because that is what
        // someone typing a message means by it — without this, a coach reply
        // written as three short lines arrives as one run-on paragraph.
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
