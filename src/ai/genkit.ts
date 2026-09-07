import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

// Check if API key is configured
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is not configured in environment variables');
  console.error('Please add GEMINI_API_KEY to your .env.local file');
  console.error('Get your API key from: https://aistudio.google.com/app/apikey');
}

/**
 * Model IDs live here, not at the call sites.
 *
 * Preview models get retired without notice — `gemini-3-pro-preview` vanishing
 * is what took the campaign studio down — so every flow that needs something
 * other than the default names it through one of these constants and a future
 * retirement is a one-line change. Prefer generally-available IDs over
 * `-preview` ones for anything on a user-facing path.
 */
export const MODELS = {
  /**
   * Cheap and quick: short summaries, one-line copy, classification, and
   * anything a person is sitting and waiting for — the Edge Coach conversation
   * and its tool calls included. This is also the default model above, so a
   * flow that names no model gets it.
   */
  fast: 'googleai/gemini-3.5-flash-lite',
  /**
   * Long-form reasoning and structured output where nobody is watching a
   * spinner — campaign planning, journey composition, email drafting.
   */
  reasoning: 'googleai/gemini-3.7-flash',
} as const;

// Use GEMINI_API_KEY from environment
// Note: @genkit-ai/googleai is deprecated in favor of @genkit-ai/google-genai
// (same googleAI() export/API, just an actively maintained package — the old
// one hasn't shipped since Jan 2026 and doesn't know about Gemini 3.x models).
export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GEMINI_API_KEY })],
  model: MODELS.fast,
});
