// src/lib/marketing/engine.ts
//
// The journey engine: enrolment and step execution.
//
// Runs from a cron on the same pattern as the send drain. Each invocation
// enrols whoever the pending events and derived triggers call for, then
// advances every run whose next step is due. Email steps enqueue into the
// Phase 2 send queue rather than sending directly, so there is exactly one code
// path that puts a message in front of a recipient.

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { TRIAL_DAYS } from '@/lib/trial';
import type { User } from '@/models/types';
import { claimUnprocessedEvents, markEventsProcessed, type MarketingEvent } from './events';
import { checkFrequencyCap } from './frequency';
import {
  computeNextRunAt,
  isDerivedTrigger,
  JOURNEYS,
  JOURNEY_RUNS,
  journeyRunId,
  MAX_RUN_FAILURES,
  type Journey,
  type JourneyRun,
  type JourneyStep,
} from './journeys';
import { CAMPAIGNS, getSettings, sendDocId } from './queue';
import { SEGMENTS, type SavedSegment } from './segment-store';
import { matchesAthlete, resolveSegment, subscriberMatchesSegment } from './segments';
import { SUBSCRIBERS } from './subscribers';
import type { Send, Subscriber } from './types';

/** Journeys that are live and therefore eligible to enrol anyone. */
export async function getLiveJourneys(): Promise<Journey[]> {
  const snap = await getAdminDb().collection(JOURNEYS).where('status', '==', 'live').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Journey);
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

/**
 * Start a subscriber on a journey.
 *
 * The run id is `${journeyId}_${subscriberId}`, so `onceOnly` is enforced by
 * document existence rather than a query — a burst of duplicate events cannot
 * race two enrolments past a read-then-write check.
 */
export async function enrolSubscriber(
  journey: Journey,
  subscriberId: string,
  userId?: string,
): Promise<'enrolled' | 'already-in' | 'cooldown' | 'not-eligible'> {
  const db = getAdminDb();
  const runRef = db.collection(JOURNEY_RUNS).doc(journeyRunId(journey.id, subscriberId));

  const subSnap = await db.collection(SUBSCRIBERS).doc(subscriberId).get();
  if (!subSnap.exists) return 'not-eligible';

  const sub = { id: subSnap.id, ...subSnap.data() } as Subscriber;
  // Enrolling someone who cannot be emailed would fill the runs collection with
  // journeys that can only ever no-op.
  if (sub.status !== 'active' || sub.consent?.marketing !== true) return 'not-eligible';

  // The journey's own entry audience, checked here rather than at each call
  // site so that nothing can enrol past it by accident.
  //
  // It used to be checked at exactly one call site — runManualJourney — which
  // meant an event-triggered journey ignored it entirely. The studio plans an
  // audience, shows it to whoever is composing, and saves it to this field, so
  // a welcome sequence narrowed to one funnel looked correct in the console and
  // then enrolled everybody who granted consent, from any funnel. The audience
  // a person was shown has to be the audience that receives the mail.
  //
  // runManualJourney resolves the same segment before calling here, so that
  // path now evaluates it twice. Accepted: for the tag-only segments a funnel
  // uses this is an in-memory comparison, and the alternative — a "already
  // filtered" flag — is a bypass that only has to be forgotten once.
  if (!(await subscriberMatchesSegment(sub, journey.entryRules?.segment))) {
    return 'not-eligible';
  }

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(runRef);

    if (existing.exists) {
      const run = existing.data() as JourneyRun;

      if (journey.entryRules.onceOnly) return 'already-in';
      if (run.status === 'active') return 'already-in';

      const cooldownDays = journey.entryRules.reentryCooldownDays;
      if (cooldownDays) {
        const enteredMs = (run.enteredAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
        if (enteredMs && Date.now() - enteredMs < cooldownDays * 86_400_000) return 'cooldown';
      }
    }

    tx.set(runRef, {
      journeyId: journey.id,
      subscriberId,
      ...(userId ? { userId } : {}),
      currentStep: 0,
      status: 'active',
      nextRunAt: FieldValue.serverTimestamp(), // first step runs on the next pass
      enteredAt: FieldValue.serverTimestamp(),
      history: [],
    });
    tx.update(db.collection(JOURNEYS).doc(journey.id), {
      'stats.entered': FieldValue.increment(1),
    });

    return 'enrolled';
  });
}

