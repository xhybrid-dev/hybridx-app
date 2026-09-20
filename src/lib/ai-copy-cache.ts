// src/lib/ai-copy-cache.ts
'use client';
//
// Day-scoped cache for generated coaching copy.
//
// The dashboard's two Gemini calls (dashboardSummary, workoutSummary) were made
// on every mount. The `useRef` guarding them resets on unmount, so navigating
// dashboard -> calendar -> dashboard re-spent both. Their inputs — programme
// name, day number, weekly counts, workout title — change at most once a day, so
// the copy is day-stable and there was nothing to gain from regenerating it.
//
// That mattered twice over: the coaching line is the dashboard's primary
// content, so the page waited on a model to render it (with a deliberate 1s
// stagger between the two calls to avoid collision), and at any real DAU two
// calls per dashboard open dominated the AI bill.
//
// Keyed by a caller-supplied fingerprint of the inputs, so anything that should
// change the copy — a finished workout, a new note, a different day — misses the
// cache naturally rather than needing explicit invalidation.

import { logger } from '@/lib/logger';

const PREFIX = 'aiCopy:';

/** Today as YYYY-MM-DD in the viewer's own timezone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build a cache key. `parts` should include everything the copy depends on;
 * anything omitted is something a change to which will serve stale text.
 */
export function aiCopyKey(kind: string, userId: string, ...parts: (string | number | null | undefined)[]): string {
  // Joined with a separator that cannot appear in a date or an id, then length-
  // capped: some parts are free text (workout titles, notes) and localStorage
  // keys should not grow without bound.
  const fingerprint = parts.map(p => String(p ?? '')).join('\u001f').slice(0, 512);
  return `${PREFIX}${today()}:${kind}:${userId}:${hash(fingerprint)}`;
}

/** Small non-cryptographic hash — this names a cache entry, nothing more. */
function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Cached copy for this key, or null. Never throws. */
export function readAiCopy(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode, blocked site data, or SSR — treat as a miss.
    return null;
  }
}

/** Store copy for this key and drop entries from previous days. Never throws. */
export function writeAiCopy(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);

    // Prune, so this cannot grow forever: anything under our prefix that is not
    // from today is unreachable by aiCopyKey and only taking up quota.
    const stale = `${PREFIX}${today()}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && !k.startsWith(stale)) localStorage.removeItem(k);
    }
  } catch (error) {
    // A full or unavailable store must not break the page — the copy is already
    // rendered by the time we get here.
    logger.error('Failed to cache AI copy:', error);
  }
}
