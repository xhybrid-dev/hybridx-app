// src/ai/flows/generate-article.ts
'use server';
/**
 * @fileOverview AI-driven article generator for user queries.
 *
 * - generateArticle - A function that creates a well-structured article based on a user's prompt.
 * - GenerateArticleInput - The input type for the generateArticle function.
 * - GenerateArticleOutput - The return type for the generateArticle function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

import { assertUser } from '@/lib/api-auth';

const GenerateArticleInputSchema = z.object({
  prompt: z.string().describe("The user's query or topic for the article."),
});
export type GenerateArticleInput = z.infer<typeof GenerateArticleInputSchema>;

const GenerateArticleOutputSchema = z.object({
  isRelevant: z.boolean().describe("Whether the user's prompt is relevant to fitness, health, or training."),
  title: z.string().describe('A compelling, SEO-friendly title for the article.'),
  content: z.string().describe('The full article content, formatted in Markdown. Should be well-structured with headings, lists, and bold text.'),
  tags: z.array(z.string()).describe('An array of 5-7 relevant keywords or search terms for the article.'),
});
export type GenerateArticleOutput = z.infer<typeof GenerateArticleOutputSchema>;


export async function generateArticle(input: GenerateArticleInput): Promise<GenerateArticleOutput> {
  // Exported from a `'use server'` module that client components import, so this
  // is a public HTTP endpoint with its id in the browser bundle. Guarded because
  // every call spends Gemini quota: unauthenticated, it was an open drain on
  // GEMINI_API_KEY. Mirrors the per-bucket limits the /api/ai/* routes use.
  await assertUser('ai:generate-article', { max: 5 });
  return generateArticleFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateArticlePrompt',
  input: {schema: GenerateArticleInputSchema},
  output: {schema: GenerateArticleOutputSchema},
  prompt: `You are an expert content creator specializing in fitness, nutrition, and athletic performance for a brand called HYBRIDX.CLUB. Your task is to generate a high-quality, informative article based on a user's prompt.

  **CRITICAL INSTRUCTIONS:**
  1.  **Relevance Check:** First, determine if the prompt is related to fitness, health, training, running, biomechanics, nutrition, or wellness. If not, set 'isRelevant' to false and return empty strings for title, content, and an empty array for tags.
  2.  **Article Generation:** If the topic is relevant, write a comprehensive, well-structured article.
      *   **Format:** The content MUST be in Markdown. Use headings (#, ##), bold text, and lists to make it readable.
      *   **Tone:** The tone should be expert, encouraging, and authoritative, but easy to understand.
      *   **Title:** Create a catchy and informative title.
      *   **Tags:** Generate an array of 5-7 relevant keywords for search purposes. These should be concise and cover the main topics of the article.
  3.  **User Prompt:** {{{prompt}}}
  
  Generate the article based on these instructions.`,
});

const generateArticleFlow = ai.defineFlow(
  {
    name: 'generateArticleFlow',
    inputSchema: GenerateArticleInputSchema,
    outputSchema: GenerateArticleOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
