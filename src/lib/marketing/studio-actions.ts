'use server';

// src/lib/marketing/studio-actions.ts
//
// Server actions for the campaign studio: compose a plan, draft its emails,
// revise a block, and turn the result into a live journey.
//
// Kept apart from actions.ts because these are the only actions that call an
// LLM, and they are correspondingly slow and rate-limited more tightly.

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { assertAdmin } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { composeJourney, type ComposeJourneyOutput } from '@/ai/flows/marketing/compose-journey';
import { draftEmail, type DraftEmailResult } from '@/ai/flows/marketing/draft-email';
import { reviseBlock } from '@/ai/flows/marketing/revise-block';
import { subjectVariants, type SubjectVariantsOutput } from '@/ai/flows/marketing/subject-variants';
import { blocksToText, type EmailBlock } from './blocks';
import { resolveSegment, type SegmentDefinition } from './segments';
import { enrolSubscriber } from './engine';
import { getKnowledgeSnapshot } from './knowledge';
import {
  JOURNEYS,
  validateJourney,
  type Journey,
  type JourneyStep,
} from './journeys';
import { CAMPAIGNS } from './queue';
import { renderBlocks, renderBlocksAsText } from './render';
import { validateDraft, validateLinks, validateBlockShapes, type ValidationIssue } from './validate';
import { defaultCtaUrl } from './app-routes';
import { stage } from './stage';
import { stripUndefined } from '@/lib/firestore-values';

export type StudioResult<T> = { success: true; data: T } | { success: false; error: string };

function fail(err: unknown, fallback: string): { success: false; error: string } {
  const message = err instanceof Error ? err.message : fallback;
  logger.error(`[marketing/studio] ${message}`);
  return { success: false, error: message };
}

const STUDIO_PATH = '/admin/marketing/studio';

/** Step 1 — a prompt becomes a reviewable plan. No content is generated yet. */
export async function composePlan(prompt: string): Promise<StudioResult<ComposeJourneyOutput>> {
  try {
    // Tighter limit than the CRUD actions: each call is a slow, costly model
    // request.
    await stage('compose', 'admin check', 20_000, () => assertAdmin('marketing:studio:compose'));

    if (!prompt.trim()) return { success: false, error: 'Describe what you want to send.' };

    const plan = await composeJourney({ prompt });
    return { success: true, data: plan };
  } catch (err) {
    return fail(err, 'Could not compose a plan.');
  }
}

/** Step 2 — draft the copy for one step of the plan. */
export async function draftPlanEmail(input: {
  brief: string;
  journeyGoal?: string;
  audienceDescription?: string;
  siblingSubjects?: string[];
  position?: string;
}): Promise<StudioResult<DraftEmailResult>> {
  try {
    await assertAdmin('marketing:studio:draft');
    const result = await draftEmail(input);
    return { success: true, data: result };
  } catch (err) {
    return fail(err, 'Could not draft the email.');
  }
}

export async function reviseEmailBlock(input: {
  block: EmailBlock;
  instruction: string;
  emailContext?: string;
}): Promise<StudioResult<EmailBlock>> {
  try {
    await assertAdmin('marketing:studio:revise');
    const revised = await reviseBlock(input);
    return { success: true, data: revised as EmailBlock };
  } catch (err) {
    return fail(err, 'Could not revise the block.');
  }
}

export async function suggestSubjects(input: {
  currentSubject: string;
  emailSummary: string;
  audienceDescription?: string;
}): Promise<StudioResult<SubjectVariantsOutput>> {
  try {
    await assertAdmin('marketing:studio:subjects');
    const result = await subjectVariants(input);
    return { success: true, data: result };
  } catch (err) {
    return fail(err, 'Could not suggest subject lines.');
  }
}

/**
 * Re-check edited content.
 *
 * The studio calls this after any manual edit, because a marketer typing a
 * price by hand is just as capable of getting it wrong as the model is.
 */
