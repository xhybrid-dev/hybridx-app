// src/app/api/marketing/signups-by-src/route.ts
//
// App sign-ups per hybridx.club src (an article, a tool, a page), for the
// site's performance page. Bridge-authenticated, counts only: see
// src/lib/marketing/signups-by-src.ts.
//
//   direct    clicked through from the site and signed up (the user's
//             acquisitionSrc, src/lib/attribution.ts)
//   viaEmail  left an address on the site first (the subscriber's src, contract
//             1.3.0), and signed up later by any route without a src of their own

import { NextResponse } from 'next/server';
import type { Timestamp } from 'firebase-admin/firestore';
import { guardBridge } from '@/lib/marketing/bridge-auth';
import { SUBSCRIBERS } from '@/lib/marketing/subscribers';
import {
  countBySrc,
  countViaEmail,
  SIGNUPS_BY_SRC_VERSION,
  type Account,
} from '@/lib/marketing/signups-by-src';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Ceiling on the documents read for each half. Only people who arrived from
 * hybridx.club carry a src, so reaching this is years away; when it is, the
 * response says so rather than passing off a partial count as the total.
 */
const MAX_DOCS = 20_000;
/** Accounts fetched per getAll call. */
const BATCH = 300;

const toDate = (v: unknown): Date | null =>
  v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null;

export async function GET(request: Request) {
  const blocked = guardBridge(request, 'signups-by-src', 60);
  if (blocked) return blocked;

  try {
    const db = getAdminDb();
    const [users, subscribers] = await Promise.all([
      db
        .collection('users')
        .where('acquisitionSrc', '!=', null)
        .select('acquisitionSrc', 'subscriptionStatus')
        .limit(MAX_DOCS + 1)
        .get(),
      db
        .collection(SUBSCRIBERS)
        .where('src', '!=', null)
        .select('src', 'srcAt', 'userId')
        .limit(MAX_DOCS + 1)
        .get(),
    ]);
    const truncated = users.size > MAX_DOCS || subscribers.size > MAX_DOCS;

    const direct = countBySrc(
      users.docs.slice(0, MAX_DOCS).map((d) => ({
        src: d.get('acquisitionSrc'),
        status: d.get('subscriptionStatus'),
      })),
    );

    const leads = subscribers.docs.slice(0, MAX_DOCS).map((d) => ({
      src: d.get('src'),
      srcAt: toDate(d.get('srcAt')),
      userId: d.get('userId'),
    }));
    const ids = [...new Set(leads.map((l) => l.userId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const accounts = new Map<string, Account>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const refs = ids.slice(i, i + BATCH).map((id) => db.collection('users').doc(id));
      const snaps = await db.getAll(...refs, { fieldMask: ['acquisitionSrc', 'subscriptionStatus', 'trialStartDate'] });
      for (const snap of snaps) {
        if (!snap.exists) continue;
        accounts.set(snap.id, {
          acquisitionSrc: snap.get('acquisitionSrc'),
          status: snap.get('subscriptionStatus'),
          signedUpAt: toDate(snap.get('trialStartDate')),
        });
      }
    }

    return NextResponse.json(
      {
        version: SIGNUPS_BY_SRC_VERSION,
        direct,
        viaEmail: countViaEmail(leads, accounts),
        truncated,
        generatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    logger.error('[marketing/signups-by-src] count failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Count failed.' }, { status: 500 });
  }
}
