'use client';
//
// The end of a program is the most predictable moment for an athlete to drift
// away, and it used to arrive silently: the dashboard just switched to "No
// workout scheduled". This marks the finish, sums up the block, and offers the
// next one — starting a week before the end so there's no gap.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Flag, Trophy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { hyroxProgramsComparison } from '@/data/hyrox-programs-comparison';
import { getTopPrograms } from '@/services/program-recommendation';
import type { WorkoutSession } from '@/services/session-service-client';
import type { Program, User } from '@/models/types';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** The next block: one level up from what they just finished, never the same program. */
export function nextBlockFor(user: User, programId: string) {
  const finished = hyroxProgramsComparison.find(p => p.id === programId);
  const currentLevel = finished?.experienceLevel ?? user.experience ?? 'beginner';
  const next = LEVELS[Math.min(LEVELS.indexOf(currentLevel) + (finished ? 1 : 0), LEVELS.length - 1)];
  return getTopPrograms(
    { experience: next, frequency: user.frequency ?? '3', goal: user.goal ?? 'hybrid' },
    4,
  ).find(r => r.program.id !== programId)?.program ?? null;
}

export function ProgramFinishCard({
  user,
  program,
  todayProgramDay,
  allSessions,
}: {
  user: User;
  program: Program | null;
  todayProgramDay: number;
  allSessions: WorkoutSession[];
}) {
  const [dismissed, setDismissed] = useState(false);

  const info = useMemo(() => {
    if (!program || !user.startDate || user.planPausedAt || program.workouts.length === 0) return null;
    const cycleLength = Math.max(...program.workouts.map(w => w.day));
    const daysLeft = cycleLength - todayProgramDay;
    if (daysLeft > 7) return null;

    const name =
      program.name ?? hyroxProgramsComparison.find(p => p.id === program.id)?.name ?? 'your plan';
    const scheduled = new Set(program.workouts.map(w => w.day)).size;
    const completed = new Set(
      allSessions
        .filter(s => s.programId === program.id && s.finishedAt && !s.skipped && s.workoutDate >= user.startDate!)
        .map(s => s.workoutDate.toDateString()),
    ).size;
    return {
      finished: daysLeft < 0,
      daysLeft,
      name,
      completed,
      scheduled,
      next: nextBlockFor(user, program.id),
      dismissKey: `program-finish-dismissed:${program.id}:${user.startDate.toISOString().slice(0, 10)}`,
    };
  }, [program, user, todayProgramDay, allSessions]);

  if (!info || dismissed) return null;
  if (!info.finished) {
    try {
      if (localStorage.getItem(info.dismissKey) === '1') return null;
    } catch {
      /* show it */
    }
  }

  const dismiss = () => {
    try {
      localStorage.setItem(info.dismissKey, '1');
    } catch {
      /* per-visit is fine */
    }
    setDismissed(true);
  };

  const rate = info.scheduled > 0 ? Math.round((Math.min(info.completed, info.scheduled) / info.scheduled) * 100) : 0;

  if (info.finished) {
    return (
      <Card className="border-primary/40 bg-gradient-to-br from-primary/10 to-accent/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Trophy className="h-6 w-6 text-primary" />
            You finished {info.name}
          </CardTitle>
          <CardDescription>
            That&apos;s a full block of training in the bank. Keep the momentum — the next block builds on it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-lg bg-background/70 p-3">
            <p className="text-2xl font-bold tabular-nums">{info.completed}</p>
            <p className="text-xs text-muted-foreground">sessions completed</p>
          </div>
          <div className="rounded-lg bg-background/70 p-3">
            <p className="text-2xl font-bold tabular-nums">{rate}%</p>
            <p className="text-xs text-muted-foreground">of the plan</p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {info.next && (
            <Button asChild>
              <Link href={`/programs/${info.next.id}/view`}>
                Next up: {info.next.name} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/programs">Browse programs</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Flag className="h-5 w-5 text-primary" />
          {info.daysLeft === 0 ? `Last day of ${info.name}` : `${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'} left of ${info.name}`}
        </CardTitle>
        <CardDescription>
          Line up your next block now so there&apos;s no gap in your training.
          {info.next ? ` We'd suggest ${info.next.name}.` : ''}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-2 pt-0">
        {info.next && (
          <Button asChild size="sm">
            <Link href={`/programs/${info.next.id}/view`}>
              See {info.next.name} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Later
        </Button>
      </CardFooter>
    </Card>
  );
}