/** Match pending events to live journeys and enrol accordingly. */
export async function processEvents(): Promise<{ processed: number; enrolled: number }> {
  const [events, journeys] = await Promise.all([claimUnprocessedEvents(), getLiveJourneys()]);
  if (!events.length) return { processed: 0, enrolled: 0 };

  let enrolled = 0;

  for (const event of events) {
    if (!event.subscriberId) continue;

    for (const journey of journeys) {
      if (journey.trigger.type !== event.type) continue;
      if (!triggerMatchesEvent(journey, event)) continue;

      const result = await enrolSubscriber(journey, event.subscriberId, event.userId);
      if (result === 'enrolled') enrolled++;
    }
  }

  await markEventsProcessed(events.map((e) => e.id));
  logger.log(`[marketing/engine] processed ${events.length} events, enrolled ${enrolled}`);
  return { processed: events.length, enrolled };
}

/** Trigger parameters beyond the event type itself — a specific tag, a milestone number. */
export function triggerMatchesEvent(journey: Journey, event: MarketingEvent): boolean {
  const { trigger } = journey;

  // Route narrowing applies to every event trigger, so it is checked before the
  // type-specific parameters. A journey asking for one route must not enrol
  // someone who arrived by another, even when the event type matches.
  if (trigger.route && event.payload?.route !== trigger.route) return false;

  if (trigger.type === 'tagAdded' && trigger.tag) {
    return event.payload?.tag === trigger.tag;
  }
  if (trigger.type === 'workoutMilestone' && trigger.milestone) {
    return event.payload?.count === trigger.milestone;
  }
  if (trigger.type === 'apiEvent' && trigger.eventName) {
    return event.payload?.name === trigger.eventName;
  }
  return true;
}

/**
 * Evaluate derived triggers — states that become true with time rather than
 * events that fire. Nothing emits "the trial is ending", so a nightly sweep
 * looks for it.
 */
export async function evaluateDerivedTriggers(): Promise<{ enrolled: number }> {
  const journeys = (await getLiveJourneys()).filter((j) => isDerivedTrigger(j.trigger.type));
  if (!journeys.length) return { enrolled: 0 };

  let enrolled = 0;

  for (const journey of journeys) {
    // Segment membership is a different question from the time-based states
    // below: it is answered by diffing who matches now against who matched
    // before, not by asking whether one athlete's record satisfies a condition.
    if (journey.trigger.type === 'segmentEntered') {
      enrolled += await evaluateSegmentEntry(journey);
      continue;
    }

    const days = journey.trigger.days ?? 3;
    const candidates = await findDerivedCandidates(journey, days);

    for (const { subscriberId, userId } of candidates) {
      const result = await enrolSubscriber(journey, subscriberId, userId);
      if (result === 'enrolled') enrolled++;
    }

    logger.log(`[marketing/engine] ${journey.trigger.type}: ${candidates.length} candidates`);
  }

  return { enrolled };
}

/**
 * Enrol subscribers who have *started* matching a saved segment.
 *
 * Membership is mirrored onto each subscriber as `matchedSegments`, so entry is
 * a diff rather than a state: someone who has matched "churn risk" for three
 * weeks should not be re-enrolled every night. Leaving the segment clears the
 * mirror, which is what lets a genuine re-entry fire again later.
 *
 * The first evaluation of a segment seeds membership without enrolling anyone.
 * Everyone matching at the moment a journey goes live has not just entered —
 * they were already there — and treating them as new arrivals would mail the
 * entire segment at once, which is precisely what nobody intends when they
 * activate an automation.
 */
