// src/lib/marketing/signups-by-src.ts
//
// App sign-ups counted by where on hybridx.club they came from, for the site's
// performance page (/admin/guides/performance). Served over the bridge by
// GET /api/marketing/signups-by-src.
//
// Counts only. No address, no name, no user id crosses to the other project:
// the site needs "this article produced three trials", never who.

import { parseAcquisitionSrc } from '@/lib/acquisition-src';
import type { SubscriptionStatus } from '@/models/types';

/** Bumped when a field's meaning changes. The site checks it. */
export const SIGNUPS_BY_SRC_VERSION = 1;

export interface SrcCounts {
  /** Accounts created. */
  signups: number;
  /** Of those, still in their free trial. */
  trials: number;
  /** Of those, paying now. */
  paying: number;
}

export interface SignupRow {
  src: unknown;
  status: unknown;
}

export function emptyCounts(): SrcCounts {
  return { signups: 0, trials: 0, paying: 0 };
}

/** Adds one account to a tally. */
export function addTo(counts: SrcCounts, status: unknown): void {
  counts.signups += 1;
  if (status === ('trial' satisfies SubscriptionStatus)) counts.trials += 1;
  if (status === ('active' satisfies SubscriptionStatus)) counts.paying += 1;
}

/**
 * Tally rows per src. A row whose src is not one the site would send is left
 * out rather than counted under a made-up name.
 */
export function countBySrc(rows: Iterable<SignupRow>): Record<string, SrcCounts> {
  const out: Record<string, SrcCounts> = {};
  for (const row of rows) {
    const src = parseAcquisitionSrc(row.src);
    if (!src) continue;
    addTo((out[src] ??= emptyCounts()), row.status);
  }
  return out;
}
