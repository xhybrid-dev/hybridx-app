import { EVAL_CASES } from '@/lib/marketing/eval/cases';
import { listEvalRuns } from '@/lib/marketing/eval-actions';
import { DraftEval } from '@/components/marketing/draft-eval';

export const dynamic = 'force-dynamic';

export default async function DraftEvalPage() {
  // A missing index or empty collection must not take the page down with it:
  // the page is still useful for running the first evaluation.
  const runs = await listEvalRuns(10).catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-2xl font-bold sm:text-3xl">Drafting eval</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Drafts {EVAL_CASES.length} fixed briefs with the live studio drafter and scores every email:
          mechanical checks (clean, one button to the right place, length, stays on the brief) and,
          optionally, a model editor scoring craft from 1 to 5. Run it before and after any prompt or
          model change and compare the two runs.
        </p>
      </div>
      <DraftEval
        cases={EVAL_CASES.map((c) => ({ id: c.id, archetype: c.archetype, brief: c.input.brief }))}
        initialRuns={runs}
      />
    </div>
  );
}
