// src/app/(app)/articles/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { Search, Loader2, AlertTriangle, FileText, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { Article } from '@/models/types';
import { searchArticles, createArticle } from '@/services/article-service';
import { generateArticle } from '@/ai/flows/generate-article';
import Link from 'next/link';

export default function ArticlesPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [articles, setArticles] = useState<Article[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();

    const handleSearch = async (query: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const results = await searchArticles(query);
            setArticles(results);

            if (results.length === 0 && query.length > 5) {
                await handleGenerateArticle(query);
            }
        } catch (err) {
            console.error('Error searching articles:', err);
            setError('Failed to fetch articles. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateArticle = async (prompt: string) => {
        setIsGenerating(true);
        toast({
            title: 'No article found. Creating a new one for you...',
            description: 'Our AI is crafting an article based on your query. This may take a moment.',
        });

        try {
            const aiResult = await generateArticle({ prompt });

            if (!aiResult.isRelevant) {
                toast({
                    title: 'Topic Not Relevant',
                    description: 'Please search for topics related to fitness, health, or training.',
                    variant: 'destructive',
                });
                setArticles([]); // Clear articles if the topic is not relevant
                return;
            }
            
            await createArticle({
                title: aiResult.title,
                content: aiResult.content,
                tags: aiResult.tags,
                prompt: prompt,
            });
            
            // Refetch articles to show the newly created one
            const newResults = await searchArticles(prompt);
            setArticles(newResults);

            toast({
                title: 'Article Created!',
                description: 'Your new article is now available.',
            });

        } catch (err)
        {
            console.error('Error generating article:', err);
            setError('Failed to generate a new article. The AI may be busy, please try again later.');
            toast({
                title: 'Generation Failed',
                description: 'Could not create a new article at this time.',
                variant: 'destructive'
            });
        } finally {
            setIsGenerating(false);
        }
    };

    // Initial load of recent articles
    useEffect(() => {
        handleSearch('');
    }, []);

    const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        handleSearch(searchTerm);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Training Articles</h1>
                <p className="text-muted-foreground">Explain what you would like to learn about. We'll find an article or write one for you.</p>
            </div>
            
            <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                        placeholder="e.g., 'Best recovery methods for HYROX' or 'How to improve my 5k time'"
                        className="pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button type="submit" disabled={isLoading || isGenerating}>
                    {isLoading || isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {isLoading ? 'Searching...' : isGenerating ? 'Generating...' : 'Search'}
                </Button>
            </form>

            {error && (
                <Card className="bg-destructive/10 border-destructive/50 text-destructive">
                    <CardContent className="p-4 flex items-center gap-4">
                        <AlertTriangle className="h-6 w-6" />
                        <div>
                            <p className="font-semibold">An error occurred</p>
                            <p>{error}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {(isLoading || isGenerating) && (
                     [...Array(3)].map((_, i) => (
                        <Card key={i}>
                          <CardHeader>
                            <Skeleton className="h-6 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                          </CardHeader>
                          <CardContent>
                            <Skeleton className="h-10 w-full" />
                          </CardContent>
                        </Card>
                      ))
                )}
                
                {!isLoading && !isGenerating && articles.map((article) => (
                    <Link key={article.id} href={`/articles/${article.id}`} className="flex">
                        <Card className="flex flex-col w-full hover:border-primary/50 transition-colors">
                            <CardHeader>
                                <CardTitle>{article.title}</CardTitle>
                                <CardDescription>
                                    Generated from: "{article.prompt}"
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow">
                                <p className="text-sm text-muted-foreground line-clamp-3">
                                    {article.content.substring(0, 150)}...
                                </p>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>

            {!isLoading && articles.length === 0 && !isGenerating && (
                <div className="text-center py-12 text-muted-foreground col-span-full">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-semibold text-foreground">No Articles Found</h3>
                    <p>
                        {searchTerm 
                            ? "There are no articles matching your search. Try a different query." 
                            : "No articles available yet. Start by searching for a topic."
                        }
                    </p>
                </div>
            )}
        </div>
    );
}
