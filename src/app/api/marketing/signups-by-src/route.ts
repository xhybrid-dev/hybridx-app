// src/app/api/marketing/signups-by-src/route.ts
//
// App sign-ups per hybridx.club src (an article, a tool, a page), for the
// site's performance page. Bridge-authenticated, counts only: see
// src/lib/marketing/signups-by-src.ts.

import { NextResponse } from 'next/server';
import { guardBridge } from '@/lib/marketing/bridge-auth';
import { countBySrc, SIGNUPS_BY_SRC_VERSION } from '@/lib/marketing/signups-by-src';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Ceiling on the accounts read in one call. Only accounts that arrived from
 * hybridx.club carry a src, so reaching this is years away; when it is, the
 * response says so rather than passing off a partial count as the total.
 */
const MAX_ACCOUNTS = 20_000;

export async function GET(request: Request) {
  const blocked = guardBridge(request, 'signups-by-src', 60);
  if (blocked) return blocked;

  try {
    const snap = await getAdminDb()
      .collection('users')
      .where('acquisitionSrc', '!=', null)
      .select('acquisitionSrc', 'subscriptionStatus')
      .limit(MAX_ACCOUNTS + 1)
      .get();

    const truncated = snap.size > MAX_ACCOUNTS;
    const direct = countBySrc(
      snap.docs.slice(0, MAX_ACCOUNTS).map((d) => ({
        src: d.get('acquisitionSrc'),
        status: d.get('subscriptionStatus'),
      })),
    );

    return NextResponse.json(
      {
        version: SIGNUPS_BY_SRC_VERSION,
        // Clicked through from the site and signed up.
        direct,
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
