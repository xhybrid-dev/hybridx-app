'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Archive, MoreHorizontal, Pause, Pencil, Play, Search, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  cancelSchedule,
  pauseCampaign,
  resumeCampaign,
  setCampaignArchived,
} from '@/lib/marketing/actions';
import type { SerialisableCampaign } from '@/lib/marketing/queries';
import { CampaignStatusBadge } from './campaign-status-badge';

const FILTERS = ['active', 'draft', 'sent', 'archived'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * A percentage, or '—' when there is nothing to divide by.
 *
 * A real, positive numerator with a zero denominator is not "nothing
 * happened" — opens and clicks cannot exist without recipients, so that
 * combination means recipientCount itself has drifted from what the sends
 * actually record (see recomputeCampaignCounts). Collapsing it to the same
 * '—' as a genuine zero would hide the exact signal that caught this bug in
 * the first place, so it is shown instead as the raw count with a marker —
 * present, but visibly not a rate.
 */
function rate(numerator: number | undefined, denominator: number): string {
  if (!denominator) return numerator ? `${numerator.toLocaleString()}*` : '—';
  return `${(((numerator ?? 0) / denominator) * 100).toFixed(1)}%`;
}

export function CampaignsTable({ campaigns }: { campaigns: SerialisableCampaign[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (q && !(c.subject ?? '').toLowerCase().includes(q)) return false;

      if (filter === 'archived') return c.archived === true;
      if (c.archived) return false;
      if (filter === 'draft') return c.status === 'draft';
      if (filter === 'sent') return c.status === 'sent';
      // 'active' — anything currently in motion or waiting to go.
      return c.status === 'scheduled' || c.status === 'sending' || c.status === 'paused';
    });
  }, [campaigns, filter, search]);

  const run = (label: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      toast(
        result.success
          ? { title: label }
          : { title: 'Action failed', description: result.error, variant: 'destructive' },
      );
    });
  };

  const actionsMenu = (c: SerialisableCampaign) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0" disabled={pending}>
          <span className="sr-only">Campaign actions</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(c.status === 'draft' || c.status === 'scheduled') && (
          <DropdownMenuItem asChild>
            <Link href={`/admin/marketing/campaigns/${c.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit and send
            </Link>
          </DropdownMenuItem>
        )}
        {c.status === 'scheduled' && (
          <DropdownMenuItem
            onClick={() => run('Schedule cancelled', () => cancelSchedule(c.id))}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancel schedule
          </DropdownMenuItem>
        )}
        {c.status === 'sending' && (
          <DropdownMenuItem onClick={() => run('Campaign paused', () => pauseCampaign(c.id))}>
            <Pause className="mr-2 h-4 w-4" />
            Pause sending
          </DropdownMenuItem>
        )}
        {c.status === 'paused' && (
          <DropdownMenuItem onClick={() => run('Campaign resumed', () => resumeCampaign(c.id))}>
            <Play className="mr-2 h-4 w-4" />
            Resume sending
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() =>
            run(c.archived ? 'Restored' : 'Archived', () =>
              setCampaignArchived(c.id, !c.archived),
            )
          }
        >
          <Archive className="mr-2 h-4 w-4" />
          {c.archived ? 'Restore' : 'Archive'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const sendProgress = (c: SerialisableCampaign) =>
    c.status === 'sending' && c.sendState ? (
      <div className="mt-1.5 max-w-[260px]">
        <Progress
          value={
            c.sendState.total
              ? ((c.sendState.sent + c.sendState.failed) / c.sendState.total) * 100
              : 0
          }
          className="h-1.5"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {c.sendState.sent.toLocaleString()} of {c.sendState.total.toLocaleString()} sent
          {c.sendState.failed > 0 && ` · ${c.sendState.failed} failed`}
        </p>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {/* Four filters do not fit a phone's width, so the bar scrolls
            sideways instead of wrapping into a second row of half-tabs. */}
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="w-max">
              {FILTERS.map((f) => (
                <TabsTrigger key={f} value={f} className="capitalize">
                  {f}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="relative w-full sm:w-auto sm:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subjects"
            className="pl-9"
          />
        </div>
      </div>

      {/* Mobile: one card per campaign, carrying the same figures and the same
          action menu as the table below. */}
      <div className="space-y-3 lg:hidden">
        {visible.length === 0 ? (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            Nothing here.
          </div>
        ) : (
          visible.map((c) => (
            <div key={c.id} className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/marketing/campaigns/${c.id}`}
                    className="font-medium hover:underline"
                  >
                    {c.subject || 'Untitled campaign'}
                  </Link>
                  <div className="mt-1.5">
                    <CampaignStatusBadge status={c.status} />
                  </div>
                  {sendProgress(c)}
                  {c.scheduledAt && c.status === 'scheduled' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scheduled for {new Date(c.scheduledAt).toLocaleString()}
                    </p>
                  )}
                </div>
                {actionsMenu(c)}
              </div>

              <dl className="mt-3 grid grid-cols-4 gap-2 border-t pt-3 text-center">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Sent to</dt>
                  <dd className="text-sm font-medium tabular-nums">
                    {c.recipientCount ? c.recipientCount.toLocaleString() : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Opened</dt>
                  <dd className="text-sm font-medium tabular-nums">
                    {rate(c.openCount, c.recipientCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Clicked</dt>
                  <dd className="text-sm font-medium tabular-nums">
                    {rate(c.clickCount, c.recipientCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Unsubs</dt>
                  <dd className="text-sm font-medium tabular-nums">{c.unsubscribeCount ?? 0}</dd>
                </div>
              </dl>
            </div>
          ))
        )}
      </div>

      <div className="hidden rounded-md border lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Recipients</TableHead>
              <TableHead className="text-right">Opened</TableHead>
              <TableHead className="text-right">Clicked</TableHead>
              <TableHead className="text-right">Unsubs</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Nothing here.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/admin/marketing/campaigns/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.subject || 'Untitled campaign'}
                    </Link>
                    {sendProgress(c)}
                    {c.scheduledAt && c.status === 'scheduled' && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Scheduled for {new Date(c.scheduledAt).toLocaleString()}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <CampaignStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.recipientCount ? c.recipientCount.toLocaleString() : '—'}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={
                      !c.recipientCount && c.openCount
                        ? 'Recipient count is missing even though opens were recorded — try Recalculate stats.'
                        : undefined
                    }
                  >
                    {rate(c.openCount, c.recipientCount)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={
                      !c.recipientCount && c.clickCount
                        ? 'Recipient count is missing even though clicks were recorded — try Recalculate stats.'
                        : undefined
                    }
                  >
                    {rate(c.clickCount, c.recipientCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.unsubscribeCount ?? 0}
                  </TableCell>
                  <TableCell>{actionsMenu(c)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
