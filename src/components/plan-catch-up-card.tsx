'use client';
//
// Two ways back into the plan after time away: a "Welcome back" choice when
// sessions were missed, and pause/resume for a planned break. Without these,
// the plan kept moving by calendar day and athletes returned to a row of red
// "missed" markers somewhere in week 3.

import { useMemo, useState } from 'react';
import { differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { Loader2, PauseCircle, PlayCircle, RotateCcw, StepForward } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { computeCatchUp, startDateAfterPause, startDateForResume } from '@/lib/catch-up';
import { moveProgramStart } from '@/lib/plan-actions';
import { programDayFor } from '@/lib/program-day';
import { updateUser } from '@/services/user-service-client';
import type { WorkoutSession } from '@/services/session-service-client';
import type { Program, User } from '@/models/types';

interface Props {
  user: User;
  program: Program | null;
  allSessions: WorkoutSession[];
  sessionsLoaded: boolean;
  onChanged: () => Promise<void>;
}

const dismissKey = (userId: string, marker: string) => `catch-up-dismissed:${userId}:${marker}`;

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function PausePlanButton({ user, onChanged, className }: { user: User; onChanged: () => Promise<void>; className?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!user.programId || user.planPausedAt) return null;

  const pause = async () => {
    setBusy(true);
    try {
      await updateUser(user.id, { planPausedAt: new Date() });
      await onChanged();
      toast({ title: 'Plan paused', description: 'Nothing is due until you resume — your plan picks up where it stopped.' });
    } catch (error) {
      logger.error('Failed to pause plan:', error);
      toast({ title: 'Could not pause your plan', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={pause} disabled={busy} className={className}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />}
      Pause my plan
    </Button>
  );
}

export function PlanCatchUpCard({ user, program, allSessions, sessionsLoaded, onChanged }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const catchUp = useMemo(() => {
    if (!program || !user.startDate || user.planPausedAt || !sessionsLoaded) return null;
    const today = startOfDay(new Date());
    const finished = allSessions.filter(s => s.finishedAt && !s.skipped);
    const lastActivity = finished.reduce<Date | null>(
      (latest, s) => (!latest || s.workoutDate > latest ? s.workoutDate : latest),
      null,
    );
    const lastProgramDay = finished
      .filter(s => s.programId === program.id)
      .map(s => programDayFor(user.startDate!, s.workoutDate))
      .filter(day => day >= 1)
      .reduce((max, day) => Math.max(max, day), 0);
    const result = computeCatchUp({
      programDays: program.workouts.map(w => w.day),
      todayProgramDay: programDayFor(user.startDate, today),
      lastCompletedProgramDay: lastProgramDay,
      daysSinceLastActivity: lastActivity ? differenceInCalendarDays(today, lastActivity) : null,
    });
    if (!result) return null;
    const marker = `${format(user.startDate, 'yyyy-MM-dd')}:${lastProgramDay}`;
    return { ...result, lastActivity, marker };
  }, [program, user.startDate, user.planPausedAt, sessionsLoaded, allSessions]);

  const run = async (label: string, action: () => Promise<void>, done: { title: string; description: string }) => {
    setBusy(label);
    try {
      await action();
      await onChanged();
      toast(done);
    } catch (error) {
      logger.error(`Plan change "${label}" failed:`, error);
      toast({ title: 'Could not update your plan', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (user.planPausedAt && user.startDate) {
    const pausedAt = user.planPausedAt;
    const resume = () =>
      run(
        'resume',
        () => moveProgramStart(user, startDateAfterPause(user.startDate!, pausedAt, new Date()), { planPausedAt: null }),
        { title: 'Welcome back', description: 'Your plan picks up exactly where you paused it.' },
      );
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <PauseCircle className="h-5 w-5 text-primary" />
            Your plan is paused
          </CardTitle>
          <CardDescription>
            Paused since {format(pausedAt, 'EEEE d MMMM')}. Nothing is due while you&apos;re away, and nothing counts as missed.
          </CardDescription>
        </CardHeader>
        <CardFooter className="pt-0">
          <Button size="sm" onClick={resume} disabled={!!busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            Resume my plan
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!catchUp || dismissed || readDismissed(dismissKey(user.id, catchUp.marker))) return null;

  const today = new Date();
  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(user.id, catchUp.marker), '1');
    } catch {
      /* per-session dismissal is fine */
    }
    setDismissed(true);
  };
  const neverStarted = catchUp.resumeDay === 1;

  return (
    <Card className="border-accent/50 bg-gradient-to-r from-accent/10 to-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Welcome back, {user.firstName || 'athlete'}</CardTitle>
        <CardDescription>
          {neverStarted
            ? `Your plan started without you — ${catchUp.missedSessions} sessions have gone by. Want to start it properly from today?`
            : `You've missed ${catchUp.missedSessions} sessions since ${catchUp.lastActivity ? format(catchUp.lastActivity, 'EEEE d MMMM') : 'your last workout'}. Life happens — how do you want to pick things up?`}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-2 pt-0">
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() =>
            run('resume-day', () => moveProgramStart(user, startDateForResume(today, catchUp.resumeDay)), {
              title: neverStarted ? 'Day 1 is today' : 'Picked up where you left off',
              description: `Today is now day ${catchUp.resumeDay} of your plan.`,
            })
          }
        >
          {busy === 'resume-day' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StepForward className="mr-2 h-4 w-4" />}
          {neverStarted ? 'Start from day 1' : 'Pick up where I left off'}
        </Button>
        {catchUp.repeatWeekDay < catchUp.resumeDay && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              run('repeat-week', () => moveProgramStart(user, startDateForResume(today, catchUp.repeatWeekDay)), {
                title: 'Repeating the week',
                description: `Today is day ${catchUp.repeatWeekDay} — ease back in with a week you know.`,
              })
            }
          >
            {busy === 'repeat-week' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Repeat week {Math.ceil(catchUp.repeatWeekDay / 7)}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={dismiss}>
          Carry on as planned
        </Button>
        <PausePlanButton user={user} onChanged={onChanged} />
      </CardFooter>
    </Card>
  );
}
