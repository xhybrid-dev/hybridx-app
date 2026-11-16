'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCopy, Loader2, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { runEvalCase, saveEvalRun, type SavedEvalRun } from '@/lib/marketing/eval-actions';
import {
  styleOfResult,
  summariseRun,
  summariseStyle,
  type EvalCaseResult,
  type EvalRunSummary,
  type StyleSummary,
} from '@/lib/marketing/eval/score';
import { STYLE_RULES } from '@/lib/marketing/style-lint';

interface CaseInfo {
  id: string;
  archetype: string;
  brief: string;
}

/** Cases drafted at once. Each is one to three model calls plus the judge. */
const CONCURRENCY = 3;

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Delta({ now, before, invert = false, format = (n: number) => n.toFixed(2) }: {
  now: number;
  before?: number;
  invert?: boolean;
  format?: (n: number) => string;
}) {
  if (before === undefined) return null;
  const diff = now - before;
  if (Math.abs(diff) < 1e-9) return <span className="ml-1 text-xs text-muted-foreground">±0</span>;
  const better = invert ? diff < 0 : diff > 0;
  return (
    <span className={`ml-1 text-xs ${better ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
      {diff > 0 ? '+' : '−'}
      {format(Math.abs(diff))}
    </span>
  );
}

function SummaryTiles({
  summary,
  previous,
  style,
  previousStyle,
}: {
  summary: EvalRunSummary;
  previous?: EvalRunSummary;
  style: StyleSummary | null;
  previousStyle: StyleSummary | null;
}) {
  const styleRate = style ? style.passed / style.total : 0;
  const tiles: Array<{ label: string; value: string; delta: React.ReactNode }> = [
    {
      label: 'Clean (no repair needed)',
      value: pct(summary.cleanRate),
      delta: <Delta now={summary.cleanRate} before={previous?.cleanRate} format={pct} />,
    },
    {
      label: 'Passed every check',
      value: pct(summary.perfectRate),
      delta: <Delta now={summary.perfectRate} before={previous?.perfectRate} format={pct} />,
    },
    {
      label: 'Style rules passed',
      value: style ? pct(styleRate) : '—',
      delta:
        style && previousStyle ? (
          <Delta now={styleRate} before={previousStyle.passed / previousStyle.total} format={pct} />
        ) : null,
    },
    {
      label: 'Editor score (1–5)',
      value: summary.judge ? summary.judge.overall.toFixed(2) : '—',
      delta: summary.judge && previous?.judge ? <Delta now={summary.judge.overall} before={previous.judge.overall} /> : null,
    },
    {
      label: 'Model calls per email',
      value: summary.avgAttempts.toFixed(2),
      delta: <Delta now={summary.avgAttempts} before={previous?.avgAttempts} invert />,
    },
    {
      label: 'Seconds per email',
      value: summary.avgSeconds.toFixed(1),
      delta: <Delta now={summary.avgSeconds} before={previous?.avgSeconds} invert format={(n) => n.toFixed(1)} />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <p className="col-span-full text-xs text-muted-foreground">
        Mechanical checks: {summary.checksPassed}/{summary.checksTotal} passed
      </p>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {t.value}
            {t.delta}
          </p>
        </div>
      ))}
      {summary.judge && (
        <p className="col-span-full text-xs text-muted-foreground">
          Editor by criterion — one action {summary.judge.oneAction} · reader first {summary.judge.readerFirst} ·
          specificity {summary.judge.specificity} · voice {summary.judge.voice} · brief fidelity{' '}
          {summary.judge.briefFidelity}
          {summary.failedToDraft > 0 && ` · ${summary.failedToDraft} case(s) failed to draft`}
        </p>
      )}
      {style && style.failures.length > 0 && (
        <p className="col-span-full text-xs text-muted-foreground">
          Most-missed style rules —{' '}
          {style.failures.map((f) => `${f.label} (${f.emails} email${f.emails === 1 ? '' : 's'})`).join(' · ')}
        </p>
      )}
    </div>
  );
}

function ResultsTable({ cases, results }: { cases: CaseInfo[]; results: Record<string, EvalCaseResult> }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">Case</th>
            <th className="p-2 font-medium">Checks</th>
            <th className="p-2 font-medium">Style</th>
            <th className="p-2 font-medium">Editor</th>
            <th className="hidden p-2 font-medium sm:table-cell">Calls</th>
            <th className="hidden p-2 font-medium sm:table-cell">Seconds</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const r = results[c.id];
            const isOpen = open === c.id;
            const style = r ? styleOfResult(r) : null;
            const judgeOverall = r?.judge
              ? (r.judge.oneAction + r.judge.readerFirst + r.judge.specificity + r.judge.voice + r.judge.briefFidelity) / 5
              : null;
            return (
              <Fragment key={c.id}>
                <tr
                  className={`border-t ${r ? 'cursor-pointer hover:bg-muted/40' : 'text-muted-foreground'}`}
                  onClick={() => r && setOpen(isOpen ? null : c.id)}
                >
                  <td className="p-2">
                    <span className="flex items-center gap-1">
                      {r ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="w-3.5" />}
                      <span className="font-mono text-xs">{c.id}</span>
                    </span>
                    <span className="ml-5 text-xs text-muted-foreground">{c.archetype}</span>
                  </td>
                  <td className="p-2">
                    {!r ? (
                      '—'
                    ) : r.error ? (
                      <Badge variant="destructive">failed</Badge>
                    ) : (
                      <Badge
                        variant={r.scored!.passed === r.scored!.total ? 'secondary' : 'outline'}
                        className={r.scored!.passed === r.scored!.total ? 'bg-green-500/15 text-green-600 dark:text-green-400' : ''}
                      >
                        {r.scored!.passed}/{r.scored!.total}
                      </Badge>
                    )}
                  </td>
                  <td className="p-2 tabular-nums">{style ? `${style.passed}/${style.total}` : '—'}</td>
                  <td className="p-2 tabular-nums">{judgeOverall === null ? '—' : judgeOverall.toFixed(1)}</td>
                  <td className="hidden p-2 tabular-nums sm:table-cell">{r?.attempts ?? '—'}</td>
                  <td className="hidden p-2 tabular-nums sm:table-cell">{r ? (r.ms / 1000).toFixed(1) : '—'}</td>
                </tr>
                {isOpen && r && (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={6} className="space-y-3 p-3">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Brief:</span> {c.brief}
                      </p>
                      {r.error ? (
                        <p className="text-sm text-destructive">{r.error}</p>
                      ) : (
                        <>
                          {r.angle && (
                            <p className="text-xs">
                              <span className="font-medium">Angle:</span> {r.angle}
                            </p>
                          )}
                          <ul className="space-y-1 text-xs">
                            {r.scored!.checks.map((check) => (
                              <li key={check.id} className={check.pass ? 'text-muted-foreground' : 'text-destructive'}>
                                {check.pass ? '✓' : '✗'} {check.label}
                                {check.detail && ` — ${check.detail}`}
                              </li>
                            ))}
                          </ul>
                          {style && style.failed.length > 0 && (
                            <p className="text-xs text-orange-600 dark:text-orange-400">
                              Style: {style.failed.map((rule) => STYLE_RULES[rule]).join(' · ')}
                            </p>
                          )}
                          {r.judge && (
                            <p className="text-xs">
                              <span className="font-medium">Editor:</span> action {r.judge.oneAction} · reader{' '}
                              {r.judge.readerFirst} · specific {r.judge.specificity} · voice {r.judge.voice} · brief{' '}
                              {r.judge.briefFidelity} — {r.judge.weakness}
                            </p>
                          )}
                          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs">
                            {`subject: ${r.subject}\npreview: ${r.previewText}\n\n${r.markup}`}
                          </pre>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DraftEval({ cases, initialRuns }: { cases: CaseInfo[]; initialRuns: SavedEvalRun[] }) {
  const { toast } = useToast();
  const [runs, setRuns] = useState(initialRuns);
  const [label, setLabel] = useState('');
  const [judge, setJudge] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, EvalCaseResult>>({});
  const [viewing, setViewing] = useState<SavedEvalRun | null>(initialRuns[0] ?? null);

  const done = Object.keys(results).length;
  const live = useMemo(() => (done ? summariseRun(Object.values(results)) : null), [results, done]);

  const handleRun = async () => {
    setRunning(true);
    setResults({});
    setViewing(null);

    const collected: Record<string, EvalCaseResult> = {};
    const queue = [...cases];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const id = next.id;
        let result: EvalCaseResult;
        try {
          result = await runEvalCase(id, { judge });
        } catch (err) {
          result = {
            caseId: id,
            archetype: next.archetype as EvalCaseResult['archetype'],
            ms: 0,
            error: err instanceof Error ? err.message : 'The request failed.',
          };
        }
        collected[id] = result;
        setResults((prev) => ({ ...prev, [id]: result }));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const ordered = cases.map((c) => collected[c.id]).filter(Boolean);
    try {
      const saved = await saveEvalRun({ label: label || `Run ${new Date().toLocaleString()}`, results: ordered });
      const run: SavedEvalRun = {
        id: saved.id,
        label: label || 'Untitled run',
        createdAt: new Date().toISOString(),
        summary: saved.summary,
        results: ordered,
      };
      setRuns((prev) => [run, ...prev].slice(0, 10));
      setViewing(run);
      toast({ title: 'Run saved', description: `${saved.summary.checksPassed}/${saved.summary.checksTotal} checks passed.` });
    } catch (err) {
      toast({
        title: 'Run finished but was not saved',
        description: err instanceof Error ? err.message : 'Saving failed.',
        variant: 'destructive',
      });
    }
    setLabel('');
    setRunning(false);
  };

  // The run to compare against: the one saved before whatever is on screen.
  const shown = running || !viewing ? null : viewing;
  const previous = shown ? runs[runs.findIndex((r) => r.id === shown.id) + 1] : runs[0];
  const summary = shown ? shown.summary : live;
  const tableResults = shown
    ? Object.fromEntries(shown.results.map((r) => [r.caseId, r]))
    : results;
  const style = summariseStyle(Object.values(tableResults));
  const previousStyle = previous ? summariseStyle(previous.results) : null;

  const handleCopy = async () => {
    if (!summary) return;
    const report = buildReport({
      label: shown?.label ?? 'In-progress run',
      summary,
      style,
      previous: previous ? { label: previous.label, summary: previous.summary, style: previousStyle } : undefined,
      cases,
      results: tableResults,
    });
    try {
      await navigator.clipboard.writeText(report);
      toast({ title: 'Report copied', description: 'Paste it into the chat with Claude.' });
    } catch {
      // Clipboard access can be refused; a download always works.
      const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'drafting-eval.md';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Run the eval</CardTitle>
          <CardDescription>
            About {cases.length} model drafts plus {judge ? cases.length : 0} editor scores, {CONCURRENCY} at a time.
            Typically two to four minutes. Name the run after what changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="eval-label">Run name</Label>
              <Input
                id="eval-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Baseline after the format change"
                disabled={running}
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox id="eval-judge" checked={judge} onCheckedChange={(v) => setJudge(v === true)} disabled={running} />
              <Label htmlFor="eval-judge" className="font-normal">
                Score craft with the model editor
              </Label>
            </div>
            <Button onClick={handleRun} disabled={running}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {running ? `Running ${done}/${cases.length}` : `Run ${cases.length} cases`}
            </Button>
          </div>
          {running && <Progress value={(done / cases.length) * 100} />}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {shown ? shown.label : 'This run (in progress)'}
            </CardTitle>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardDescription>
                {shown?.createdAt && new Date(shown.createdAt).toLocaleString()}
                {previous && ` · compared with "${previous.label}"`}
              </CardDescription>
              {!running && (
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <ClipboardCopy className="mr-2 h-3.5 w-3.5" />
                  Copy report
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <SummaryTiles summary={summary} previous={previous?.summary} style={style} previousStyle={previousStyle} />
            <ResultsTable cases={cases} results={tableResults} />
          </CardContent>
        </Card>
      )}

      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Previous runs</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => setViewing(run)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-muted/40 ${viewing?.id === run.id ? 'font-medium' : ''}`}
                  >
                    <span className="min-w-0 truncate">{run.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      clean {pct(run.summary.cleanRate)} · checks {run.summary.checksPassed}/{run.summary.checksTotal}
                      {run.summary.judge && ` · editor ${run.summary.judge.overall.toFixed(2)}`}
                      {run.createdAt && ` · ${new Date(run.createdAt).toLocaleDateString()}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * The run as Markdown, for pasting into a conversation about what to change.
 *
 * Every case's scores and weakness go in, but the full email only for the
 * cases that need attention — the lowest editor scores and anything that
 * failed a check — so the report stays short enough to paste.
 */
function buildReport(input: {
  label: string;
  summary: EvalRunSummary;
  style: StyleSummary | null;
  previous?: { label: string; summary: EvalRunSummary; style: StyleSummary | null };
  cases: CaseInfo[];
  results: Record<string, EvalCaseResult>;
}): string {
  const { summary: s, style } = input;
  const overall = (r: EvalCaseResult) =>
    r.judge ? (r.judge.oneAction + r.judge.readerFirst + r.judge.specificity + r.judge.voice + r.judge.briefFidelity) / 5 : null;
  const stylePct = (st: StyleSummary | null) => (st ? pct(st.passed / st.total) : '—');

  const lines: string[] = [
    `# Drafting eval: ${input.label}`,
    '',
    `- Clean ${pct(s.cleanRate)} · every check ${pct(s.perfectRate)} · checks ${s.checksPassed}/${s.checksTotal}`,
    `- Style rules ${stylePct(style)}${style?.failures.length ? ` (most missed: ${style.failures.map((f) => `${f.label} ×${f.emails}`).join(', ')})` : ''}`,
    s.judge
      ? `- Editor ${s.judge.overall} (action ${s.judge.oneAction}, reader ${s.judge.readerFirst}, specific ${s.judge.specificity}, voice ${s.judge.voice}, brief ${s.judge.briefFidelity})`
      : '- Editor not run',
    `- ${s.avgAttempts} calls and ${s.avgSeconds}s per email, ${s.avgWords} words on average, ${s.failedToDraft} failed to draft`,
  ];
  if (input.previous) {
    const p = input.previous;
    lines.push(
      `- Previous ("${p.label}"): clean ${pct(p.summary.cleanRate)}, style ${stylePct(p.style)}, editor ${p.summary.judge?.overall ?? '—'}`,
    );
  }

  lines.push('', '| Case | Checks | Style | Editor | Weakness |', '|---|---|---|---|---|');
  for (const c of input.cases) {
    const r = input.results[c.id];
    if (!r) continue;
    const st = styleOfResult(r);
    const o = overall(r);
    lines.push(
      `| ${c.id} | ${r.error ? 'failed' : `${r.scored!.passed}/${r.scored!.total}`} | ${st ? `${st.passed}/${st.total}` : '—'} | ${o === null ? '—' : o.toFixed(1)} | ${(r.judge?.weakness ?? r.error ?? '').replace(/\|/g, '/')} |`,
    );
  }

  const ranked = input.cases
    .map((c) => input.results[c.id])
    .filter((r): r is EvalCaseResult => !!r && !r.error)
    .sort((a, b) => (overall(a) ?? 5) - (overall(b) ?? 5));
  const attention = ranked.filter(
    (r, i) => i < 5 || r.scored!.passed < r.scored!.total || (styleOfResult(r)?.failed.length ?? 0) > 1,
  );

  lines.push('', '## Emails needing attention');
  for (const r of attention) {
    const c = input.cases.find((x) => x.id === r.caseId)!;
    const st = styleOfResult(r);
    const failedChecks = r.scored!.checks.filter((x) => !x.pass);
    lines.push(
      '',
      `### ${r.caseId} (${c.archetype}) — editor ${overall(r)?.toFixed(1) ?? '—'}`,
      `Brief: ${c.brief}`,
      ...(r.angle ? [`Angle: ${r.angle}`] : []),
      ...(r.judge ? [`Editor: ${r.judge.weakness}`] : []),
      ...(failedChecks.length ? [`Failed checks: ${failedChecks.map((x) => `${x.label}${x.detail ? ` (${x.detail})` : ''}`).join('; ')}`] : []),
      ...(st?.failed.length ? [`Style: ${st.failed.map((rule) => STYLE_RULES[rule]).join('; ')}`] : []),
      '',
      '```',
      `subject: ${r.subject}`,
      `preview: ${r.previewText}`,
      '',
      r.markup ?? '',
      '```',
    );
  }
  return lines.join('\n');
}
