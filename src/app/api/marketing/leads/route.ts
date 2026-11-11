// src/app/api/marketing/leads/route.ts
//
// Lead intake from any funnel.
//
// The marketing site captures the top of the funnel — the VO2max guide, the
// race-day card, the free plan, and whatever promotion is running this month —
// into its own Firestore project. Those people are the audience the mailing
// system exists to serve, and this is how they reach it, at write time, so
// someone is mailable seconds after submitting rather than after a nightly
// reconciliation.
//
// The payload is *parsed*, not trusted, against a single declared contract. The
// two halves of this bridge were previously two independently-written shapes
// that agreed by coincidence until they did not — see bridge-contract.ts.

import { NextResponse } from 'next/server';
import { guardBridge } from '@/lib/marketing/bridge-auth';
import {
  BRIDGE_CONTRACT_VERSION,
  describeContract,
  leadPayloadSchema,
  normaliseUtm,
} from '@/lib/marketing/bridge-contract';
import { captureLead } from '@/lib/marketing/capture';
import { getSubscriberByEmail } from '@/lib/marketing/subscribers';
import { UNMAILABLE_STATUSES } from '@/lib/marketing/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Publish the contract.
 *
 * So that building a new funnel starts by asking the system what it accepts,
 * rather than by copying an existing caller and inheriting its mistakes. Behind
 * the same auth as the POST: the field list is not secret, but there is no
 * reason to hand an unauthenticated caller a map of the intake surface.
 */
export async function GET(request: Request) {
  const blocked = guardBridge(request, 'leads-contract', 60);
  if (blocked) return blocked;

  return NextResponse.json(describeContract(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const blocked = guardBridge(request, 'leads');
  if (blocked) return blocked;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = leadPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the offending field. A funnel author debugging their first
    // integration should not have to guess which of seven fields was wrong.
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'payload';
    logger.error(`[marketing/leads] rejected payload: ${field} — ${issue?.message}`);
    return NextResponse.json(
      {
        error: `Invalid ${field}: ${issue?.message ?? 'failed validation'}`,
        field,
        contractVersion: BRIDGE_CONTRACT_VERSION,
      },
      { status: 400 },
    );
  }

  const body = parsed.data;

  const result = await captureLead({
    // The funnel's own vocabulary: an established route id, a legacy source
    // name, or the slug of a funnel launched since the last deploy. All three
    // resolve; the last registers itself rather than being swept into a bucket.
    route: body.source ?? '',
    routeHints: { property: 'website', seenFrom: 'lead-bridge' },
    email: body.email,
    name: body.name,
    tags: body.tags,
    // The funnel knows what its own form said, so its answer wins. Absent one,
    // the route's posture applies, which is the conservative reading.
    consent: body.consent,
    // The funnel's posture, not this submission's answer. Only consulted when
    // the route is new; an existing route keeps whatever it was configured with.
    consentPolicy: body.consentPolicy,
    consentMethod: body.consentMethod ?? (body.source ? `magnet:${body.source}` : 'website'),
    attribution: normaliseUtm(body.utm),
    src: body.src,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Tell the caller whether this address is suppressed, so a funnel can decide
  // what to do without a second round trip.
  const subscriber = await getSubscriberByEmail(body.email).catch(() => null);
  const suppressed = subscriber ? UNMAILABLE_STATUSES.includes(subscriber.status) : false;

  logger.log(
    `[marketing/leads] ingested ${body.source ?? 'website'} lead as route ${result.route} ` +
      `(created=${result.created}, consentGranted=${result.consentGranted})`,
  );

  return NextResponse.json({
    success: true,
    created: result.created,
    // Echoed so a funnel can log where its leads landed — and notice when a new
    // one is still filing as unclassified because its slug was malformed.
    route: result.route,
    consentGranted: result.consentGranted,
    suppressed,
    status: subscriber?.status ?? 'active',
    contractVersion: BRIDGE_CONTRACT_VERSION,
  });
}
