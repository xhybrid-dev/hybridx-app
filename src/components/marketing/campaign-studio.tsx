'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { ComposeJourneyOutput } from '@/ai/flows/marketing/compose-journey';
import { composePlan, draftPlanEmail, saveJourney } from '@/lib/marketing/studio-actions';
import { TRIGGER_DESCRIPTIONS, type TriggerType } from '@/lib/marketing/journeys';
import type { SegmentDefinition } from '@/lib/marketing/segments';
import type { EmailBlock } from '@/lib/marketing/blocks';
import type { ValidationIssue } from '@/lib/marketing/validate';
import { EmailDraftCard, type DraftedEmail } from './email-draft-card';

interface KnowledgeSummary {
  trialDays: number;
  priceLabel: string;
  programCount: number;
  mailable: number;
  hasHistory: boolean;
}

const EXAMPLES = [
  'Win back athletes who cancelled in the last 60 days — 3 emails over 2 weeks, lead with the race planner',
  'Welcome series for new signups: 3 emails in the first week that get them to their first workout',
  'One-off announcement to everyone about the new Garmin workout sync',
  'Nudge trialists whose trial ends in 3 days and who have never logged a workout',
];

type Stage = 'prompt' | 'plan' | 'drafting' | 'review';

/** Server actions cannot be aborted, but the UI must not wait forever on one
 *  that the platform dropped (timeout, instance restart) without a response. */
