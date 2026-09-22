'use client';
//
// "Am I getting better?" — each logged movement's first result, latest result
// and the line between them. Built from the results athletes log in the
// workout screen.

import { useMemo } from 'react';
import { format } from 'date-fns';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSessions } from '@/contexts/user-context';
import { formatTime, progressLines, type ProgressLine } from '@/lib/exercise-results';
import { cn } from '@/lib/utils';

const W = 120;
const H = 32;

function Sparkline({ line }: { line: ProgressLine }) {
  const values = line.points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // Up means better: for times, a smaller value plots higher.
  const y = (v: number) => {
    const norm = (v - min) / span;
    return 3 + (line.metric === 'time' ? norm : 1 - norm) * (H - 6);
  };
  const x = (i: number) => 3 + (i / Math.max(1, values.length - 1)) * (W - 6);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0" aria-hidden="true">
      <path d={d} fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r={3} className="fill-primary" />
    </svg>
  );
}

const show = (line: ProgressLine, value: number) => (line.metric === 'load' ? `${value}kg` : formatTime(value));

export function ProgressLinesCard() {
  const { allSessions } = useSessions();
  const lines = useMemo(() => progressLines(allSessions), [allSessions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your progress</CardTitle>
        <CardDescription>
          {lines.length > 0
            ? 'First logged result, latest, and the trend between them.'
            : 'Log your loads and times in a workout ("Log result" under each exercise) and your progress shows up here.'}
        </CardDescription>
      </CardHeader>
      {lines.length > 0 && (
        <CardContent className="divide-y">
          {lines.map(line => {
            const Icon = line.improvement > 0 ? TrendingUp : line.improvement < 0 ? TrendingDown : Minus;
            return (
              <div key={line.name} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{line.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {show(line, line.first)} → {show(line, line.latest)} · since {format(line.points[0].date, 'd MMM')}
                  </p>
                </div>
                <Sparkline line={line} />
                <span
                  className={cn(
                    'flex w-20 shrink-0 items-center justify-end gap-1 text-sm font-semibold tabular-nums',
                    line.improvement > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {line.improvement === 0 ? 'same' : `${line.improvement > 0 ? '+' : '−'}${show(line, Math.abs(line.improvement))}`}
                </span>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
