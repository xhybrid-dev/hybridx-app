'use client';
//
// "What did you actually do?" for one exercise: load, reps and time (or
// distance and time for a run), with last time shown alongside so progress is
// visible in the moment. Everything is optional — ticking the box still works.

import { useState } from 'react';
import { format } from 'date-fns';
import { Clock, PencilLine } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatResult, formatTime, hasAnyValue, parseTime, type DatedResult } from '@/lib/exercise-results';
import type { ExerciseResult } from '@/models/types';

interface Props {
  name: string;
  kind: 'strength' | 'run';
  value: ExerciseResult | undefined;
  last: DatedResult | null;
  /** Prescribed distance in metres, for runs. */
  defaultDistance?: number;
  disabled?: boolean;
  onChange: (result: ExerciseResult) => void;
}

const toNumber = (text: string) => {
  const n = Number(text);
  return text.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
};

export function ExerciseResultInput({ name, kind, value, last, defaultDistance, disabled, onChange }: Props) {
  const [open, setOpen] = useState(hasAnyValue(value));
  const [load, setLoad] = useState(value?.load?.toString() ?? '');
  const [reps, setReps] = useState(value?.reps?.toString() ?? '');
  const [distance, setDistance] = useState((value?.distance ?? defaultDistance)?.toString() ?? '');
  const [time, setTime] = useState(value?.timeSeconds ? formatTime(value.timeSeconds) : '');

  const emit = (next: { load?: string; reps?: string; distance?: string; time?: string }) => {
    const merged = { load, reps, distance, time, ...next };
    onChange({
      name,
      load: kind === 'strength' ? toNumber(merged.load) : undefined,
      reps: kind === 'strength' ? toNumber(merged.reps) : undefined,
      distance: kind === 'run' ? toNumber(merged.distance) : undefined,
      timeSeconds: parseTime(merged.time),
    });
  };

  const lastLine = last ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      Last time: {formatResult(last)} · {format(last.date, 'd MMM')}
    </span>
  ) : null;

  if (disabled) {
    return hasAnyValue(value) ? <p className="mt-1.5 text-xs font-medium text-primary">Logged: {formatResult(value!)}</p> : lastLine;
  }

  if (!open) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {lastLine}
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(true)}>
          <PencilLine className="mr-1 h-3.5 w-3.5" />
          Log result
        </Button>
      </div>
    );
  }

  const field = 'h-8 w-20 text-sm';
  return (
    <div className="mt-2 space-y-1.5">
      {lastLine}
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'strength' ? (
          <>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input className={field} inputMode="decimal" placeholder={last?.load ? String(last.load) : 'kg'} value={load}
                onChange={e => { setLoad(e.target.value); emit({ load: e.target.value }); }} aria-label={`${name} load in kg`} />
              kg
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input className={field} inputMode="numeric" placeholder={last?.reps ? String(last.reps) : 'reps'} value={reps}
                onChange={e => { setReps(e.target.value); emit({ reps: e.target.value }); }} aria-label={`${name} reps`} />
              reps
            </label>
          </>
        ) : (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input className={field} inputMode="numeric" placeholder="m" value={distance}
              onChange={e => { setDistance(e.target.value); emit({ distance: e.target.value }); }} aria-label={`${name} distance in metres`} />
            m
          </label>
        )}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input className={field} inputMode="text" placeholder={last?.timeSeconds ? formatTime(last.timeSeconds) : 'mm:ss'} value={time}
            onChange={e => { setTime(e.target.value); emit({ time: e.target.value }); }} aria-label={`${name} time`} />
          time
        </label>
      </div>
    </div>
  );
}
