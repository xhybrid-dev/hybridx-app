// src/app/(app)/articles/[articleId]/page.tsx
'use client';

import { useState, useEffect, use } from 'react';
import { getArticle } from '@/services/article-service';
import type { Article } from '@/models/types';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { format } from 'date-fns';

export default function ArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
    const [article, setArticle] = useState<Article | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Unwrap the params promise with React.use()
    const { articleId } = use(params);

    useEffect(() => {
        const fetchArticle = async () => {
            try {
                const fetchedArticle = await getArticle(articleId);
                if (fetchedArticle) {
                    setArticle(fetchedArticle);
                } else {
                    setError('Article not found.');
                }
            } catch (err) {
                setError('Failed to load the article.');
            } finally {
                setLoading(false);
            }
        };

        if (articleId) {
            fetchArticle();
        }
    }, [articleId]);
    
    if (loading) {
        return (
             <div className="max-w-4xl mx-auto space-y-6">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="h-6 w-1/2" />
                <div className="space-y-4 pt-8">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-5/6" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-3/4" />
                </div>
            </div>
        );
    }
    
    if (error) {
        return <div className="text-center text-destructive">{error}</div>;
    }
    
    if (!article) {
        return null;
    }

    return (
        <div className="max-w-4xl mx-auto">
            <Button asChild variant="outline" className="mb-6">
                <Link href="/articles">
                    <ArrowLeft className="mr-2" />
                    Back to Articles
                </Link>
            </Button>

            <article>
                <header className="mb-8">
                    <h1 className="text-4xl font-bold tracking-tight mb-2">{article.title}</h1>
                    <p className="text-muted-foreground">
                        Generated from: "{article.prompt}" on {format(article.createdAt, 'MMMM do, yyyy')}
                    </p>
                </header>
                
                <MarkdownRenderer content={article.content} />
                
                <footer className="mt-12 pt-6 border-t">
                    <h3 className="text-lg font-semibold mb-3">Related Tags</h3>
                    <div className="flex flex-wrap gap-2">
                        {article.tags.map((tag, index) => (
                            <div key={index} className="flex items-center gap-1.5 bg-muted text-muted-foreground px-3 py-1 rounded-full text-sm">
                                <Tag className="h-3.5 w-3.5" />
                                <span>{tag}</span>
                            </div>
                        ))}
                    </div>
                </footer>
            </article>
        </div>
    );
}
