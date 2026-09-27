// src/lib/marketing/app-routes.ts
//
// The single list of app routes a marketing email may link to.
//
// This exists because two independent things need the same answer to "what
// pages does the app actually have": the drafting prompt, so the model links
// somewhere real instead of inventing a path, and the post-generation
// validator, so an invented path is caught even if the model ignores the
// prompt. A prompt and a validator built from separately-maintained lists is
// exactly the shape of bug that reappears every few months as the two drift —
// one file gets a new route added, the other does not — so there is one list
// here and both read from it.
//
// Kept to routes that make sense as an external destination someone clicks
// into from their inbox: no /admin, no /debug, nothing dev-only, nothing that
// assumes an in-progress session such as /workout/active. Source of truth for
// what exists at all is the folder names under src/app/(app)/ — `(app)` is a
// Next.js route group and contributes nothing to the URL itself.
//
// Update this file, not the prompt or the validator, when a page marketing
// should be able to link to is added or removed.

export const APP_MARKETING_PATHS = [
  // The bare root, not just a fallback string elsewhere — src/app/page.tsx
  // redirects a signed-in reader straight to /dashboard and shows the public
  // landing page to anyone else. That makes it the one destination that is
  // correct whether or not the person clicking is currently logged in, which
  // a marketing email cannot know in advance. It is the default a CTA gets
  // when no more specific page is chosen — see defaultCtaUrl below.
  '/',
  '/dashboard',
  '/training',
  '/programs',
  '/calendar',
  '/activity-feed',
  '/coach',
  '/subscription',
  '/articles',
  '/profile',
  '/vdot',
] as const;

/** Path prefixes covering a dynamic segment, e.g. /programs/abc123/view. */
export const APP_MARKETING_PATH_PREFIXES = ['/programs/', '/articles/'] as const;

export function isKnownAppPath(pathname: string): boolean {
  const trimmed = pathname.replace(/\/$/, '') || '/';
  if ((APP_MARKETING_PATHS as readonly string[]).includes(trimmed)) return true;
  return APP_MARKETING_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Where a CTA lands when the author leaves the URL blank.
 *
 * Reads the same env var the rest of the app uses for its own base URL, so
 * this cannot name a different host in one environment (a preview deploy,
 * say) than everything else already resolves to. Trailing slash stripped so
 * a value with one does not turn "/dashboard" into "//dashboard" when a path
 * is appended to it elsewhere.
 */
export function defaultCtaUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.hybridx.club';
  return base.replace(/\/$/, '');
}
