// src/components/markdown-renderer.tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

/**
 * Long-form markdown — generated articles.
 *
 * This used to hand-map every element, because the `prose` classes it carried
 * were inert: `@tailwindcss/typography` was never installed. That map was
 * always going to be incomplete, and an element it missed didn't render badly,
 * it rendered invisibly — Tailwind's preflight strips headings and list markers
 * back to plain text, so an unmapped heading is indistinguishable from body
 * copy.
 *
 * The plugin is installed now and configured against the app's design tokens
 * (see `typography` in tailwind.config.ts), so element styling belongs there,
 * not here. What remains below is behaviour that typography cannot express.
 *
 * Note there is deliberately no `dark:prose-invert`: the tokens prose is wired
 * to already flip with the theme, and prose-invert would swap in a separate,
 * unconfigured palette on top of them.
 *
 * Short-form coach replies use `coach-markdown.tsx` instead. Chat bubbles need
 * their own spacing and an inline variant, and tying them to article typography
 * would mean restyling articles silently restyles the coach.
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
    return (
        <div className={cn('prose prose-lg max-w-none', className)}>
            <ReactMarkdown
                // Tables, strikethrough, task lists and autolinks. Without this a
                // table in a generated article arrives as a block of pipes.
                remarkPlugins={[remarkGfm]}
                components={{
                    // Styling comes from prose; this is here for what an article
                    // link does, not how it looks. Generated content can link
                    // anywhere, so it opens away from the app and never hands the
                    // opened page a usable window.opener.
                    a: ({ node, ...props }) => (
                        <a target="_blank" rel="noopener noreferrer nofollow" {...props} />
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
