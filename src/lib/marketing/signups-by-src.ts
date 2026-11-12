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

/** A subscriber that left an address on hybridx.club, as the report reads it. */
export interface EmailLead {
  src: unknown;
  srcAt: Date | null;
  userId: unknown;
}

/** An account, as the report reads it. */
export interface Account {
  acquisitionSrc: unknown;
  status: unknown;
  /** trialStartDate: the trial starts the moment the account is created. */
  signedUpAt: Date | null;
}

/**
 * Accounts credited to the page where the address was first left: the
 * subscriber carries a src, is linked to an account (the daily account sync
 * links them by address), and the address came first.
 *
 * Each account counts once. One that clicked through with a src of its own
 * is already counted under that, so it is left out here; one whose address
 * was left only after the account existed was not brought by that page.
 */
export function countViaEmail(leads: Iterable<EmailLead>, accounts: ReadonlyMap<string, Account>): Record<string, SrcCounts> {
  const out: Record<string, SrcCounts> = {};
  const seen = new Set<string>();
  for (const lead of leads) {
    const src = parseAcquisitionSrc(lead.src);
    if (!src || typeof lead.userId !== 'string' || seen.has(lead.userId)) continue;
    const account = accounts.get(lead.userId);
    if (!account || parseAcquisitionSrc(account.acquisitionSrc)) continue;
    if (!lead.srcAt || !account.signedUpAt || lead.srcAt.getTime() > account.signedUpAt.getTime()) continue;
    seen.add(lead.userId);
    addTo((out[src] ??= emptyCounts()), account.status);
  }
  return out;
}
