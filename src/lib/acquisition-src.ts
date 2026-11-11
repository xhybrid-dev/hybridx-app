// src/lib/acquisition-src.ts
//
// `src`: where on hybridx.club a visitor came from, as the marketing site
// names it. The site adds `?src=` to every link into the app, and (from
// contract 1.3.0) sends it with a lead over the bridge. The app records it on
// the user (`acquisitionSrc`) and on the subscriber (`src`), and reports
// sign-ups per src back to the site (GET /api/marketing/signups-by-src).
//
// The shapes the site sends:
//   guide-<slug>   an article on /guides (the site's guideSrc)
//   page-<path>    any other page, its path with slashes as hyphens
//                  (page-home, page-calculators-week-planner)
//
// Declared once on each side of the repository boundary, and pinned to the
// same rule by the cross-repo tests in both repos: the site's
// src/lib/__tests__/cross-repo-agreement.test.ts and this repo's
// src/lib/__tests__/acquisition-src.test.ts. Change one, change both.

/** The query parameter, on both sides. */
export const SRC_PARAM = 'src';

/** Lowercase letters, digits and single hyphens, at most 90 characters. */
export const SRC_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SRC_MAX_LENGTH = 90;

/**
 * A src as the site sends it, or undefined.
 *
 * Untrusted (anyone can type a query string), so it is checked rather than
 * cleaned: a value that is not one of ours is dropped, not repaired into one
 * that looks like it is.
 */
export function parseAcquisitionSrc(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length <= SRC_MAX_LENGTH && SRC_PATTERN.test(v) ? v : undefined;
}
