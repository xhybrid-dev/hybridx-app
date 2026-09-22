// src/app/api/marketing/webhooks/brevo/route.ts
//
// Delivery feedback from Brevo.
//
// SMTP acceptance is not delivery. A message the relay accepts can bounce
// minutes later, and a recipient can report it as spam days later — neither is
// visible at send time. Without this endpoint the list slowly fills with dead
// addresses and people who have complained, which is precisely what degrades a
// sending domain's standing.
//
// This is also the only path that can set `complained`.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { CAMPAIGNS, sendDocId } from '@/lib/marketing/queue';
import { SUBSCRIBERS, subscriberId as hashEmail } from '@/lib/marketing/subscribers';
import { suppressSubscriber } from '@/lib/marketing/subscribers';
import { interpretBrevoEvent, isActionableEvent } from '@/lib/marketing/webhook-events';
import type { Subscriber } from '@/lib/marketing/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Brevo has no request signing on transactional webhooks, so the shared secret
 * travels in the URL (`?token=`) or a header. Compared in constant time — the
 * margin is small but a timing oracle on a bearer secret is free to avoid.
 */
function isAuthorised(request: Request): boolean {
  const expected = process.env.BREVO_WEBHOOK_SECRET;
  if (!expected) return false;

  const url = new URL(request.url);
  const supplied =
    url.searchParams.get('token') ??
    request.headers.get('x-webhook-token') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface BrevoPayload {
  event?: string;
  type?: string;
  email?: string;
  'message-id'?: string;
  reason?: string;
  /** Custom headers we set at send time, echoed back by Brevo. */
  'X-Campaign-Id'?: string;
  campaignId?: string;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  if (!isAuthorised(request)) {
    logger.error('[webhooks/brevo] rejected: bad or missing secret');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: BrevoPayload | BrevoPayload[];
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Brevo sends a single object normally and an array in batch mode.
  const events = Array.isArray(payload) ? payload : [payload];
  let handled = 0;

  for (const event of events) {
    const name = event.event ?? event.type ?? '';
    const email = event.email;

    if (!name || !email) continue;
    if (!isActionableEvent(name)) continue;

    const outcome = interpretBrevoEvent(name);
    const id = hashEmail(email);
    const campaignId = event['X-Campaign-Id'] ?? event.campaignId;

    try {
      const db = getAdminDb();

      if (outcome.status) {
        const snap = await db.collection(SUBSCRIBERS).doc(id).get();

        // A complaint outranks anything already recorded. Otherwise an existing
        // suppression is left alone, so a late bounce cannot overwrite the more
        // serious reason someone is already unmailable.
        const current = (snap.data() as Subscriber | undefined)?.status;
        const shouldWrite =
          snap.exists &&
          (current === 'active' ||
            (outcome.status === 'complained' && current !== 'complained'));

        if (shouldWrite) {
          await suppressSubscriber(id, outcome.status, outcome.reason);
          logger.log(`[webhooks/brevo] ${email} -> ${outcome.status} (${name})`);
        }
      }

      if (outcome.markSendFailed && campaignId) {
        await db
          .collection(CAMPAIGNS)
          .doc(campaignId)
          .collection('sends')
          .doc(sendDocId(campaignId, id))
          .update({
            status: 'failed',
            lastError: event.reason ? `${outcome.reason}: ${event.reason}` : outcome.reason,
          })
          .catch(() => undefined); // the send row may predate this campaign's retention
      }

      handled++;
    } catch (err) {
      // Never fail the response on one bad event: Brevo retries the whole
      // batch, which would re-apply everything that already succeeded.
      logger.error(
        `[webhooks/brevo] could not handle ${name} for ${email}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return NextResponse.json({ received: events.length, handled });
}

/** Brevo's console pings the URL before saving it. */
export async function GET(request: Request) {
  return isAuthorised(request)
    ? NextResponse.json({ ok: true })
    : new NextResponse('Unauthorized', { status: 401 });
}