async function evaluateSegmentEntry(journey: Journey): Promise<number> {
  const segmentId = journey.trigger.segmentId;
  if (!segmentId) {
    logger.error(`[marketing/engine] journey ${journey.id} watches no segment; skipping`);
    return 0;
  }

  const db = getAdminDb();

  const segmentSnap = await db.collection(SEGMENTS).doc(segmentId).get();
  if (!segmentSnap.exists) {
    logger.error(`[marketing/engine] segment ${segmentId} no longer exists`);
    return 0;
  }

  const segment = segmentSnap.data() as SavedSegment;
  const audience = await resolveSegment(segment.definition ?? {});
  const matchingNow = new Set(audience.subscribers.map((s) => s.id));

  // Keyed by journey, not by segment. Two live journeys may watch the same
  // saved segment; with one shared marker the first to run would claim every
  // entrant and the second would see an empty `entering` set for ever — live,
  // and enrolling nobody, which is the failure this trigger was fixed to end.
  const marker = `${journey.id}:${segmentId}`;

  const previousSnap = await db
    .collection(SUBSCRIBERS)
    .where('matchedSegments', 'array-contains', marker)
    .get();
  const matchedBefore = new Set(previousSnap.docs.map((d) => d.id));

  const entering = [...matchingNow].filter((id) => !matchedBefore.has(id));
  const leaving = [...matchedBefore].filter((id) => !matchingNow.has(id));

  // Mirror first. If enrolment then fails part-way, the next pass sees those
  // people as already-members and does not re-enrol them — under-sending on a
  // transient failure, rather than mailing someone twice.
  const writer = db.bulkWriter();
  for (const id of entering) {
    writer.update(db.collection(SUBSCRIBERS).doc(id), {
      matchedSegments: FieldValue.arrayUnion(marker),
    });
  }
  for (const id of leaving) {
    writer.update(db.collection(SUBSCRIBERS).doc(id), {
      matchedSegments: FieldValue.arrayRemove(marker),
    });
  }
  await writer.close();

  // Per journey too: a second journey attached to an already-seeded segment
  // must get its own quiet first pass rather than immediately enrolling every
  // existing member.
  const seededFor = (segment as { enteredSeededFor?: string[] }).enteredSeededFor ?? [];
  const seeded = seededFor.includes(journey.id);

  if (!seeded) {
    await segmentSnap.ref.update({
      enteredSeededFor: FieldValue.arrayUnion(journey.id),
    });
    logger.log(
      `[marketing/engine] segmentEntered: seeded ${matchingNow.size} existing members of ` +
        `${segmentId} without enrolling`,
    );
    return 0;
  }

  // userId matters: without it `shouldExit` returns null for every athlete
  // condition and `evaluateBranch` returns false for every branch, so a journey
  // with exitOnConversion would chase someone who has already converted and
  // every branch would take its false path. Every other derived trigger passes
  // it; this one was the exception.
  const userIdBySubscriber = new Map(
    audience.subscribers.map((sub) => [sub.id, sub.userId] as const),
  );

  let enrolled = 0;
  for (const subscriberId of entering) {
    const result = await enrolSubscriber(journey, subscriberId, userIdBySubscriber.get(subscriberId));
    if (result === 'enrolled') enrolled++;
  }

  logger.log(
    `[marketing/engine] segmentEntered ${segmentId}: ${entering.length} entered, ` +
      `${leaving.length} left, ${enrolled} enrolled`,
  );
  return enrolled;
}

