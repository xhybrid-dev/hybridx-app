// src/lib/marketing/queue.ts
//
// The send pipeline.
//
// HXMailer sent campaigns inside a single server action: a sequential loop with
// a 150 ms sleep per recipient, hard-truncated at 500 recipients, with no
// resumability and no retry. If the request timed out halfway, the campaign was
// left in an unknown state and re-running it would email the first half twice.
//
// Here a send is enqueued as one document per recipient and drained by a cron
// that can run as many times as it needs to. The properties that follow:
//
//   - No recipient cap. A large campaign simply takes more invocations.
//   - Crash-safe. A drain that dies mid-batch leaves the remaining rows
//     `pending`; the next run picks them up.
//   - Idempotent. Send documents are keyed `${campaignId}_${subscriberId}`, so
//     re-enqueueing cannot create a second send for the same person.
//   - Inspectable. A half-sent campaign shows exact progress rather than being
//     an opaque in-flight state.

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import {
  assignVariant,
  HELD_VARIANT,
  isReadyToDecide,
  pickWinner,
  subjectForSend,
  type AbTestConfig,
  type VariantResult,
} from './ab-testing';
import { renderForSubscriber } from './personalise';
import { resolveSegment, type SegmentDefinition } from './segments';
import { SUBSCRIBERS } from './subscribers';
import { sendBulkMessage } from './transport';
import {
  DEFAULT_MARKETING_SETTINGS,
  type Campaign,
  type MarketingSettings,
  type Send,
  type Subscriber,
} from './types';

export const CAMPAIGNS = 'marketingCampaigns';
export const SETTINGS_DOC = 'marketingSettings/config';

/** Retry a temporarily-failed send this many times before giving up. */
const MAX_ATTEMPTS = 3;

/** Deterministic send id — the property the whole queue's safety rests on. */
export function sendDocId(campaignId: string, subscriberId: string): string {
  return `${campaignId}_${subscriberId}`;
}

export async function getSettings(): Promise<MarketingSettings> {
  const snap = await getAdminDb().doc(SETTINGS_DOC).get();
  return { ...DEFAULT_MARKETING_SETTINGS, ...(snap.data() as Partial<MarketingSettings> | undefined) };
}

export interface EnqueueResult {
  campaignId: string;
  queued: number;
  /** Already had a send row from a previous enqueue — not queued again. */
  alreadyQueued: number;
  excluded: { suppressed: number; noConsent: number; failedPredicates: number };
}

/**
 * Resolve a campaign's audience and write one pending send row per recipient.
 *
 * Enqueueing is separated from sending so the expensive, failure-prone part
 * (SMTP) never blocks the part that decides who is included. It also means the
 * audience is frozen at enqueue time: a subscriber who unsubscribes mid-send is
 * still skipped, because the drain re-checks status per message, but someone
 * who joins mid-send is not silently added to a campaign already in flight.
 */
/**
 * The audience a campaign's own stored choice describes.
 *
 * `segment` is what the admin actually picked and saw a count for in the
 * studio or editor, including athlete predicates. `targetTags` is the older,
 * tags-only shape kept for campaigns migrated from HXMailer; reading it in
 * preference would silently widen the audience of any campaign whose segment
 * used predicates the tags-only shape cannot express.
 *
 * Shared by every caller that needs to (re-)enqueue a campaign from what it
 * was actually configured with — the send cron for a scheduled campaign
 * coming due, and resumeCampaign for one being resumed without ever having
 * been enqueued — so the fallback rule lives in one place rather than in each
 * caller, quietly drifting apart the next time one of them is edited.
 */
export function campaignAudience(
  campaign: Pick<Campaign, 'segment' | 'targetTags'>,
): SegmentDefinition {
  return (
    (campaign.segment as SegmentDefinition | undefined) ??
    (campaign.targetTags?.length ? { anyTags: campaign.targetTags } : {})
  );
}