export async function revalidateContent(input: {
  subject: string;
  blocks: EmailBlock[];
  /** The email's brief, so a price the marketer supplied is not flagged as invented. */
  brief?: string;
}): Promise<StudioResult<{ valid: boolean; issues: ValidationIssue[] }>> {
  try {
    await assertAdmin('marketing:studio:validate');
    const snapshot = await getKnowledgeSnapshot();
    const { ok, issues } = validateDraft(
      { subject: input.subject, body: blocksToText(input.blocks) },
      snapshot,
      { briefText: input.brief },
    );
    // Not previously called here. A drafted email got its links checked in
    // draftEmail, a revised block got them checked in reviseBlock, but a
    // block hand-edited in the campaign editor called only this — so a
    // mistyped app path from a human editor sailed through with no warning
    // at all, the same failure this was built to catch, through a door that
    // was left unlocked.
    const linkIssues = validateLinks(input.blocks, defaultCtaUrl());
    // Hand-editing is now possible (direct field editing in the campaign
    // editor and the Studio card, not only AI drafting/revision), so a block
    // can be emptied into an invalid shape the same way a bad link could
    // already be typed by hand — checked here for the same reason.
    const shapeIssues = validateBlockShapes(input.blocks);
    return {
      success: true,
      data: {
        valid: ok && linkIssues.length === 0 && shapeIssues.length === 0,
        issues: [...issues, ...linkIssues, ...shapeIssues],
      },
    };
  } catch (err) {
    return fail(err, 'Could not validate the content.');
  }
}

export interface SaveJourneyInput {
  name: string;
  goal: string;
  trigger: Journey['trigger'];
  /** Full segment definition — tags AND athlete predicates. Earlier versions
   *  carried only the tag filters, silently discarding predicates like
   *  "subscription is trial" that the planner had chosen. */
  audience: SegmentDefinition;
  exitOnConversion: 'subscriptionActive' | 'workoutLogged' | 'programStarted' | 'none';
  steps: Array<
    | { kind: 'wait'; hours: number }
    | {
        kind: 'email';
        subject: string;
        previewText: string;
        blocks: EmailBlock[];
        brief?: string;
      }
  >;
}

/**
 * Step 3 — persist the plan.
 *
 * Every email step becomes a campaign document holding its rendered content, so
 * a journey email is the same kind of object as a broadcast and reports the
 * same way. The journey itself is always saved as a draft: activation is a
 * separate, deliberate action that runs its own validation.
 */
export async function saveJourney(
  input: SaveJourneyInput,
): Promise<StudioResult<{ journeyId: string }>> {
  try {
    await assertAdmin('marketing:studio:save');

    const db = getAdminDb();
    const journeyRef = db.collection(JOURNEYS).doc();
    const steps: JourneyStep[] = [];

    for (const [index, step] of input.steps.entries()) {
      if (step.kind === 'wait') {
        steps.push({ id: `step-${index}`, type: 'wait', hours: step.hours });
        continue;
      }

      const campaignRef = db.collection(CAMPAIGNS).doc();
      await campaignRef.set(stripUndefined({
        subject: step.subject,
        previewText: step.previewText,
        blocks: step.blocks,
        htmlBody: renderBlocks(step.blocks, { previewText: step.previewText }),
        plainBody: renderBlocksAsText(step.blocks),
        status: 'draft',
        journeyId: journeyRef.id,
        journeyStepId: `step-${index}`,
        scheduledAt: null,
        sentAt: null,
        recipientCount: 0,
        openCount: 0,
        clickCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }));

      steps.push({
        id: `step-${index}`,
        type: 'sendEmail',
        campaignId: campaignRef.id,
        brief: step.brief,
      });
    }

    // `brief` is optional on an email step, and the audience and trigger both
    // carry optional fields the planner may not have set. Any one of them left
    // undefined would fail the whole write rather than simply be absent.
    await journeyRef.set(stripUndefined({
      name: input.name,
      goal: input.goal,
      trigger: input.trigger,
      entryRules: { onceOnly: true, segment: input.audience },
      exitRules:
        input.exitOnConversion === 'none'
          ? {}
          : { exitOnConversion: { type: input.exitOnConversion } },
      steps,
      // Always a draft. A journey mails people unattended, so going live is a
      // decision someone makes after reviewing it, never a side effect of
      // saving.
      status: 'draft',
      stats: { entered: 0, completed: 0, exitedEarly: 0 },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }));

    revalidatePath(STUDIO_PATH);
    revalidatePath('/admin/marketing/journeys');
    return { success: true, data: { journeyId: journeyRef.id } };
  } catch (err) {
    return fail(err, 'Could not save the journey.');
  }
}

/**
 * Activate a journey.
 *
 * Requires a clean structural validation and, for anything that fires
 * automatically, an explicit acknowledgement that a test send was reviewed.
 * A live journey emails real athletes with nobody watching.
 */
