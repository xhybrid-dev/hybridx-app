// src/app/api/cron/marketing-brief/route.ts
//
// The weekly marketing brain.
//
// Compiles the week, asks for proposals, drafts each one into a real journey,
// and emails the lot to the admin. Everything it produces is a draft: the
// machine proposes, a person disposes. There is deliberately no path from this
// route to a send.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { mailer, getFromAddress, isEmailConfigured } from '@/lib/email-service';
import { compileWeeklyBrief, saveBrief } from '@/lib/marketing/brief';
import { renderBriefEmail } from '@/lib/marketing/brief-email';
import { proposeCampaigns, type CampaignProposal } from '@/ai/flows/marketing/propose-campaigns';
import { composeJourney } from '@/ai/flows/marketing/compose-journey';
import { draftEmail } from '@/ai/flows/marketing/draft-email';
import { JOURNEYS } from '@/lib/marketing/journeys';
import { CAMPAIGNS } from '@/lib/marketing/queue';
import { renderBlocks, renderBlocksAsText } from '@/lib/marketing/render';
import { stripUndefined } from '@/lib/firestore-values';
import type { EmailBlock } from '@/lib/marketing/blocks';
import { blocksToMarkup } from '@/lib/marketing/email-markup';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Leave room to send the email even if drafting runs long. */
const DRAFTING_BUDGET_MS = 200_000;

type ProposalResult = CampaignProposal & { journeyId?: string; error?: string };

/**
 * Turn one proposal into a saved draft journey.
 *
 * Reuses the studio's own flows, so a proposal is exactly the artefact a person
 * would have produced by typing the same prompt — reviewable, editable, and
 * subject to the same activation gate.
 */
async function draftProposal(proposal: CampaignProposal): Promise<ProposalResult> {
  try {
    const plan = await composeJourney({ prompt: proposal.prompt });
    const db = getAdminDb();
    const journeyRef = db.collection(JOURNEYS).doc();

    const emailSteps = plan.steps.filter((s) => s.kind === 'email');
    const steps: Array<Record<string, unknown>> = [];
    const written: string[] = [];
    // The full text of each email already drafted, so the next one builds on
    // it instead of repeating its argument.
    const writtenEmails: { subject: string; body: string }[] = [];
    let emailIndex = 0;

    for (const [index, step] of plan.steps.entries()) {
      const stepId = `step-${index}`;

      if (step.kind === 'wait') {
        steps.push({ id: stepId, type: 'wait', hours: step.hours ?? 24 });
        continue;
      }

      // The planner may return a step with no brief of its own — `brief` is
      // optional in its schema, and a single-email broadcast in particular is
      // often planned with the goal carrying the whole instruction. Resolve it
      // once, so the brief stored on the step is the one the copy was actually
      // written from and regenerating the email reproduces it.
      const brief = step.brief?.trim() || plan.goal;

      const draft = await draftEmail({
        brief,
        journeyGoal: plan.goal,
        audienceDescription: plan.audienceDescription,
        siblingSubjects: written,
        siblingEmails: writtenEmails,
        position: `email ${emailIndex + 1} of ${emailSteps.length}`,
      });
      written.push(draft.subject);
      writtenEmails.push({ subject: draft.subject, body: blocksToMarkup(draft.blocks) });
      emailIndex++;

      const campaignRef = db.collection(CAMPAIGNS).doc();
      const blocks = draft.blocks as EmailBlock[];

      await campaignRef.set(stripUndefined({
        subject: draft.subject,
        previewText: draft.previewText,
        blocks,
        htmlBody: renderBlocks(blocks, { previewText: draft.previewText }),
        plainBody: renderBlocksAsText(blocks),
        status: 'draft',
        journeyId: journeyRef.id,
        journeyStepId: stepId,
        scheduledAt: null,
        sentAt: null,
        recipientCount: 0,
        openCount: 0,
        clickCount: 0,
        // Carried through so the review screen can show what the fact-checker
        // found, rather than presenting an unverified draft as finished.
        validationIssues: draft.issues,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }));

      steps.push({ id: stepId, type: 'sendEmail', campaignId: campaignRef.id, brief });
    }

    await journeyRef.set(stripUndefined({
      name: plan.name,
      goal: plan.goal,
      trigger: plan.trigger,
      entryRules: { onceOnly: true, segment: { anyTags: plan.audience.anyTags ?? [] } },
      exitRules:
        plan.exitOnConversion === 'none'
          ? {}
          : { exitOnConversion: { type: plan.exitOnConversion } },
      steps,
      // Always a draft, always tagged. The tag is what lets a human tell an
      // AI-proposed journey from one they wrote.
      status: 'draft',
      aiProposed: true,
      proposalRationale: proposal.rationale,
      stats: { entered: 0, completed: 0, exitedEarly: 0 },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }));

    return { ...proposal, journeyId: journeyRef.id };
  } catch (err) {
    // A proposal that fails to draft still reaches the admin as a prompt they
    // can paste into the studio — more useful than dropping it silently.
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[cron/marketing-brief] could not draft "${proposal.title}": ${message}`);
    return { ...proposal, error: message };
  }
}

export async function GET(request: Request) {
  const denied = requireCronAuth(request, 'marketing-brief');
  if (denied) return denied;

  const startedAt = Date.now();

  try {
    const brief = await compileWeeklyBrief();
    const { summary, proposals } = await proposeCampaigns(brief);

    const drafted: ProposalResult[] = [];
    for (const proposal of proposals) {
      if (Date.now() - startedAt > DRAFTING_BUDGET_MS) {
        // Out of time: pass the remaining proposals through undrafted rather
        // than losing them, and still send the brief.
        drafted.push({ ...proposal, error: 'Ran out of time to draft this one.' });
        continue;
      }
      drafted.push(await draftProposal(proposal));
    }

    await saveBrief(brief);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.hybridx.club';
    const recipient = process.env.MARKETING_BRIEF_RECIPIENT || process.env.EMAIL_FROM;

    if (!recipient || !isEmailConfigured()) {
      logger.error('[cron/marketing-brief] no recipient or transport; brief saved but not sent');
      return NextResponse.json({
        brief: { periodEnd: brief.periodEnd },
        proposals: drafted.length,
        emailed: false,
      });
    }

    const email = renderBriefEmail({ brief, summary, proposals: drafted, appUrl });

    // Transactional transport: internal correspondence must not be subject to
    // the marketing frequency cap, and must not appear in campaign statistics.
    await mailer.sendMail({
      from: getFromAddress('HYBRIDX Marketing'),
      to: recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    logger.log(`[cron/marketing-brief] sent to ${recipient} with ${drafted.length} proposals`);

    return NextResponse.json({
      emailed: true,
      proposals: drafted.map((p) => ({ title: p.title, journeyId: p.journeyId, error: p.error })),
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error('[cron/marketing-brief] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Brief failed' },
      { status: 500 },
    );
  }
}
