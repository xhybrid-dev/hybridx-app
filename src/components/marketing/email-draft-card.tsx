'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Eye, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { BLOCK_LABELS, blockText, type EmailBlock } from '@/lib/marketing/blocks';
import { APP_MARKETING_PATHS } from '@/lib/marketing/app-routes';
import { BlockFieldsEditor } from '@/components/marketing/block-fields-editor';
import { renderBlocks } from '@/lib/marketing/render';
import type { ValidationIssue } from '@/lib/marketing/validate';
import {
  revalidateContent,
  reviseEmailBlock,
  suggestSubjects,
} from '@/lib/marketing/studio-actions';

export interface DraftedEmail {
  workingTitle: string;
  brief: string;
  subject: string;
  previewText: string;
  blocks: EmailBlock[];
  html: string;
  issues: ValidationIssue[];
  valid: boolean;
}

interface Props {
  draft: DraftedEmail;
  index: number;
  audienceDescription?: string;
  onChange: (draft: DraftedEmail) => void;
}

export function EmailDraftCard({ draft, index, audienceDescription, onChange }: Props) {
  // Re-render from blocks rather than trusting draft.html, which was produced
  // server-side at drafting time and goes stale the moment a block is revised
  // or the preview text is edited. renderBlocks is pure and dependency-free, so
  // running it here costs nothing and keeps the preview honest.
  const previewHtml = useMemo(
    () => renderBlocks(draft.blocks, { previewText: draft.previewText }),
    [draft.blocks, draft.previewText],
  );

  const { toast } = useToast();
  const [busyBlock, setBusyBlock] = useState<number | null>(null);
  const [instruction, setInstruction] = useState<Record<number, string>>({});
  const [subjectIdeas, setSubjectIdeas] = useState<
    Array<{ subject: string; previewText: string; angle: string; rationale: string }>
  >([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  const errors = draft.issues.filter((i) => i.severity === 'error');
  const warnings = draft.issues.filter((i) => i.severity === 'warning');
  // Issues that belong to one block are shown on that block, where they can be
  // fixed, as well as in the summary above.
  const issuesByBlock = new Map<number, typeof draft.issues>();
  for (const issue of draft.issues) {
    if (issue.blockIndex === undefined) continue;
    issuesByBlock.set(issue.blockIndex, [...(issuesByBlock.get(issue.blockIndex) ?? []), issue]);
  }

  /** Re-check after any edit — a marketer typing a price by hand can be as wrong as the model. */
  const revalidate = async (next: DraftedEmail) => {
    const result = await revalidateContent({ subject: next.subject, blocks: next.blocks, brief: next.brief });
    onChange(
      result.success ? { ...next, issues: result.data.issues, valid: result.data.valid } : next,
    );
  };

  const handleRevise = async (blockIndex: number) => {
    const text = instruction[blockIndex]?.trim();
    if (!text) return;

    setBusyBlock(blockIndex);
    const result = await reviseEmailBlock({
      block: draft.blocks[blockIndex],
      instruction: text,
      emailContext: draft.blocks.map(blockText).filter(Boolean).join('\n'),
    });
    setBusyBlock(null);

    if (!result.success) {
      toast({ title: 'Could not revise', description: result.error, variant: 'destructive' });
      return;
    }

    const blocks = draft.blocks.map((b, i) => (i === blockIndex ? result.data : b));
    setInstruction({ ...instruction, [blockIndex]: '' });
    await revalidate({ ...draft, blocks });
  };

  const handleSuggestSubjects = async () => {
    setLoadingSubjects(true);
    const result = await suggestSubjects({
      currentSubject: draft.subject,
      emailSummary: draft.blocks.map(blockText).filter(Boolean).join(' ').slice(0, 800),
      audienceDescription,
    });
    setLoadingSubjects(false);

    if (!result.success) {
      toast({ title: 'Could not suggest', description: result.error, variant: 'destructive' });
      return;
    }
    setSubjectIdeas(result.data.variants);
  };

  return (
    <Card className={errors.length ? 'border-destructive/50' : undefined}>
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {index + 1}. {draft.workingTitle}
            </CardTitle>
            <CardDescription className="mt-1">{draft.brief}</CardDescription>
          </div>
          {errors.length > 0 ? (
            <Badge variant="destructive">
              {errors.length} issue{errors.length === 1 ? '' : 's'} to fix
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-green-500/15 text-green-600 dark:text-green-400">
              Checked
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                    issue.severity === 'error' ? 'text-destructive' : 'text-orange-500'
                  }`}
                />
                <span>
                  <strong className="break-all font-mono text-xs">{issue.found}</strong> — {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor={`subject-${index}`}>Subject</Label>
          <div className="flex gap-2">
            <Input
              id={`subject-${index}`}
              value={draft.subject}
              onChange={(e) => onChange({ ...draft, subject: e.target.value })}
              onBlur={() => revalidate(draft)}
            />
            <Button variant="outline" size="icon" className="shrink-0" onClick={handleSuggestSubjects} disabled={loadingSubjects}>
              {loadingSubjects ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.subject.length} characters
            {draft.subject.length > 60 && ' — most inboxes truncate beyond about 60'}
          </p>
        </div>

        {subjectIdeas.length > 0 && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Alternatives, ranked against this list&apos;s own history
            </p>
            {subjectIdeas.map((idea, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const next = { ...draft, subject: idea.subject, previewText: idea.previewText };
                  setSubjectIdeas([]);
                  void revalidate(next);
                }}
                className="w-full rounded-md border p-2 text-left transition-colors hover:bg-muted"
              >
                <p className="text-sm font-medium">{idea.subject}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">{idea.angle}</span> — {idea.rationale}
                </p>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={`preview-${index}`}>Preview text</Label>
          <Input
            id={`preview-${index}`}
            value={draft.previewText}
            onChange={(e) => onChange({ ...draft, previewText: e.target.value })}
          />
        </div>

        <Tabs defaultValue="blocks">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="blocks" className="flex-1 sm:flex-none">
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Content
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1 sm:flex-none">
              <Eye className="mr-2 h-3.5 w-3.5" />
              Preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="blocks" className="space-y-2 pt-3">
            {draft.blocks.map((block, i) => {
              /**
               * Every keystroke. No revalidation here — this only rebuilds
               * the array and lifts it up, same as onChange elsewhere.
               */
              const updateBlock = (next: EmailBlock) => {
                const blocks = draft.blocks.map((b, j) => (j === i ? next : b));
                onChange({ ...draft, blocks });
              };
              /**
               * A field committed on blur. Takes the FINAL value directly
               * from BlockFieldsEditor rather than re-reading `block` or
               * `draft.blocks` — draft is this render's prop and updateBlock
               * above has almost certainly already changed it, so revalidate
               * must be given the array built from the value just handed to
               * it, not from a second, possibly-stale read of state.
               */
              const commitBlock = (next: EmailBlock) => {
                const blocks = draft.blocks.map((b, j) => (j === i ? next : b));
                void revalidate({ ...draft, blocks });
              };
              const blockIssues = issuesByBlock.get(i) ?? [];
              const removeBlock = () => {
                const blocks = draft.blocks.filter((_, j) => j !== i);
                void revalidate({ ...draft, blocks });
              };
              return (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${blockIssues.length ? 'border-destructive/60 bg-destructive/5' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {BLOCK_LABELS[block.type]}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={removeBlock}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                  {blockIssues.map((issue, k) => (
                    <p key={k} className="mt-2 flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {issue.message}
                    </p>
                  ))}
                  <div className="mt-2">
                    <BlockFieldsEditor
                      block={block}
                      onChange={updateBlock}
                      onCommit={commitBlock}
                      idPrefix={`draft-${index}-block-${i}`}
                      urlListId="cta-known-urls"
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={instruction[i] ?? ''}
                      onChange={(e) => setInstruction({ ...instruction, [i]: e.target.value })}
                      placeholder="Shorter, harder CTA, less corporate…"
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleRevise(i);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyBlock === i || !instruction[i]?.trim()}
                      onClick={() => handleRevise(i)}
                    >
                      {busyBlock === i ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="preview" className="pt-3">
            <iframe
              srcDoc={previewHtml}
              title={`Preview of ${draft.workingTitle}`}
              className="h-[60vh] min-h-[320px] w-full rounded-md border bg-white sm:h-[520px]"
              sandbox=""
            />
          </TabsContent>
        </Tabs>
      </CardContent>

      <datalist id="cta-known-urls">
        {APP_MARKETING_PATHS.map((path) => (
          <option key={path} value={`https://app.hybridx.club${path === '/' ? '' : path}`} />
        ))}
      </datalist>
    </Card>
  );
}