export async function activateJourney(
  journeyId: string,
  confirmations: { testSendReviewed: boolean },
): Promise<StudioResult<{ activated: true }>> {
  try {
    await assertAdmin('marketing:studio:activate');

    const ref = getAdminDb().collection(JOURNEYS).doc(journeyId);
    const snap = await ref.get();
    if (!snap.exists) return { success: false, error: 'Journey not found.' };

    const journey = { id: snap.id, ...snap.data() } as Journey;
    const problems = validateJourney(journey);
    if (problems.length) return { success: false, error: problems.join(' ') };

    if (journey.trigger.type !== 'manual' && !confirmations.testSendReviewed) {
      return {
        success: false,
        error: 'Send yourself a test and confirm you have reviewed it before going live.',
      };
    }

    await ref.update({
      status: 'live',
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.log(`[marketing/studio] journey ${journeyId} activated`);
    revalidatePath('/admin/marketing/journeys');
    return { success: true, data: { activated: true } };
  } catch (err) {
    return fail(err, 'Could not activate the journey.');
  }
}

/**
 * Start everyone in a manual journey's audience.
 *
 * The engine only enrols from events and derived triggers, so a `manual`
 * journey — the model a one-off broadcast uses — had no way to begin at all.
 * This resolves its entry segment and enrols the audience in one go.
 *
 * `onceOnly` still applies, so running twice does not re-enrol anyone who has
 * already been through. Enrolment writes runs; the journey cron does the
 * sending, so a large audience does not block this request.
 */
export async function runManualJourney(
  journeyId: string,
): Promise<StudioResult<{ enrolled: number; skipped: number; audienceSize: number }>> {
  try {
    await assertAdmin('marketing:studio:run');

    const snap = await getAdminDb().collection(JOURNEYS).doc(journeyId).get();
    if (!snap.exists) return { success: false, error: 'Journey not found.' };

    const journey = { id: snap.id, ...snap.data() } as Journey;

    if (journey.status !== 'live') {
      return { success: false, error: 'Activate the journey before running it.' };
    }
    if (journey.trigger.type !== 'manual' && journey.trigger.type !== 'scheduled') {
      return {
        success: false,
        error: 'This journey enrols people automatically from its trigger; it cannot be run by hand.',
      };
    }

    const audience = await resolveSegment(journey.entryRules?.segment ?? {});

    let enrolled = 0;
    let skipped = 0;

    for (const subscriber of audience.subscribers) {
      const result = await enrolSubscriber(journey, subscriber.id, subscriber.userId);
      if (result === 'enrolled') enrolled++;
      else skipped++;
    }

    logger.log(`[marketing/studio] manual run of ${journeyId}: ${enrolled} enrolled, ${skipped} skipped`);
    revalidatePath(`/admin/marketing/journeys/${journeyId}`);

    return {
      success: true,
      data: { enrolled, skipped, audienceSize: audience.subscribers.length },
    };
  } catch (err) {
    return fail(err, 'Could not run the journey.');
  }
}

export async function setJourneyStatus(
  journeyId: string,
  status: 'live' | 'paused' | 'archived',
): Promise<StudioResult<{ status: string }>> {
  try {
    await assertAdmin('marketing:studio:status');
    await getAdminDb().collection(JOURNEYS).doc(journeyId).update({
      status,
      updatedAt: FieldValue.serverTimestamp(),
    });
    revalidatePath('/admin/marketing/journeys');
    return { success: true, data: { status } };
  } catch (err) {
    return fail(err, 'Could not change the journey status.');
  }
}

/** Pause every live journey at once. The automation kill switch. */
export async function pauseAllJourneys(): Promise<StudioResult<{ paused: number }>> {
  try {
    await assertAdmin('marketing:studio:pause-all');

    const db = getAdminDb();
    const live = await db.collection(JOURNEYS).where('status', '==', 'live').get();

    const writer = db.bulkWriter();
    live.docs.forEach((d) =>
      writer.update(d.ref, { status: 'paused', updatedAt: FieldValue.serverTimestamp() }),
    );
    await writer.close();

    logger.log(`[marketing/studio] paused ${live.size} live journeys`);
    revalidatePath('/admin/marketing/journeys');
    return { success: true, data: { paused: live.size } };
  } catch (err) {
    return fail(err, 'Could not pause the journeys.');
  }
}
