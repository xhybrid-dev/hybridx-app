// src/components/markdown-renderer.tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
    content: string;
}

// Every element the model can produce needs naming here. Tailwind's preflight
// strips headings and list markers back to plain text, so anything left out
// doesn't render badly — it renders invisibly, as an unstyled run of text.
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
    return (
        <div className="prose prose-lg dark:prose-invert max-w-none">
            <ReactMarkdown
                // Tables, strikethrough and autolinks. Without this a table in a
                // generated article arrives as a block of pipe characters.
                remarkPlugins={[remarkGfm]}
                components={{
                    h1: ({node, ...props}) => <h1 className="text-3xl font-bold mb-4" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-2xl font-semibold mt-6 mb-3" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-xl font-semibold mt-4 mb-2" {...props} />,
                    p: ({node, ...props}) => <p className="leading-relaxed mb-4" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-2" {...props} />,
                    li: ({node, ...props}) => <li className="mb-1" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                    h4: ({node, ...props}) => <h4 className="text-lg font-semibold mt-4 mb-2" {...props} />,
                    h5: ({node, ...props}) => <h5 className="text-base font-semibold mt-3 mb-2" {...props} />,
                    h6: ({node, ...props}) => <h6 className="text-base font-semibold mt-3 mb-2" {...props} />,
                    em: ({node, ...props}) => <em className="italic" {...props} />,
                    del: ({node, ...props}) => <del className="line-through opacity-70" {...props} />,
                    a: ({node, ...props}) => (
                        <a
                            className="font-medium underline underline-offset-2"
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            {...props}
                        />
                    ),
                    blockquote: ({node, ...props}) => (
                        <blockquote className="border-l-4 border-border pl-4 italic my-4 opacity-90" {...props} />
                    ),
                    hr: ({node, ...props}) => <hr className="my-6 border-border" {...props} />,
                    // `pre` owns the scroll container, `code` only styles the text —
                    // otherwise a fenced block is painted as an inline pill and
                    // pushes the article sideways.
                    pre: ({node, ...props}) => (
                        <pre className="overflow-x-auto rounded-md bg-muted p-4 text-sm mb-4" {...props} />
                    ),
                    code: ({node, className, ...props}) =>
                        /language-/.test(className ?? '') ? (
                            <code className="font-mono" {...props} />
                        ) : (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]" {...props} />
                        ),
                    table: ({node, ...props}) => (
                        <div className="overflow-x-auto mb-4">
                            <table className="w-full border-collapse text-left text-sm" {...props} />
                        </div>
                    ),
                    thead: ({node, ...props}) => <thead className="border-b border-border" {...props} />,
                    tr: ({node, ...props}) => <tr className="border-b border-border/50 last:border-0" {...props} />,
                    th: ({node, ...props}) => <th className="px-3 py-2 font-semibold" {...props} />,
                    td: ({node, ...props}) => <td className="px-3 py-2 align-top" {...props} />,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
