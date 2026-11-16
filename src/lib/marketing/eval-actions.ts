'use server';

// src/lib/marketing/eval-actions.ts
//
// Server actions for the drafting eval at /admin/marketing/eval.
//
// One case per call, driven from the page a few at a time, so no single
// request carries twenty model calls and the page can show progress. Runs are
// saved so a prompt change can be compared with the run before it.

import { FieldValue } from 'firebase-admin/firestore';
import { assertAdmin } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { draftEmail } from '@/ai/flows/marketing/draft-email';
import { judgeEmail } from '@/ai/flows/marketing/judge-email';
import { blocksToMarkup } from './email-markup';
import { getKnowledgeSnapshot } from './knowledge';
import { defaultCtaUrl } from './app-routes';
import { EVAL_CASES } from './eval/cases';
import { scoreDraft, summariseRun, type EvalCaseResult, type EvalRunSummary } from './eval/score';
import { stripUndefined } from '@/lib/firestore-values';

const EVAL_RUNS = 'marketingEvalRuns';

export async function runEvalCase(
  caseId: string,
  options: { judge: boolean },
): Promise<EvalCaseResult> {
  // A run is twenty-odd calls a minute; the shared studio bucket's limit of
  // 30 would cut a run short, so the eval has its own.
  await assertAdmin('marketing:eval');

  const c = EVAL_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error(`Unknown eval case "${caseId}".`);

  const started = Date.now();
  try {
    const [draft, snapshot] = await Promise.all([draftEmail(c.input), getKnowledgeSnapshot()]);
    const markup = blocksToMarkup(draft.blocks);
    const scored = scoreDraft(c, draft, snapshot, defaultCtaUrl());

    let judge: EvalCaseResult['judge'];
    if (options.judge) {
      try {
        judge = await judgeEmail({
          brief: [c.input.brief, c.input.audienceDescription && `Audience: ${c.input.audienceDescription}`]
            .filter(Boolean)
            .join('\n'),
          email: `subject: ${draft.subject}\npreview: ${draft.previewText}\n\n${markup}`,
        });
      } catch (err) {
        // A judge failure costs this case its scores, not its draft.
        logger.error(`[marketing/eval] judge failed on ${caseId}:`, err instanceof Error ? err.message : String(err));
      }
    }

    return {
      caseId,
      archetype: c.archetype,
      ms: Date.now() - started,
      attempts: draft.attempts,
      angle: draft.angle,
      subject: draft.subject,
      previewText: draft.previewText,
      markup,
      scored,
      judge,
    };
  } catch (err) {
    return {
      caseId,
      archetype: c.archetype,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface SavedEvalRun {
  id: string;
  label: string;
  createdAt: string | null;
  summary: EvalRunSummary;
  results: EvalCaseResult[];
}

export async function saveEvalRun(input: {
  label: string;
  results: EvalCaseResult[];
}): Promise<{ id: string; summary: EvalRunSummary }> {
  const admin = await assertAdmin('marketing:eval:save');
  const summary = summariseRun(input.results);
  const ref = getAdminDb().collection(EVAL_RUNS).doc();
  await ref.set(
    stripUndefined({
      label: input.label.trim() || 'Untitled run',
      summary,
      results: input.results,
      createdBy: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
    }),
  );
  return { id: ref.id, summary };
}

export async function listEvalRuns(limit = 10): Promise<SavedEvalRun[]> {
  await assertAdmin('marketing:eval:list');
  const snap = await getAdminDb().collection(EVAL_RUNS).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      label: data.label,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
      summary: data.summary,
      results: data.results ?? [],
    };
  });
}