async function findDerivedCandidates(
  journey: Journey,
  days: number,
): Promise<Array<{ subscriberId: string; userId?: string }>> {
  const db = getAdminDb();

  // Only athletes have the fields these triggers read, so start from the
  // subscribers that are linked to an account.
  const subsSnap = await db
    .collection(SUBSCRIBERS)
    .where('status', '==', 'active')
    .where('consent.marketing', '==', true)
    .limit(5000)
    .get();

  const linked = subsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Subscriber)
    .filter((s) => s.userId);

  if (!linked.length) return [];

  const matches: Array<{ subscriberId: string; userId?: string }> = [];
  const BATCH = 300;

  for (let i = 0; i < linked.length; i += BATCH) {
    const slice = linked.slice(i, i + BATCH);
    const docs = await db.getAll(...slice.map((s) => db.collection('users').doc(s.userId!)));

    slice.forEach((sub, idx) => {
      const doc = docs[idx];
      if (!doc?.exists) return;
      if (matchesDerivedTrigger(doc.data() as User, journey.trigger.type, days)) {
        matches.push({ subscriberId: sub.id, userId: sub.userId });
      }
    });
  }

  return matches;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as { toDate(): Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

const daysSince = (d: Date | null): number | null =>
  d ? (Date.now() - d.getTime()) / 86_400_000 : null;

/**
 * Whether an athlete currently satisfies a derived trigger.
 *
 * Pure and exported so the conditions are testable without a database — these
 * decide who gets emailed unattended, which makes them the part most worth
 * pinning down.
 */
export function matchesDerivedTrigger(
  user: User,
  trigger: Journey['trigger']['type'],
  days: number,
): boolean {
  switch (trigger) {
    case 'trialEndingSoon': {
      if (user.subscriptionStatus !== 'trial') return false;
      const elapsed = daysSince(toDate(user.trialStartDate));
      if (elapsed === null) return false;
      const remaining = TRIAL_DAYS - elapsed;
      // A window, not a threshold: a nightly sweep with `remaining <= days`
      // would re-match every night until the trial expired.
      return remaining <= days && remaining > days - 1;
    }

    case 'onboardingStalled': {
      if ((user.onboardingCompletedStep ?? 0) >= 6) return false;
      const since = daysSince(toDate(user.trialStartDate));
      return since !== null && since >= days && since < days + 1;
    }

    case 'noWorkoutAfterNDays': {
      if ((user.completedWorkouts ?? 0) > 0) return false;
      const since = daysSince(toDate(user.trialStartDate));
      return since !== null && since >= days && since < days + 1;
    }

    case 'churnRisk': {
      // Someone who was training and has stopped — distinct from a dormant
      // signup, who never started.
      if ((user.completedWorkouts ?? 0) < 3) return false;
      const since = daysSince(toDate(user.lastSeenAt));
      return since !== null && since >= days && since < days + 1;
    }

    case 'raceDateApproaching': {
      // user.raceDate is stamped by /api/ai/generate-race-plan. Note this is
      // NOT user.startDate — that is the date the athlete started their
      // current programme, which is in the past by definition.
      const race = toDate(user.raceDate);
      if (!race) return false;
      const until = (race.getTime() - Date.now()) / 86_400_000;
      return until <= days && until > days - 1;
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

export interface AdvanceResult {
  advanced: number;
  completed: number;
  exited: number;
  held: number;
  /** Runs that threw this pass and were retried or set aside. */
  failed: number;
}

/** Advance every run whose next step is due. */
export async function advanceRuns(limit = 200): Promise<AdvanceResult> {
  const db = getAdminDb();
  const settings = await getSettings();
  const result: AdvanceResult = { advanced: 0, completed: 0, exited: 0, held: 0, failed: 0 };

  if (settings.sendingPaused) {
    logger.log('[marketing/engine] sending paused; not advancing runs');
    return result;
  }

  const due = await db
    .collection(JOURNEY_RUNS)
    .where('status', '==', 'active')
    .where('nextRunAt', '<=', new Date())
    .limit(limit)
    .get();

  if (due.empty) return result;

  const journeyCache = new Map<string, Journey>();

  for (const doc of due.docs) {
    // One run failing must not abandon the rest of the page.
    //
    // Every branch below can throw — an addTag against a subscriber who has
    // since been deleted raises NOT_FOUND, a contended transaction can abort,
    // a malformed step can trip an assertion. Without this catch a single such
    // run propagates out of the loop, out of advanceRuns, and up to the cron
    // handler, which abandons every remaining due run. Because the query
    // re-selects the same run next pass, the failure repeats forever: one bad
    // record silently stops the whole automation engine.
    //
    // The same reasoning already applies per athlete in marketing/activity.ts.
    try {
      const run = { id: doc.id, ...doc.data() } as JourneyRun;

      let journey = journeyCache.get(run.journeyId);
      if (!journey) {
        const jSnap = await db.collection(JOURNEYS).doc(run.journeyId).get();
        if (!jSnap.exists) {
          await doc.ref.update({ status: 'failed', exitReason: 'Journey no longer exists' });
          continue;
        }
        journey = { id: jSnap.id, ...jSnap.data() } as Journey;
        journeyCache.set(run.journeyId, journey);
      }

      // A paused journey stops advancing without losing where each run had got to.
      if (journey.status !== 'live') {
        result.held++;
        continue;
      }

      const exit = await shouldExit(journey, run);
      if (exit) {
        await doc.ref.update({
          status: 'exited',
          exitReason: exit,
          completedAt: FieldValue.serverTimestamp(),
        });
        await db.collection(JOURNEYS).doc(journey.id).update({
          'stats.exitedEarly': FieldValue.increment(1),
        }).catch(() => undefined);
        result.exited++;
        continue;
      }

      const step = journey.steps[run.currentStep];
      if (!step) {
        await doc.ref.update({ status: 'completed', completedAt: FieldValue.serverTimestamp() });
        await db.collection(JOURNEYS).doc(journey.id).update({
          'stats.completed': FieldValue.increment(1),
        }).catch(() => undefined);
        result.completed++;
        continue;
      }

      const outcome = await executeStep(journey, run, step, settings.frequencyCapPerWeek);

      if (outcome.kind === 'hold') {
        // Try again on the next pass rather than skipping the step.
        await doc.ref.update({ nextRunAt: new Date(Date.now() + outcome.retryInMs) });
        result.held++;
        continue;
      }

      if (outcome.kind === 'exit') {
        await doc.ref.update({
          status: 'exited',
          exitReason: outcome.reason,
          completedAt: FieldValue.serverTimestamp(),
        });
        await db.collection(JOURNEYS).doc(journey.id).update({
          'stats.exitedEarly': FieldValue.increment(1),
        }).catch(() => undefined);
        result.exited++;
        continue;
      }

      await doc.ref.update({
        currentStep: outcome.toStep ?? run.currentStep + 1,
        nextRunAt: outcome.nextRunAt,
        history: FieldValue.arrayUnion(step.id),
        // Cleared on success, so the counter measures a step that is stuck now
        // rather than every failure this run has ever had. Without this a run
        // that failed four times months ago would be set aside by its next
        // single transient error.
        failureCount: 0,
      });
      result.advanced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const run = { id: doc.id, ...doc.data() } as JourneyRun;
      const failures = (run.failureCount ?? 0) + 1;
      result.failed++;

      if (failures >= MAX_RUN_FAILURES) {
        // Set aside rather than retried forever. The run stops occupying a slot
        // in every pass, and `failed` is surfaced in the console so this is a
        // thing someone can see rather than a sequence that quietly stopped.
        await doc.ref
          .update({
            status: 'failed',
            failureCount: failures,
            lastError: message,
            completedAt: FieldValue.serverTimestamp(),
          })
          .catch(() => undefined);
        logger.error(
          `[marketing/engine] run ${doc.id} failed ${failures}x, setting aside: ${message}`,
        );
        continue;
      }

      // Back off and try again. Linear rather than exponential: the ceiling is
      // MAX_RUN_FAILURES passes, so this is bounded already, and a journey step
      // delayed by hours is worse than one retried promptly.
      await doc.ref
        .update({
          failureCount: failures,
          lastError: message,
          nextRunAt: new Date(Date.now() + failures * 5 * 60_000),
        })
        .catch(() => undefined);
      logger.error(`[marketing/engine] run ${doc.id} threw (${failures}x): ${message}`);
    }
  }

  return result;
}

type StepOutcome =
  | {
      kind: 'advance';
      nextRunAt: Date;
      /** Explicit next step index. Absent means the following step. A branch
       *  whose condition fails uses this to jump past its thenSteps. */
      toStep?: number;
    }
  | { kind: 'hold'; retryInMs: number }
  | { kind: 'exit'; reason: string };

async function executeStep(
  journey: Journey,
  run: JourneyRun,
  step: JourneyStep,
  frequencyCap: number,
): Promise<StepOutcome> {
  const db = getAdminDb();
  const now = new Date();

  switch (step.type) {
    case 'wait':
      return { kind: 'advance', nextRunAt: computeNextRunAt(step, now) };

    case 'exit':
      return { kind: 'exit', reason: step.reason ?? 'Journey step' };

    case 'addTag':
    case 'removeTag': {
      await db.collection(SUBSCRIBERS).doc(run.subscriberId).update({
        tags: step.type === 'addTag'
          ? FieldValue.arrayUnion(step.tag)
          : FieldValue.arrayRemove(step.tag),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'advance', nextRunAt: now };
    }

    case 'branch': {
      const matched = await evaluateBranch(run, step);
      // A simple if/else, not a graph: `thenSteps` are the contiguous steps
      // immediately after the branch (validateJourney enforces this). Matched
      // runs fall into them; unmatched runs jump to the step after the last
      // one, so the branch body is genuinely skipped.
      if (!matched && step.thenSteps.length) {
        const lastThen = journey.steps.findIndex(
          (s) => s.id === step.thenSteps[step.thenSteps.length - 1],
        );
        if (lastThen >= 0) {
          return { kind: 'advance', nextRunAt: now, toStep: lastThen + 1 };
        }
        // A branch pointing at missing steps should never go live
        // (validateJourney blocks it), but if one does, falling through to the
        // next step is the least-wrong behaviour.
      }
      return { kind: 'advance', nextRunAt: now };
    }

    case 'sendEmail': {
      if (!step.campaignId) return { kind: 'advance', nextRunAt: now };

      // The cap is applied here, not at broadcast time: a journey fires
      // unattended, which is where it earns its keep.
      const decision = await checkFrequencyCap(run.subscriberId, frequencyCap);
      if (!decision.allowed) {
        // Hold for six hours rather than dropping the email — the person is
        // still meant to receive it, just not today.
        return { kind: 'hold', retryInMs: 6 * 3_600_000 };
      }

      const sub = await db.collection(SUBSCRIBERS).doc(run.subscriberId).get();
      const data = sub.data() as Subscriber | undefined;
      if (!data || data.status !== 'active' || data.consent?.marketing !== true) {
        return { kind: 'exit', reason: 'Recipient is no longer mailable' };
      }

      // Queue one send row, reusing the same idempotent structure as broadcasts.
      const campaignRef = db.collection(CAMPAIGNS).doc(step.campaignId);
      const sendRef = campaignRef.collection('sends').doc(sendDocId(step.campaignId, run.subscriberId));

      const row: Omit<Send, 'id'> = {
        campaignId: step.campaignId,
        subscriberId: run.subscriberId,
        email: data.email,
        status: 'pending',
        attempts: 0,
        queuedAt: FieldValue.serverTimestamp(),
        sentAt: null,
        opened: false,
        openedAt: null,
        openRaw: 0,
        clicked: false,
        clickedAt: null,
      };

      // create() rather than set(): if this run already queued this email, the
      // write fails rather than resetting a sent row back to pending.
      const created = await sendRef.create(row).then(
        () => true,
        () => false,
      );

      // recipientCount was never set on this path — only enqueueCampaign set it,
      // so a journey email reported zero recipients (and every open and click as
      // a rate over zero) even though mail went out. Counted only when this call
      // created the row, so a retry of the same run cannot double-count.
      await campaignRef
        .update({
          status: 'sending',
          ...(created
            ? {
                'sendState.total': FieldValue.increment(1),
                recipientCount: FieldValue.increment(1),
              }
            : {}),
        })
        .catch(() => undefined);

      return { kind: 'advance', nextRunAt: now };
    }
  }
}

/** Branch conditions reuse the segment predicates, so there is one filtering vocabulary. */
async function evaluateBranch(
  run: JourneyRun,
  step: Extract<JourneyStep, { type: 'branch' }>,
): Promise<boolean> {
  if (!run.userId) return false;

  const snap = await getAdminDb().collection('users').doc(run.userId).get();
  if (!snap.exists) return false;

  return matchesAthlete(snap.data() as User, step.condition as never);
}

/**
 * Whether a run should stop early.
 *
 * exitOnConversion is what stops a winback series chasing someone who has
 * already come back — the difference between an automation that feels
 * attentive and one that feels broken.
 */
async function shouldExit(journey: Journey, run: JourneyRun): Promise<string | null> {
  const { maxDurationDays, exitOnConversion } = journey.exitRules ?? {};

  if (maxDurationDays) {
    const enteredMs = (run.enteredAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    if (enteredMs && Date.now() - enteredMs > maxDurationDays * 86_400_000) {
      return `Exceeded ${maxDurationDays} days in journey`;
    }
  }

  if (!exitOnConversion) return null;

  const db = getAdminDb();

  if (exitOnConversion.type === 'tagAdded' && exitOnConversion.tag) {
    const snap = await db.collection(SUBSCRIBERS).doc(run.subscriberId).get();
    const tags = (snap.data() as Subscriber | undefined)?.tags ?? [];
    return tags.includes(exitOnConversion.tag) ? `Tagged ${exitOnConversion.tag}` : null;
  }

  if (!run.userId) return null;
  const userSnap = await db.collection('users').doc(run.userId).get();
  if (!userSnap.exists) return 'Athlete record no longer exists';
  const user = userSnap.data() as User;

  switch (exitOnConversion.type) {
    case 'subscriptionActive':
      return user.subscriptionStatus === 'active' ? 'Subscription became active' : null;
    case 'workoutLogged':
      return (user.completedWorkouts ?? 0) > 0 ? 'Logged a workout' : null;
    case 'programStarted':
      return user.programId ? 'Started a programme' : null;
    default:
      return null;
  }
}