const ACTION_TIMEOUT_MS = 150_000;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} took too long and was abandoned. Try again.`)),
      ACTION_TIMEOUT_MS,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function CampaignStudio({
  knowledge,
  frequencyCapNote,
}: {
  knowledge: KnowledgeSummary;
  frequencyCapNote: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [stage, setStage] = useState<Stage>('prompt');
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<ComposeJourneyOutput | null>(null);
  const [drafts, setDrafts] = useState<DraftedEmail[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const handleCompose = async () => {
    setBusy(true);
    let result: Awaited<ReturnType<typeof composePlan>>;
    try {
      result = await withTimeout(composePlan(prompt), 'Planning');
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : 'Planning failed.' };
    }
    setBusy(false);

    if (!result.success) {
      toast({ title: 'Could not plan that', description: result.error, variant: 'destructive' });
      return;
    }
    setPlan(result.data);
    setStage('plan');
  };

  /** Draft every email step in order, so each one can avoid repeating the last. */
  const handleDraftAll = async () => {
    if (!plan) return;

    setStage('drafting');
    setBusy(true);

    const emailSteps = plan.steps.filter((s) => s.kind === 'email');
    const produced: DraftedEmail[] = [];

    for (const [index, step] of emailSteps.entries()) {
      setProgress(`Drafting email ${index + 1} of ${emailSteps.length}…`);

      // A rejected action (network drop, platform timeout) used to throw out of
      // this loop and leave the stage on 'drafting' with a spinner forever.
      let result: Awaited<ReturnType<typeof draftPlanEmail>>;
      try {
        result = await withTimeout(
          draftPlanEmail({
            brief: step.brief ?? plan.goal,
            journeyGoal: plan.goal,
            audienceDescription: plan.audienceDescription,
            siblingSubjects: produced.map((d) => d.subject),
            position: `email ${index + 1} of ${emailSteps.length}`,
          }),
          'Drafting',
        );
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : 'Drafting failed.',
        };
      }

      if (!result.success) {
        toast({ title: 'Drafting failed', description: result.error, variant: 'destructive' });
        setBusy(false);
        setStage('plan');
        return;
      }

      produced.push({
        workingTitle: step.workingTitle ?? `Email ${index + 1}`,
        brief: step.brief ?? '',
        subject: result.data.subject,
        previewText: result.data.previewText,
        blocks: result.data.blocks as EmailBlock[],
        html: result.data.html,
        issues: result.data.issues,
        valid: result.data.valid,
      });
      setDrafts([...produced]);
    }

    setBusy(false);
    setProgress('');
    setStage('review');
  };

  const handleSave = async () => {
    if (!plan) return;
    setBusy(true);

    // Interleave the waits from the plan with the drafted emails, preserving
    // the order the planner chose.
    let emailIndex = 0;
    const steps: Parameters<typeof saveJourney>[0]['steps'] = plan.steps.map((step) => {
      if (step.kind === 'wait') return { kind: 'wait' as const, hours: step.hours ?? 24 };
      const draft = drafts[emailIndex++];
      return {
        kind: 'email' as const,
        subject: draft.subject,
        previewText: draft.previewText,
        blocks: draft.blocks,
        brief: draft.brief,
      };
    });

    // Carry the whole audience across — tag filters AND athlete predicates.
    // The planner's subscriptionStatus values arrive as plain strings, so
    // constrain them to the statuses that actually exist before saving.
    const VALID_STATUSES = ['trial', 'active', 'canceled', 'expired', 'incomplete', 'paused'];
    const subscriptionStatus = plan.audience.subscriptionStatus?.filter((v) =>
      VALID_STATUSES.includes(v),
    ) as NonNullable<SegmentDefinition['athlete']>['subscriptionStatus'];

    const hasAthletePredicates =
      (subscriptionStatus?.length ?? 0) > 0 ||
      plan.audience.maxCompletedWorkouts !== undefined ||
      plan.audience.inactiveForDays !== undefined;

    const audience: SegmentDefinition = {
      anyTags: plan.audience.anyTags,
      noneTags: plan.audience.noneTags,
      ...(hasAthletePredicates
        ? {
            athlete: {
              ...(subscriptionStatus?.length ? { subscriptionStatus } : {}),
              ...(plan.audience.maxCompletedWorkouts !== undefined
                ? { maxCompletedWorkouts: plan.audience.maxCompletedWorkouts }
                : {}),
              ...(plan.audience.inactiveForDays !== undefined
                ? { inactiveForDays: plan.audience.inactiveForDays }
                : {}),
            },
          }
        : {}),
    };

    const result = await saveJourney({
      name: plan.name,
      goal: plan.goal,
      trigger: {
        type: plan.trigger.type as TriggerType,
        days: plan.trigger.days,
        tag: plan.trigger.tag,
        // Dropping this was how a journey planned for one funnel came to enrol
        // from all of them: the planner chose a route, the studio displayed the
        // narrowed audience, and the field never reached Firestore.
        route: plan.trigger.route,
      },
      audience,
      exitOnConversion: plan.exitOnConversion,
      steps,
    });

    setBusy(false);

    if (!result.success) {
      toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
      return;
    }

    toast({
      title: 'Saved as a draft',
      description: 'Review it and send yourself a test before going live.',
    });
    router.push(`/admin/marketing/journeys/${result.data.journeyId}`);
  };

  const blockingIssues = drafts.flatMap((d) => d.issues.filter((i) => i.severity === 'error'));
  // A dropped block and an unverifiable price are both blocking, but they ask
  // the reader to do different things, so they are counted and worded apart.
  const factIssues = blockingIssues.filter((i) => i.kind !== 'structure');
  const structureIssues = blockingIssues.filter((i) => i.kind === 'structure');

  return (
    <div className="space-y-6">
      {stage === 'prompt' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                What do you want to send?
              </CardTitle>
              <CardDescription>
                Describe the goal, the audience and roughly how many emails. The studio decides the
                trigger, timing and structure.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Win back athletes who cancelled in the last 60 days — 3 emails over 2 weeks…"
              />

              {/* Full-width rows on a phone: these are whole sentences, and
                  as pills they wrapped into unreadable slivers. */}
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setPrompt(example)}
                    className="rounded-lg border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted sm:rounded-full sm:py-1.5"
                  >
                    {example}
                  </button>
                ))}
              </div>

              <Button className="w-full sm:w-auto" onClick={handleCompose} disabled={busy || !prompt.trim()}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                Plan the campaign
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What the studio knows</CardTitle>
              <CardDescription>
                Drafts are written against these live values, not from memory.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{knowledge.programCount} programmes</Badge>
              <Badge variant="outline">{knowledge.trialDays}-day trial</Badge>
              <Badge variant="outline">{knowledge.priceLabel}</Badge>
              <Badge variant="outline">{knowledge.mailable.toLocaleString()} mailable</Badge>
              <Badge variant="outline">
                {knowledge.hasHistory ? 'Learning from past campaigns' : 'No campaign history yet'}
              </Badge>
            </CardContent>
          </Card>
        </>
      )}

      {plan && stage !== 'prompt' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription className="mt-1">{plan.goal}</CardDescription>
              </div>
              <Badge variant="secondary">{plan.trigger.type}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {TRIGGER_DESCRIPTIONS[plan.trigger.type as TriggerType] ?? plan.trigger.type}
              </p>
              <p className="mt-1 text-muted-foreground">{plan.audienceDescription}</p>
              {plan.exitOnConversion !== 'none' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Stops early when: <strong>{plan.exitOnConversion}</strong>
                </p>
              )}
            </div>

            <ol className="space-y-2">
              {plan.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border p-3">
                  {step.kind === 'wait' ? (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0">
                    {step.kind === 'wait' ? (
                      <p className="text-sm text-muted-foreground">
                        Wait {step.hours ?? 24} hours
                        {(step.hours ?? 24) >= 24 && ` (${Math.round((step.hours ?? 24) / 24)} days)`}
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-medium">{step.workingTitle ?? 'Email'}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{step.brief}</p>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <p className="text-xs text-muted-foreground">{plan.reasoning}</p>

            {stage === 'plan' && (
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <Button onClick={handleDraftAll} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  Draft the emails
                </Button>
                <Button variant="outline" onClick={() => setStage('prompt')} disabled={busy}>
                  Start over
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {stage === 'drafting' && (
        <Card>
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{progress}</p>
          </CardContent>
        </Card>
      )}

      {stage === 'review' && drafts.length > 0 && (
        <div className="space-y-4">
          {blockingIssues.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {factIssues.length > 0 ? 'Fact check failed' : 'Draft incomplete'}
              </AlertTitle>
              <AlertDescription>
                {factIssues.length > 0 && (
                  <>
                    {factIssues.length} claim{factIssues.length === 1 ? '' : 's'} could not be
                    verified against live HYBRIDX data. Fix these before sending — they would go
                    out under your brand.
                  </>
                )}
                {factIssues.length > 0 && structureIssues.length > 0 && ' '}
                {structureIssues.length > 0 && (
                  <>
                    {structureIssues.length} block
                    {structureIssues.length === 1 ? ' was' : 's were'} dropped as unusable, so the
                    email is shorter than intended. Redraft, or add the missing content by hand.
                  </>
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Fact check passed</AlertTitle>
              <AlertDescription>
                Prices, trial length and programme names match live data. Read the copy yourself
                before sending — this checks facts, not judgement.
              </AlertDescription>
            </Alert>
          )}

          {drafts.map((draft, i) => (
            <EmailDraftCard
              key={i}
              draft={draft}
              index={i}
              audienceDescription={plan?.audienceDescription}
              onChange={(updated) =>
                setDrafts((current) => current.map((d, j) => (j === i ? updated : d)))
              }
            />
          ))}

          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
            <Button onClick={handleSave} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save as draft journey
            </Button>
            <Button variant="outline" onClick={() => setStage('plan')} disabled={busy}>
              Back to the plan
            </Button>
            <p className="text-xs text-muted-foreground">{frequencyCapNote}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ValidationIssue };