export async function enqueueCampaign(
  campaignId: string,
  segment: SegmentDefinition,
): Promise<EnqueueResult> {
  const db = getAdminDb();
  const campaignRef = db.collection(CAMPAIGNS).doc(campaignId);
  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) throw new Error(`Campaign ${campaignId} not found.`);

  const campaign = campaignSnap.data() as Campaign;
  if (campaign.status === 'sending' || campaign.status === 'sent') {
    throw new Error(`Campaign ${campaignId} is already ${campaign.status}.`);
  }

  const audience = await resolveSegment(segment);
  const sendsRef = campaignRef.collection('sends');
  const abTest = campaign.abTest as AbTestConfig | undefined;

  let queued = 0;
  let alreadyQueued = 0;

  const writer = db.bulkWriter();
  const BATCH = 300;

  for (let i = 0; i < audience.subscribers.length; i += BATCH) {
    const slice = audience.subscribers.slice(i, i + BATCH);
    const refs = slice.map((s) => sendsRef.doc(sendDocId(campaignId, s.id)));
    const existing = await db.getAll(...refs);

    slice.forEach((sub, idx) => {
      if (existing[idx]?.exists) {
        alreadyQueued++;
        return;
      }
      const row: Omit<Send, 'id'> = {
        campaignId,
        subscriberId: sub.id,
        email: sub.email,
        status: 'pending',
        attempts: 0,
        queuedAt: FieldValue.serverTimestamp(),
        sentAt: null,
        opened: false,
        openedAt: null,
        openRaw: 0,
        clicked: false,
        clickedAt: null,
        // Assigned at enqueue and never recomputed. Deterministic on
        // (campaign, subscriber), so a retry cannot hand someone a different
        // subject than their first attempt carried.
        ...(abTest ? { variant: assignVariant(campaignId, sub.id, abTest) } : {}),
      };
      writer.set(refs[idx], row);
      queued++;
    });
  }

  await writer.close();

  await campaignRef.update({
    status: 'sending',
    recipientCount: queued + alreadyQueued,
    sendState: {
      total: queued + alreadyQueued,
      sent: 0,
      failed: 0,
      startedAt: FieldValue.serverTimestamp(),
      finishedAt: null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.log(`[marketing] enqueued campaign ${campaignId}: ${queued} queued, ${alreadyQueued} already present`);
  return { campaignId, queued, alreadyQueued, excluded: audience.excluded };
}

export interface DrainResult {
  campaignId: string;
  attempted: number;
  sent: number;
  failed: number;
  /** True when no pending rows remain and the campaign has been finalised. */
  complete: boolean;
}

/**
 * Send up to `limit` pending messages for one campaign.
 *
 * Each row is claimed with a transaction that moves it out of `pending` before
 * any SMTP call happens. Two overlapping drains therefore cannot both claim the
 * same recipient — which matters because the cron may fire again while a slow
 * batch is still running.
 */
export async function drainCampaign(campaignId: string, limit: number): Promise<DrainResult> {
  const db = getAdminDb();
  const campaignRef = db.collection(CAMPAIGNS).doc(campaignId);
  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) throw new Error(`Campaign ${campaignId} not found.`);

  const campaign = { id: campaignSnap.id, ...campaignSnap.data() } as Campaign;
  const settings = await getSettings();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';

  // An A/B test in progress may need its winner picking before the held
  // remainder can go out.
  const abTest = await resolveAbWinner(campaignId, campaign);

  const pending = await campaignRef
    .collection('sends')
    .where('status', '==', 'pending')
    .limit(limit)
    .get();

  const result: DrainResult = { campaignId, attempted: 0, sent: 0, failed: 0, complete: false };

  for (const doc of pending.docs) {
    const send = { id: doc.id, ...doc.data() } as Send;

    // Held recipients wait for the test to conclude. Left pending, so the next
    // drain after the decision picks them up.
    if (abTest && send.variant === HELD_VARIANT && abTest.winnerIndex === undefined) {
      continue;
    }

    // Claim the row. If another drain got there first the transaction returns
    // false and we move on without sending. The claim is stamped with its own
    // time — recovery keys on claimedAt, and measuring staleness from any
    // earlier timestamp would let an overlapping cron invocation "recover" a
    // row this one claimed seconds ago, sending it twice.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (fresh.data()?.status !== 'pending') return false;
      tx.update(doc.ref, {
        status: 'sending',
        attempts: FieldValue.increment(1),
        claimedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) continue;

    result.attempted++;

    // Re-read the subscriber rather than trusting the snapshot taken at enqueue
    // time: someone who unsubscribed while the campaign was in flight must not
    // receive it, and on a long send that gap can be hours.
    const subSnap = await db.collection(SUBSCRIBERS).doc(send.subscriberId).get();
    const sub = subSnap.exists ? ({ id: subSnap.id, ...subSnap.data() } as Subscriber) : null;

    if (!sub || sub.status !== 'active' || sub.consent?.marketing !== true) {
      await doc.ref.update({
        status: 'failed',
        lastError: 'Recipient became unmailable after enqueue',
      });
      result.failed++;
      continue;
    }

    const rendered = renderForSubscriber({
      campaignId,
      subject: abTest
        ? subjectForSend(abTest, send.variant ?? HELD_VARIANT, campaign.subject)
        : campaign.subject,
      htmlBody: campaign.htmlBody,
      subscriber: sub,
      appUrl,
    });

    const outcome = await sendBulkMessage({
      to: sub.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: rendered.unsubscribeUrl,
      campaignId,
      senderName: settings.senderName,
      replyTo: settings.replyTo || undefined,
    });

    if (outcome.ok) {
      await doc.ref.update({ status: 'sent', sentAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete() });
      await campaignRef.update({ 'sendState.sent': FieldValue.increment(1) });
      await db.collection(SUBSCRIBERS).doc(sub.id).update({
        totalSent: FieldValue.increment(1),
        lastSentAt: FieldValue.serverTimestamp(),
      });
      result.sent++;
      continue;
    }

    // A hard bounce takes the subscriber off the list; a soft failure goes back
    // to pending for the next drain, until MAX_ATTEMPTS.
    if (outcome.permanent) {
      await doc.ref.update({ status: 'failed', lastError: outcome.error ?? 'Permanent failure' });
      await db.collection(SUBSCRIBERS).doc(sub.id).update({
        status: 'bounced',
        statusReason: outcome.error ?? 'Hard bounce',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await campaignRef.update({ 'sendState.failed': FieldValue.increment(1) });
      result.failed++;
    } else if (send.attempts + 1 >= MAX_ATTEMPTS) {
      await doc.ref.update({ status: 'failed', lastError: outcome.error ?? 'Retries exhausted' });
      await campaignRef.update({ 'sendState.failed': FieldValue.increment(1) });
      result.failed++;
    } else {
      await doc.ref.update({ status: 'pending', lastError: outcome.error ?? 'Temporary failure' });
    }
  }

  result.complete = await finaliseIfDone(campaignId);
  return result;
}

/**
 * Mark a campaign sent once nothing is left to do.
 *
 * Checks for both `pending` and `sending` rows: a row stuck in `sending`
 * because a drain was killed mid-flight must not be mistaken for a finished
 * campaign.
 */
export async function finaliseIfDone(campaignId: string): Promise<boolean> {
  const campaignRef = getAdminDb().collection(CAMPAIGNS).doc(campaignId);

  const [pending, inFlight] = await Promise.all([
    campaignRef.collection('sends').where('status', '==', 'pending').limit(1).get(),
    campaignRef.collection('sends').where('status', '==', 'sending').limit(1).get(),
  ]);
  // Held A/B recipients are still `pending`, so this correctly refuses to
  // finalise a campaign whose remainder has not gone out yet.
  if (!pending.empty || !inFlight.empty) return false;

  const snap = await campaignRef.get();
  const campaign = snap.data() as Campaign | undefined;
  if (!campaign || campaign.status === 'sent') return true;

  await campaignRef.update({
    status: 'sent',
    sentAt: FieldValue.serverTimestamp(),
    failedCount: campaign.sendState?.failed ?? 0,
    'sendState.finishedAt': FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.log(`[marketing] campaign ${campaignId} complete`);

  // Settle the aggregates from the sends themselves, so a campaign that reached
  // `sent` by any route cannot be left reporting zero recipients. Best effort:
  // the campaign is already sent, and this is only the report catching up.
  await recomputeCampaignCounts(campaignId).catch((err) =>
    logger.error(
      `[marketing] could not settle counts for ${campaignId}:`,
      err instanceof Error ? err.message : String(err),
    ),
  );
  return true;
}

/**
 * Requeue rows left in `sending` by a drain that was killed mid-batch.
 *
 * Safe because a claimed-but-unsent row has, by definition, not been handed to
 * SMTP — the claim happens first precisely so this recovery is possible.
 *
 * Staleness is measured from `claimedAt`, never from `queuedAt`. The send cron
 * fires every minute with a five-minute budget, so overlapping invocations are
 * normal; on any campaign older than the threshold, an enqueue-time measure
 * would let invocation B recover rows invocation A claimed seconds ago — and
 * then both would send. A row claimed by a *live* drain is always fresher than
 * the threshold, so it is never stolen.
 */
export async function recoverStalledSends(campaignId: string, olderThanMs = 10 * 60_000): Promise<number> {
  const campaignRef = getAdminDb().collection(CAMPAIGNS).doc(campaignId);
  const stalled = await campaignRef.collection('sends').where('status', '==', 'sending').get();

  const cutoff = Date.now() - olderThanMs;
  let recovered = 0;
  const writer = getAdminDb().bulkWriter();

  for (const doc of stalled.docs) {
    const data = doc.data() as Send;

    if (!isStalled(data, cutoff)) continue;

    if ((data.attempts ?? 0) >= MAX_ATTEMPTS) {
      writer.update(doc.ref, { status: 'failed', lastError: 'Stalled and out of attempts' });
    } else {
      writer.update(doc.ref, { status: 'pending', lastError: 'Recovered from stalled send' });
    }
    recovered++;
  }

  await writer.close();
  if (recovered) logger.log(`[marketing] recovered ${recovered} stalled sends for ${campaignId}`);
  return recovered;
}

/**
 * Whether a `sending` row is genuinely abandoned, judged by claim time.
 *
 * Exported for tests. A row with no `claimedAt` at all predates this field (or
 * was written by a version that crashed between status and stamp) — treat it as
 * stalled, since the alternative is a row stuck in `sending` forever.
 */
export function isStalled(row: Pick<Send, 'claimedAt'>, cutoffMs: number): boolean {
  const claimed = row.claimedAt as { toMillis?: () => number } | Date | null | undefined;
  const claimedMs =
    claimed instanceof Date
      ? claimed.getTime()
      : (claimed?.toMillis?.() ?? 0);

  return !claimedMs || claimedMs <= cutoffMs;
}

/**
 * Whether a scheduled campaign is so overdue that sending it now would surprise.
 *
 * Exported for tests, and kept pure for the same reason `isStalled` is: the
 * decision is the part worth pinning down, not the Firestore round trip.
 *
 * A campaign with no `scheduledAt` at all is never stale. It cannot be judged
 * late, and quarantining on a missing field would take campaigns out of the
 * queue for a data problem rather than a timing one.
 */
export function isStaleSchedule(
  scheduledAt: unknown,
  nowMs: number,
  staleAfterHours: number,
): boolean {
  const stamp = scheduledAt as { toMillis?: () => number } | Date | null | undefined;
  const scheduledMs = stamp instanceof Date ? stamp.getTime() : (stamp?.toMillis?.() ?? 0);
  if (!scheduledMs) return false;

  // A non-positive window would quarantine everything the instant it came due,
  // including campaigns sending normally. Treat it as "no staleness rule".
  if (!(staleAfterHours > 0)) return false;

  return nowMs - scheduledMs > staleAfterHours * 60 * 60_000;
}

/**
 * Move overdue scheduled campaigns to `paused` before the drain looks for work.
 *
 * This is the guard against a recovery burst. `findDueCampaigns` matches on
 * `scheduledAt <= now` with no lower bound, so after any outage of the send
 * cron every campaign that came due while it was down is still sitting there
 * and would go out together on the first successful run.
 *
 * They are paused rather than failed or deleted: `paused` already exists, shows
 * in the campaigns table, keeps the audience and content intact, and needs a
 * person to decide the campaign is still worth sending. Returns what it paused
 * so the caller can say so.
 */
export async function pauseStaleScheduled(staleAfterHours: number): Promise<
  { campaignId: string; hoursLate: number }[]
> {
  const db = getAdminDb();
  const now = Date.now();

  const snap = await db
    .collection(CAMPAIGNS)
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', new Date(now))
    .get();

  const paused: { campaignId: string; hoursLate: number }[] = [];

  for (const doc of snap.docs) {
    const scheduledAt = doc.data().scheduledAt;
    if (!isStaleSchedule(scheduledAt, now, staleAfterHours)) continue;

    const stamp = scheduledAt as { toMillis?: () => number } | Date;
    const scheduledMs = stamp instanceof Date ? stamp.getTime() : (stamp?.toMillis?.() ?? 0);
    const hoursLate = Math.round((now - scheduledMs) / 3_600_000);

    await doc.ref.update({ status: 'paused', updatedAt: FieldValue.serverTimestamp() });
    paused.push({ campaignId: doc.id, hoursLate });
    logger.error(
      `[marketing] campaign ${doc.id} was ${hoursLate}h past its scheduled time; paused for review rather than sent`,
    );
  }

  return paused;
}

/**
 * Recompute a campaign's stats from its `sends` records — the authoritative
 * source — and write them back onto the campaign document.
 *
 * `recipientCount`, `openCount`, `clickCount` and `unsubscribeCount` are
 * write-once/increment-only fields, set at enqueue time and nudged up by the
 * tracking routes as events arrive. That is fast day-to-day, but it means any
 * gap in the write path — a failed update after the sends themselves were
 * already created, a status transition that skips enqueueCampaign entirely —
 * leaves the campaign showing "—" forever with no self-correction, even
 * though the underlying sends prove real mail went out. This is the repair:
 * count what actually happened and overwrite the drifted aggregate with it.
 *
 * Uses count() aggregate queries rather than fetching every send document, so
 * this stays cheap to run on a campaign with a large audience — one read per
 * count, not one per recipient.
 */
export async function recomputeCampaignCounts(campaignId: string): Promise<{
  recipientCount: number;
  openCount: number;
  clickCount: number;
  unsubscribeCount: number;
}> {
  const sendsRef = getAdminDb().collection(CAMPAIGNS).doc(campaignId).collection('sends');

  const [total, opened, clicked, unsubscribed] = await Promise.all([
    sendsRef.count().get(),
    sendsRef.where('opened', '==', true).count().get(),
    sendsRef.where('clicked', '==', true).count().get(),
    sendsRef.where('unsubscribed', '==', true).count().get(),
  ]);

  const counts = {
    recipientCount: total.data().count,
    openCount: opened.data().count,
    clickCount: clicked.data().count,
    unsubscribeCount: unsubscribed.data().count,
  };

  await getAdminDb().collection(CAMPAIGNS).doc(campaignId).update({
    ...counts,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return counts;
}

/**
 * Repair campaigns that were sent but report no recipients.
 *
 * Opens and clicks cannot exist without recipients, so a sent or sending
 * campaign at zero has drifted from its `sends` records. Recomputes those that
 * have any, and returns the corrected counts by id so a caller can show them
 * straight away. Capped, so opening a long list cannot fan out into hundreds of
 * count queries.
 */
export async function healCampaignCounts(
  campaigns: Array<{ id: string; status: string; recipientCount?: number }>,
  max = 10,
): Promise<Map<string, Awaited<ReturnType<typeof recomputeCampaignCounts>>>> {
  const healed = new Map<string, Awaited<ReturnType<typeof recomputeCampaignCounts>>>();
  const drifted = campaigns
    .filter((c) => (c.status === 'sent' || c.status === 'sending') && !c.recipientCount)
    .slice(0, max);

  await Promise.all(
    drifted.map(async (c) => {
      try {
        const counts = await recomputeCampaignCounts(c.id);
        if (counts.recipientCount > 0) healed.set(c.id, counts);
      } catch (err) {
        logger.error(
          `[marketing] could not heal counts for ${c.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return healed;
}

/** Campaigns the drain should work on: actively sending, or scheduled and now due. */
export async function findDueCampaigns(): Promise<string[]> {
  const db = getAdminDb();
  const now = new Date();

  const [sending, scheduled] = await Promise.all([
    db.collection(CAMPAIGNS).where('status', '==', 'sending').get(),
    db
      .collection(CAMPAIGNS)
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', now)
      .get(),
  ]);

  return [...sending.docs, ...scheduled.docs].map((d) => d.id);
}

/**
 * Decide an A/B test if it is due, and return the live config.
 *
 * Called at the top of every drain: the decision has to happen between batches
 * rather than on a schedule of its own, because the held remainder can only be
 * released once a winner exists.
 */
export async function resolveAbWinner(
  campaignId: string,
  campaign: Campaign,
): Promise<AbTestConfig | undefined> {
  const abTest = campaign.abTest as AbTestConfig | undefined;
  if (!abTest || abTest.variants.length < 2) return undefined;
  if (abTest.winnerIndex !== undefined) return abTest;

  const startedMs =
    (campaign.sendState?.startedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
  if (!startedMs || !isReadyToDecide(startedMs, abTest.decideAfterHours)) return abTest;

  const campaignRef = getAdminDb().collection(CAMPAIGNS).doc(campaignId);

  // Tally per variant from the sends themselves — the campaign's own openCount
  // aggregates every variant together and cannot answer this.
  const results: VariantResult[] = [];
  for (const [index, variant] of abTest.variants.entries()) {
    const [sent, opened] = await Promise.all([
      campaignRef.collection('sends').where('variant', '==', index).where('status', '==', 'sent').count().get(),
      campaignRef.collection('sends').where('variant', '==', index).where('opened', '==', true).count().get(),
    ]);

    const sentCount = sent.data().count;
    results.push({
      index,
      subject: variant.subject,
      sent: sentCount,
      opened: opened.data().count,
      openRate: sentCount ? opened.data().count / sentCount : 0,
    });
  }

  const { winnerIndex, confident, reason } = pickWinner(results);

  await campaignRef.update({
    'abTest.winnerIndex': winnerIndex,
    'abTest.decidedAt': FieldValue.serverTimestamp(),
    'abTest.decisionReason': reason,
    'abTest.confident': confident,
    'abTest.results': results,
  });

  logger.log(`[marketing] A/B decided for ${campaignId}: ${reason}`);
  return { ...abTest, winnerIndex };
}
