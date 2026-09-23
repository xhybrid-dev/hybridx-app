// src/app/(app)/calendar/page.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, lazy, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getAuthInstance } from '@/lib/firebase';
import { getUserClient } from '@/services/user-service-client';
import { getProgramClient } from '@/services/program-service-client';
import { getWorkoutForDay, formatPlannedRun } from '@/lib/workout-utils';
import { getUserSessionsInRange, getRecentUserSessions, getOrCreateWorkoutSession, updateWorkoutSession } from '@/services/session-service-client';
import { saveScheduleChanges, swapWorkouts } from '@/services/session-service';
import { trackEvent } from '@/lib/analytics';
import { useUser } from '@/contexts/user-context';
import { PausePlanButton, PlanCatchUpCard } from '@/components/plan-catch-up-card';
import type { Program, WorkoutDay, WorkoutSession, RunningWorkout, Workout, UnitSystem } from '@/models/types';
import { hasRuns, hasExercises } from '@/lib/type-guards';
import { convertDistance, convertTextWithUnits } from '@/lib/unit-conversion';
import { formatTextWithBullets } from '@/utils/text-formatter';
import { addDays, format, isSameDay, parseISO, isValid, isToday, isPast, startOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { RotateCcw, Loader2, CheckCircle2, XCircle, GripVertical, Link as LinkIcon, Forward, Edit, CheckCircle, CalendarDays, ListChecks, Wrench } from 'lucide-react';
import { canFixTreadmill } from '@/lib/treadmill';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedCallback } from 'use-debounce';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

const MonthCalendarWidget = lazy(() => import('@/components/ui/calendar').then(mod => ({ default: mod.Calendar })));
const LinkStravaActivityDialog = lazy(() => import('@/components/link-strava-activity-dialog').then(mod => ({ default: mod.LinkStravaActivityDialog })));
const FixTreadmillDialog = lazy(() => import('@/components/fix-treadmill-dialog').then(mod => ({ default: mod.FixTreadmillDialog })));

interface DaySlot {
  date: Date;
  dateKey: string;
  workouts: WorkoutDay[];
  sessions: WorkoutSession[];
  isToday: boolean;
  isPast: boolean;
}

function isRestDayWorkout(workout: WorkoutDay): boolean {
  const t = workout.title.toLowerCase();
  return t.includes('rest') || t.includes('recover');
}

function workoutAccentClass(workout: WorkoutDay): string {
  if (hasRuns(workout) && hasExercises(workout)) return 'border-l-teal-500';
  if (hasRuns(workout)) {
    switch ((workout as RunningWorkout).runs[0]?.type) {
      case 'intervals': return 'border-l-orange-500';
      case 'tempo': return 'border-l-yellow-500';
      case 'long': return 'border-l-blue-600';
      case 'easy':
      case 'recovery': return 'border-l-blue-400';
      default: return 'border-l-blue-500';
    }
  }
  if (hasExercises(workout)) {
    return (workout as Workout).exercises[0]?.sessionType === 'cardio' ? 'border-l-pink-500' : 'border-l-purple-500';
  }
  return 'border-l-gray-400';
}

function summarizeWorkout(workout: WorkoutDay, unitSystem?: UnitSystem): string {
  if (hasRuns(workout)) {
    const totalKm = (workout as RunningWorkout).runs.reduce((sum, r) => sum + (r.distance || 0), 0);
    return convertDistance(totalKm, unitSystem ?? 'metric');
  }
  if (hasExercises(workout)) {
    const n = (workout as Workout).exercises.length;
    return `${n} exercise${n === 1 ? '' : 's'}`;
  }
  return '';
}

function buildDaySlots(program: Program, startDate: Date, sessions: WorkoutSession[], rangeStart: Date, rangeEnd: Date): DaySlot[] {
  const sessionsByDate = new Map<string, WorkoutSession[]>();
  sessions.forEach(s => {
    const key = format(startOfDay(s.workoutDate), 'yyyy-MM-dd');
    const list = sessionsByDate.get(key) ?? [];
    list.push(s);
    sessionsByDate.set(key, list);
  });
  sessionsByDate.forEach(list => list.sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0)));

  const today0 = startOfDay(new Date());
  const slots: DaySlot[] = [];
  let cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const dateKey = format(cursor, 'yyyy-MM-dd');
    const persisted = sessionsByDate.get(dateKey);
    // A persisted doc for the date (even a content-less "cleared" one) is fully authoritative —
    // it never partially falls back to the program's original schedule for that date.
    const workouts = persisted
      ? persisted.map(s => s.workoutDetails).filter((w): w is WorkoutDay => !!w)
      : getWorkoutForDay(program, startDate, cursor).sessions;

    slots.push({
      date: new Date(cursor),
      dateKey,
      workouts,
      sessions: persisted ?? [],
      isToday: isSameDay(cursor, today0),
      isPast: cursor < today0,
    });
    cursor = addDays(cursor, 1);
  }
  return slots;
}

const MAX_FUTURE_WEEKS = 16;
const MAX_PAST_DAYS = 90;

function WeeklyScheduleView() {
  const [loading, setLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [programStartDate, setProgramStartDate] = useState<Date | null>(null);
  const [unitSystem, setUnitSystem] = useState<UnitSystem | undefined>(undefined);
  const [allSlots, setAllSlots] = useState<DaySlot[]>([]);
  const [originalByKey, setOriginalByKey] = useState<Map<string, WorkoutDay[]>>(new Map());
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const [visibleFromDate, setVisibleFromDate] = useState<Date>(() => startOfDay(new Date()));
  const [activeDrag, setActiveDrag] = useState<WorkoutDay | null>(null);
  const [detailWorkout, setDetailWorkout] = useState<WorkoutDay | null>(null);
  const [markingDoneKey, setMarkingDoneKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const pendingScrollAdjustRef = useRef<number | null>(null);

  const loadCalendarData = useCallback(async (fbUser: FirebaseUser) => {
    try {
      const user = await getUserClient(fbUser.uid);
      setUnitSystem(user?.unitSystem);

      let userProgram: Program | null = null;
      if (user?.programId && user.startDate) {
        userProgram = user.customProgram
          ? ({ id: user.programId, workouts: user.customProgram } as Program)
          : await getProgramClient(user.programId);
      }
      setProgram(userProgram);

      if (!userProgram || !user?.startDate) {
        setAllSlots([]);
        setOriginalByKey(new Map());
        setChangedKeys(new Set());
        return;
      }

      const startDate = startOfDay(new Date(user.startDate));
      setProgramStartDate(startDate);
      const today0 = startOfDay(new Date());
      const rangeStart = addDays(today0, -MAX_PAST_DAYS);
      const cycleLength = Math.max(...userProgram.workouts.map(w => w.day), 0);
      const programEnd = addDays(startDate, Math.max(cycleLength - 1, 0));
      const currentWeekEnd = endOfWeek(today0, { weekStartsOn: 1 });
      const candidateEnd = programEnd > currentWeekEnd ? programEnd : currentWeekEnd;
      const cappedEnd = addDays(today0, MAX_FUTURE_WEEKS * 7 - 1);
      const rangeEnd = candidateEnd < cappedEnd ? candidateEnd : cappedEnd;

      // Persisted sessions only override the program's own schedule per day. If the
      // read fails, still build the calendar from the program itself rather than
      // leaving the athlete with an empty calendar and no way to tell why.
      let sessions: WorkoutSession[] = [];
      try {
        // Exactly the window buildDaySlots walks. It keys sessions by workoutDate
        // and iterates rangeStart..rangeEnd, so reading the whole history (which
        // is what this did) transferred the rest only to discard it.
        sessions = await getUserSessionsInRange(fbUser.uid, rangeStart, rangeEnd);
      } catch (error) {
        logger.error('Failed to load workout sessions for the calendar:', error);
      }
      const slots = buildDaySlots(userProgram, startDate, sessions, rangeStart, rangeEnd);

      setAllSlots(slots);
      setOriginalByKey(new Map(slots.map(s => [s.dateKey, s.workouts])));
      setChangedKeys(new Set());
      setVisibleFromDate(today0);
    } catch (error) {
      console.error('Error fetching calendar data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsubscribe: () => void = () => {};
    const initialize = async () => {
      const auth = await getAuthInstance();
      unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
          setFirebaseUser(fbUser);
          setLoading(true);
          await loadCalendarData(fbUser);
        } else {
          setLoading(false);
        }
      });
    };
    initialize();
    return () => unsubscribe();
  }, [loadCalendarData]);

  // Resolve the scrollable ancestor (the app shell's <main>) once mounted.
  useEffect(() => {
    scrollRootRef.current = sentinelRef.current?.closest('main') ?? null;
  }, [allSlots.length]);

  const revealEarlierWeek = useCallback(() => {
    const root = scrollRootRef.current;
    if (root) pendingScrollAdjustRef.current = root.scrollHeight;
    setVisibleFromDate(prev => {
      const earliestLoaded = allSlots[0]?.date;
      const candidate = startOfWeek(addDays(prev, -1), { weekStartsOn: 1 });
      if (earliestLoaded && candidate < earliestLoaded) return earliestLoaded;
      return candidate;
    });
  }, [allSlots]);

  // Watch a sentinel above the list; scrolling near it reveals one more past week.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || allSlots.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) revealEarlierWeek();
    }, { root: scrollRootRef.current, rootMargin: '300px 0px 0px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [allSlots.length, revealEarlierWeek]);

  // Keep the scroll position anchored when older weeks are prepended above the viewport.
  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    if (root && pendingScrollAdjustRef.current !== null) {
      root.scrollTop += root.scrollHeight - pendingScrollAdjustRef.current;
      pendingScrollAdjustRef.current = null;
    }
  }, [visibleFromDate]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const [dateKey, indexStr] = String(event.active.id).split('::');
    const slot = allSlots.find(d => d.dateKey === dateKey);
    const workout = slot?.workouts[Number(indexStr)];
    if (workout) setActiveDrag(workout);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const [sourceDateKey, sourceIndexStr] = String(active.id).split('::');
    const sourceIndex = Number(sourceIndexStr);
    const targetDateKey = String(over.id);
    if (sourceDateKey === targetDateKey) return;

    setAllSlots(prev => {
      const sourceSlot = prev.find(d => d.dateKey === sourceDateKey);
      const targetSlot = prev.find(d => d.dateKey === targetDateKey);
      if (!sourceSlot || !targetSlot || sourceIndex < 0 || sourceIndex >= sourceSlot.workouts.length) return prev;

      const movedWorkout = sourceSlot.workouts[sourceIndex];
      const remainingSource = sourceSlot.workouts.filter((_, i) => i !== sourceIndex);
      // A day whose only content is a "Rest" placeholder is treated as empty — dropping something
      // real there replaces the placeholder instead of sitting alongside it.
      const targetContent = (targetSlot.workouts.length === 1 && isRestDayWorkout(targetSlot.workouts[0]))
        ? []
        : targetSlot.workouts;

      // Straight swap when it's an unambiguous one-for-one trade; otherwise the moved workout
      // just joins the target day without evicting whatever else is already scheduled there.
      const isSimpleSwap = remainingSource.length === 0 && targetContent.length === 1;
      const newSourceWorkouts = isSimpleSwap ? [targetContent[0]] : remainingSource;
      const newTargetWorkouts = isSimpleSwap ? [movedWorkout] : [...targetContent, movedWorkout];

      return prev.map(d => {
        if (d.dateKey === sourceDateKey) return { ...d, workouts: newSourceWorkouts };
        if (d.dateKey === targetDateKey) return { ...d, workouts: newTargetWorkouts };
        return d;
      });
    });
    setChangedKeys(prev => new Set(prev).add(sourceDateKey).add(targetDateKey));
  };

  const handleResetWeek = (weekKeys: string[]) => {
    setAllSlots(prev => prev.map(d => weekKeys.includes(d.dateKey) ? { ...d, workouts: originalByKey.get(d.dateKey) ?? [] } : d));
    setChangedKeys(prev => {
      const next = new Set(prev);
      weekKeys.forEach(k => next.delete(k));
      return next;
    });
  };

  const handleSave = async () => {
    if (!firebaseUser || !program || changedKeys.size === 0) return;
    setSaving(true);
    try {
      const days = Array.from(changedKeys).map(key => {
        const slot = allSlots.find(d => d.dateKey === key)!;
        return { date: slot.date, workouts: slot.workouts };
      });
      await saveScheduleChanges({ programId: program.id, days });
      toast({ title: 'Schedule updated', description: 'Your training calendar has been saved.' });
      await loadCalendarData(firebaseUser);
    } catch (error) {
      console.error('Failed to save schedule changes:', error);
      toast({ title: 'Error', description: 'Could not save your changes. Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkDone = async (dateKey: string, index: number, workout: WorkoutDay) => {
    if (!firebaseUser || !program) return;
    const slot = allSlots.find(d => d.dateKey === dateKey);
    if (!slot) return;
    const markKey = `${dateKey}::${index}`;
    setMarkingDoneKey(markKey);
    try {
      const session = await getOrCreateWorkoutSession(
        firebaseUser.uid, program.id, slot.date, workout, false, undefined, index, slot.workouts.length
      );
      const completedAt = new Date(slot.date);
      completedAt.setHours(12, 0, 0, 0);
      await updateWorkoutSession(session.id, { finishedAt: completedAt, workoutTitle: workout.title, skipped: false });

      setAllSlots(prev => prev.map(d => {
        if (d.dateKey !== dateKey) return d;
        const already = d.sessions.some(s => (s.sessionIndex ?? 0) === index);
        const updatedSessions = already
          ? d.sessions.map(s => (s.sessionIndex ?? 0) === index ? { ...s, finishedAt: completedAt, skipped: false } : s)
          : [...d.sessions, { ...session, finishedAt: completedAt, skipped: false }];
        return { ...d, sessions: updatedSessions };
      }));
      toast({ title: 'Marked as completed', description: `${workout.title} logged.` });
    } catch (error) {
      console.error('Failed to mark workout done:', error);
      toast({ title: 'Error', description: 'Could not mark workout as completed.', variant: 'destructive' });
    } finally {
      setMarkingDoneKey(null);
    }
  };

  const visibleSlots = useMemo(() => allSlots.filter(s => s.date >= visibleFromDate), [allSlots, visibleFromDate]);

  const { leadingSlots, weekChunks } = useMemo(() => {
    if (visibleSlots.length === 0) return { leadingSlots: [] as DaySlot[], weekChunks: [] as DaySlot[][] };
    const today0 = startOfDay(new Date());
    const currentWeekEnd = endOfWeek(today0, { weekStartsOn: 1 });
    const leading = visibleSlots.filter(s => s.date >= today0 && s.date <= currentWeekEnd);
    const others = visibleSlots.filter(s => s.date < today0 || s.date > currentWeekEnd);

    const groupsMap = new Map<string, DaySlot[]>();
    others.forEach(s => {
      const weekKey = format(startOfWeek(s.date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const list = groupsMap.get(weekKey) ?? [];
      list.push(s);
      groupsMap.set(weekKey, list);
    });
    const chunks = Array.from(groupsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, days]) => days);

    return { leadingSlots: leading, weekChunks: chunks };
  }, [visibleSlots]);

  const canLoadMorePast = allSlots.length > 0 && visibleFromDate > allSlots[0].date;

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-muted-foreground">Assign a program in your profile to see and rearrange your training calendar.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-6 max-w-2xl mx-auto pb-24">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Long-press and drag a workout onto another day to reschedule it.</p>
          <Button onClick={handleSave} disabled={changedKeys.size === 0 || saving} className={cn(changedKeys.size === 0 && 'opacity-50')}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save{changedKeys.size > 0 ? ` (${changedKeys.size})` : ''}
          </Button>
        </div>

        {allSlots.length === 0 ? (
          <Card><CardContent className="text-center py-12"><p className="text-muted-foreground">No upcoming schedule found.</p></CardContent></Card>
        ) : (
          <>
            <div ref={sentinelRef} className="h-1" />
            {canLoadMorePast && (
              <p className="text-center text-xs text-muted-foreground">Scroll up for earlier weeks</p>
            )}

            {weekChunks.filter(week => week[0].date < startOfDay(new Date())).map((week, wi) => (
              <WeekSection
                key={`past-${wi}`}
                week={week}
                program={program}
                programStartDate={programStartDate}
                unitSystem={unitSystem}
                changedKeys={changedKeys}
                onResetWeek={handleResetWeek}
                onOpenDetail={setDetailWorkout}
                onMarkDone={handleMarkDone}
                markingDoneKey={markingDoneKey}
              />
            ))}

            <div className="rounded-lg border overflow-hidden divide-y">
              {leadingSlots.map(day => (
                <DayRow
                  key={day.dateKey}
                  day={day}
                  unitSystem={unitSystem}
                  onOpenDetail={setDetailWorkout}
                  onMarkDone={handleMarkDone}
                  markingDoneKey={markingDoneKey}
                />
              ))}
            </div>

            {weekChunks.filter(week => week[0].date >= startOfDay(new Date())).map((week, wi) => (
              <WeekSection
                key={`future-${wi}`}
                week={week}
                program={program}
                programStartDate={programStartDate}
                unitSystem={unitSystem}
                changedKeys={changedKeys}
                onResetWeek={handleResetWeek}
                onOpenDetail={setDetailWorkout}
                onMarkDone={handleMarkDone}
                markingDoneKey={markingDoneKey}
              />
            ))}
          </>
        )}
      </div>

      <DragOverlay>
        {activeDrag && (
          <div className={cn('rounded-lg bg-card border-l-4 shadow-lg px-3 py-2 max-w-xs', workoutAccentClass(activeDrag))}>
            <p className="font-semibold text-sm">{activeDrag.title}</p>
            <p className="text-xs text-muted-foreground">{summarizeWorkout(activeDrag, unitSystem)}</p>
          </div>
        )}
      </DragOverlay>

      <WorkoutDetailDialog workout={detailWorkout} unitSystem={unitSystem} onClose={() => setDetailWorkout(null)} />
    </DndContext>
  );
}

// ─── Month grid view (legacy) ──────────────────────────────────────────────
// A classic month calendar with dot indicators, kept as an alternate view for people who prefer
// an at-a-glance month overview over the scrollable weekly list above.

interface MonthWorkoutEvent {
  date: Date;
  /** One entry per sub-workout scheduled for the day (e.g. a Run + a Weight Training session). */
  workouts: WorkoutDay[];
  /** Parallel to `workouts` — the persisted session for that slot, if one has been started/completed. */
  sessions: (WorkoutSession | undefined)[];
  isCompleted: boolean;
  isMissed: boolean;
  isRestDay: boolean;
}

function MonthGridCalendarView() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(true);
  const [workoutEvents, setWorkoutEvents] = useState<MonthWorkoutEvent[]>([]);
  const [isLinkerOpen, setIsLinkerOpen] = useState(false);
  const [sessionToLink, setSessionToLink] = useState<WorkoutSession | null>(null);
  const [isFixOpen, setIsFixOpen] = useState(false);
  const [sessionToFix, setSessionToFix] = useState<WorkoutSession | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [editingNotesIndex, setEditingNotesIndex] = useState<number | null>(null);
  const [notesByIndex, setNotesByIndex] = useState<Record<number, string>>({});
  const [markingDoneIndex, setMarkingDoneIndex] = useState<number | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const selectedEvent = workoutEvents.find(event =>
    selectedDate && isSameDay(event.date, selectedDate)
  );

  const todaysEvent = workoutEvents.find(event => isToday(event.date));

  // When selectedEvent changes, reset per-row notes drafts
  useEffect(() => {
    const initialNotes: Record<number, string> = {};
    selectedEvent?.sessions.forEach((s, i) => {
      if (s?.notes) initialNotes[i] = s.notes;
    });
    setNotesByIndex(initialNotes);
    setEditingNotesIndex(null);
  }, [selectedEvent]);

  const fetchCalendarData = async (fbUser: FirebaseUser) => {
    try {
      setFirebaseUser(fbUser);
      const user = await getUserClient(fbUser.uid);

      let userProgram: Program | null = null;
      if (user?.programId && user.startDate) {
        userProgram = user.customProgram
          ? ({ id: user.programId, workouts: user.customProgram } as Program)
          : await getProgramClient(user.programId);
      }
      setProgram(userProgram);

      // Same reasoning as the schedule view: a sessions failure must not stop the
      // month grid rendering the assigned program.
      let sessions: WorkoutSession[] = [];
      try {
        // Bounded rather than date-ranged: generateWorkoutEvents has an orphan
        // pass that surfaces any session NOT covered by the programme window
        // (manual logs from before the plan started, for instance), so a date
        // range would silently drop those. The cap narrows that to the most
        // recent 400 sessions — over a year of daily training — instead of the
        // entire history on every visit.
        sessions = await getRecentUserSessions(fbUser.uid);
      } catch (error) {
        logger.error('Failed to load workout sessions for the month view:', error);
      }
      generateWorkoutEvents(userProgram, user?.startDate, sessions);
    } catch (error) {
      console.error('Error fetching calendar data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let unsubscribe: () => void = () => {};
    const initialize = async () => {
      const auth = await getAuthInstance();
      unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
          await fetchCalendarData(fbUser);
        } else {
          setLoading(false);
        }
      });
    };
    initialize();
    return () => unsubscribe();
  }, []);

  const getEventColor = (workout: WorkoutDay, isCompleted: boolean, isMissed: boolean): string => {
    if (isCompleted) return 'bg-green-500';
    if (isMissed) return 'bg-red-400';

    const hasR = hasRuns(workout);
    const hasE = hasExercises(workout);

    if (hasR && hasE) return 'bg-teal-500';

    if (hasR) {
      const primaryRunType = (workout as RunningWorkout).runs[0]?.type;
      switch (primaryRunType) {
        case 'intervals': return 'bg-orange-500';
        case 'tempo': return 'bg-yellow-500';
        case 'long': return 'bg-blue-600';
        case 'easy':
        case 'recovery': return 'bg-blue-400';
        default: return 'bg-blue-500';
      }
    }

    if (hasE) {
      const firstSessionType = (workout as Workout).exercises[0]?.sessionType;
      if (firstSessionType === 'cardio') return 'bg-pink-500';
      return 'bg-purple-500';
    }

    return 'bg-gray-400';
  };

  const generateWorkoutEvents = (program: Program | null, startDate: Date | undefined, sessions: WorkoutSession[]) => {
    const events: MonthWorkoutEvent[] = [];

    const sessionsByDate = new Map<string, WorkoutSession[]>();
    sessions.forEach(session => {
      let sessionDate: Date;
      const dateSource = session.finishedAt || session.workoutDate;

      if (dateSource instanceof Date) {
        sessionDate = new Date(dateSource);
      } else if (typeof dateSource === 'string') {
        sessionDate = parseISO(dateSource);
      } else {
        sessionDate = parseISO(String(dateSource));
      }

      if (isValid(sessionDate)) {
        const dateKey = format(startOfDay(sessionDate), 'yyyy-MM-dd');
        const list = sessionsByDate.get(dateKey) ?? [];
        list.push(session);
        sessionsByDate.set(dateKey, list);
      }
    });
    sessionsByDate.forEach(list => list.sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0)));

    if (program && startDate) {
      const normalizedStartDate = startOfDay(new Date(startDate));
      const programDuration = Math.max(...program.workouts.map(w => w.day), 0);

      for (let i = 0; i < programDuration + 365; i++) {
        const currentDate = addDays(normalizedStartDate, i);
        const dateKey = format(currentDate, 'yyyy-MM-dd');
        const { sessions: programmedSessions } = getWorkoutForDay(program, normalizedStartDate, currentDate);
        const daySessions = sessionsByDate.get(dateKey);

        const basePlanned = programmedSessions.length > 0
          ? programmedSessions
          : (daySessions?.[0]?.workoutDetails ? [daySessions[0].workoutDetails] : []);
        const workouts: WorkoutDay[] = basePlanned.map((planned, idx) => daySessions?.[idx]?.workoutDetails ?? planned);

        // A day can carry more persisted sessions than the program schedules
        // (e.g. an extra workout logged outside the plan) — append those so
        // they're not silently dropped from the calendar.
        if (daySessions && daySessions.length > workouts.length) {
          for (let idx = workouts.length; idx < daySessions.length; idx++) {
            const extra = daySessions[idx]?.workoutDetails;
            if (extra) workouts.push(extra);
          }
        }

        if (workouts.length > 0) {
          const isRestDay = workouts[0].title.toLowerCase().includes('rest') || workouts[0].title.toLowerCase().includes('recover');
          const anyCompleted = !!daySessions?.some(s => s.finishedAt && !s.skipped);
          const anySkipped = !!daySessions?.some(s => s.skipped);
          const isPastDate = isPast(currentDate) && !isToday(currentDate);
          const isMissed = !anyCompleted && !anySkipped && isPastDate && !isRestDay;

          events.push({
            date: currentDate,
            workouts,
            sessions: workouts.map((_, idx) => daySessions?.[idx]),
            isCompleted: anyCompleted,
            isMissed,
            isRestDay,
          });

          if (daySessions) {
            sessionsByDate.delete(dateKey);
          }
        }
      }
    }

    sessionsByDate.forEach((daySessions, dateKey) => {
      const withDetails = daySessions.filter(s => s.workoutDetails);
      if (withDetails.length === 0) return;

      const workouts = withDetails.map(s => s.workoutDetails as WorkoutDay);
      const isRestDay = workouts[0].title.toLowerCase().includes('rest') || workouts[0].title.toLowerCase().includes('recover');
      const eventDate = parseISO(`${dateKey}T12:00:00.000Z`);
      const anyCompleted = withDetails.some(s => s.finishedAt && !s.skipped);
      events.push({
        date: eventDate,
        workouts,
        sessions: withDetails,
        isCompleted: anyCompleted,
        isMissed: false,
        isRestDay,
      });
    });

    setWorkoutEvents(events);
  };

  const handleNotesChange = (index: number, value: string) => {
    setNotesByIndex(prev => ({ ...prev, [index]: value }));
    debouncedSaveNotes(index, value);
  };

  const debouncedSaveNotes = useDebouncedCallback(async (index: number, value: string) => {
    const session = selectedEvent?.sessions[index];
    if (!session) return;
    try {
      await updateWorkoutSession(session.id, { notes: value });
    } catch (error) {
      console.error('Failed to save notes:', error);
      toast({ title: 'Error', description: 'Could not save your notes.', variant: 'destructive' });
    }
  }, 1000);

  const handleSaveNotes = () => {
    // No index needed: editingNotesIndex is a single nullable value, so only
    // one row is ever in edit mode, and flush() always targets that row's
    // pending debounced call.
    debouncedSaveNotes.flush();
    setEditingNotesIndex(null);
    toast({ title: 'Notes Saved', description: 'Your workout notes have been updated.' });
  };

  const handleDoToday = async () => {
    const selectedWorkout = selectedEvent?.workouts[0];
    if (!firebaseUser || !selectedWorkout || !selectedDate || !program) {
      toast({ title: 'Error', description: 'Cannot swap workout. User or workout data is missing.', variant: 'destructive' });
      return;
    }

    try {
      const today = startOfDay(new Date());
      const sourceDate = startOfDay(selectedDate);
      const todaysOriginalWorkout = todaysEvent?.workouts[0] || null;

      await swapWorkouts({
        programId: program.id,
        date1: today,
        workout1: selectedWorkout,
        date2: sourceDate,
        workout2: todaysOriginalWorkout,
      });

      toast({ title: 'Workouts Swapped!', description: `"${selectedWorkout.title}" is now scheduled for today.` });
      router.push('/workout/active');
    } catch (error) {
      console.error('Failed to swap workouts:', error);
      toast({ title: 'Error', description: 'Could not swap the workouts. Please try again.', variant: 'destructive' });
    }
  };

  const getCompletedExercises = (workout: WorkoutDay | undefined): { name: string, details: string }[] => {
    if (!workout) return [];
    const runs = hasRuns(workout) ? workout.runs.map(r => ({
      name: r.description || r.type,
      details: `${r.distance}km – ${r.type}`,
    })) : [];
    const exercises = (workout.exercises ?? []).map((e: any) => ({
      name: e.name,
      details: e.details || 'Completed',
    }));
    return [...runs, ...exercises];
  };

  const formatSessionDate = (session: WorkoutSession): string => {
    if (!session.finishedAt) return 'Unknown date';
    try {
      let finishedDate: Date;
      if (session.finishedAt instanceof Date) {
        finishedDate = session.finishedAt;
      } else if (typeof session.finishedAt === 'string') {
        finishedDate = parseISO(session.finishedAt);
      } else if (session.finishedAt && typeof (session.finishedAt as any).toDate === 'function') {
        finishedDate = (session.finishedAt as any).toDate();
      } else {
        return 'Invalid date';
      }
      return format(finishedDate, "MMMM do, yyyy 'at' h:mm a");
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  };

  const handleLinkSuccess = async () => {
    setIsLinkerOpen(false);
    setSessionToLink(null);
    setLoading(true);
    const auth = await getAuthInstance();
    if (auth.currentUser) {
      await fetchCalendarData(auth.currentUser);
    }
    setLoading(false);
  };

  const handleFixComplete = async () => {
    setIsFixOpen(false);
    setSessionToFix(null);
    setLoading(true);
    const auth = await getAuthInstance();
    if (auth.currentUser) {
      await fetchCalendarData(auth.currentUser);
    }
    setLoading(false);
  };

  const handleMarkDone = async (index: number) => {
    const workout = selectedEvent?.workouts[index];
    if (!workout || !selectedDate || !firebaseUser || !selectedEvent) return;
    setMarkingDoneIndex(index);
    try {
      const dayStart = startOfDay(selectedDate);
      const programId = program?.id || 'manual';

      const session = await getOrCreateWorkoutSession(
        firebaseUser.uid, programId, dayStart, workout, false, undefined, index, selectedEvent.workouts.length
      );

      const completedAt = new Date(selectedDate);
      completedAt.setHours(12, 0, 0, 0);

      await updateWorkoutSession(session.id, {
        finishedAt: completedAt,
        workoutTitle: workout.title,
        skipped: false,
      });

      trackEvent(firebaseUser.uid, 'workout_completed', { source: 'calendar', title: workout.title });
      toast({ title: 'Marked as Completed', description: `${workout.title} logged.` });
      await fetchCalendarData(firebaseUser);
    } catch (error) {
      console.error('Failed to mark workout done:', error);
      toast({ title: 'Error', description: 'Could not mark workout as completed.', variant: 'destructive' });
    } finally {
      setMarkingDoneIndex(null);
    }
  };

  const handleOpenLinker = async (index: number) => {
    if (!selectedEvent || !selectedDate || !firebaseUser) return;
    const existing = selectedEvent.sessions[index];
    if (existing) {
      setSessionToLink(existing);
      setIsLinkerOpen(true);
      return;
    }
    try {
      const dayStart = startOfDay(selectedDate);
      const programId = program?.id || 'manual';
      const session = await getOrCreateWorkoutSession(
        firebaseUser.uid, programId, dayStart, selectedEvent.workouts[index], false, undefined, index, selectedEvent.workouts.length
      );
      setSessionToLink(session);
      setIsLinkerOpen(true);
    } catch (error) {
      console.error('Failed to prepare session for Strava link:', error);
      toast({ title: 'Error', description: 'Could not start linking. Please try again.', variant: 'destructive' });
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatDistance = (meters: number) => {
    if (!meters) return '0 km';
    const km = meters / 1000;
    return km >= 1 ? `${km.toFixed(1)} km` : `${meters.toFixed(0)} m`;
  };

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardContent className="p-2 md:p-6 flex justify-center">
            {loading ? (
              <div className="space-y-4 w-full max-w-md">
                <Skeleton className="h-[300px] w-full" />
              </div>
            ) : (
              <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
                <MonthCalendarWidget
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md"
                  components={{
                    DayContent: ({ date }) => {
                      const event = workoutEvents.find(e => isSameDay(e.date, date));
                      if (event && !event.isRestDay) {
                        return (
                          <div className="relative h-full w-full flex items-center justify-center">
                            <span className="relative z-10">{date.getDate()}</span>
                            <div className="absolute bottom-1 flex items-center gap-0.5">
                              {event.workouts.map((workout, i) => {
                                const session = event.sessions[i];
                                const isCompleted = !!session?.finishedAt && !session?.skipped;
                                const dotColor = getEventColor(workout, isCompleted, event.isMissed && !isCompleted);
                                return <div key={i} className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />;
                              })}
                            </div>
                          </div>
                        );
                      }
                      return <span>{date.getDate()}</span>;
                    },
                  }}
                />
              </Suspense>
            )}
            <div className="flex flex-wrap justify-center gap-4 pt-2 pb-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" /> Completed</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-400 inline-block" /> Missed</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-400 inline-block" /> Easy / Recovery Run</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500 inline-block" /> Tempo Run</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500 inline-block" /> Intervals</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600 inline-block" /> Long Run</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-purple-500 inline-block" /> Strength</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-pink-500 inline-block" /> Conditioning</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-500 inline-block" /> Hybrid</span>
            </div>
          </CardContent>
        </Card>

        {selectedEvent && selectedDate && (
          <Card>
            <CardHeader>
              <p className="text-sm font-medium text-accent-foreground">
                {format(selectedDate, "EEEE, MMMM do")}
              </p>
              {selectedEvent.workouts.length > 1 && (
                <CardDescription>{selectedEvent.workouts.length} sessions scheduled today</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {selectedEvent.workouts.map((workout, index) => {
                const session = selectedEvent.sessions[index];
                const isCompleted = !!session?.finishedAt && !session?.skipped;
                const isPastOrToday = isToday(selectedDate) || isPast(selectedDate);
                const isUnfinished = !!session && !session.finishedAt && !session.skipped;
                const isNotDone = !session || isUnfinished;
                const showMarkDone = isPastOrToday && isNotDone && !selectedEvent.isRestDay;
                const showDoToday = index === 0 && selectedEvent.workouts.length === 1 && !isToday(selectedDate) && !session && !!program
                  && (!todaysEvent || todaysEvent.workouts.length <= 1);
                const showLinkStrava = !session || (!session.stravaId && !session.skipped);
                // Retrospective treadmill fix: linked run sessions only (the
                // session's own details, or the planned day, must contain runs).
                const showFixTreadmill =
                  !!session?.stravaId && !session.skipped && (canFixTreadmill(session) || hasRuns(workout));
                const isEditingNotes = editingNotesIndex === index;

                return (
                  <div key={index} className={index > 0 ? 'pt-6 border-t' : ''}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {selectedEvent.workouts.length > 1 && (
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Session {index + 1} of {selectedEvent.workouts.length}</p>
                        )}
                        <CardTitle className="text-lg">
                          {session?.stravaActivity?.name || workout.title}
                        </CardTitle>
                      </div>
                      {isCompleted ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800 shrink-0">Completed</Badge>
                      ) : session?.skipped ? (
                        <Badge variant="outline" className="bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 shrink-0">Skipped</Badge>
                      ) : selectedEvent.isMissed ? (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 shrink-0">Missed</Badge>
                      ) : (() => {
                        const hasR = hasRuns(workout);
                        const hasE = hasExercises(workout);
                        if (hasR && hasE) return <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 shrink-0">Hybrid</Badge>;
                        if (hasR) {
                          const t = (workout as RunningWorkout).runs[0]?.type;
                          if (t === 'intervals') return <Badge variant="outline" className="bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 shrink-0">Intervals</Badge>;
                          if (t === 'tempo') return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800 shrink-0">Tempo Run</Badge>;
                          if (t === 'long') return <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 shrink-0">Long Run</Badge>;
                          return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 shrink-0">Easy Run</Badge>;
                        }
                        const firstSessionType = hasE ? (workout as Workout).exercises[0]?.sessionType : undefined;
                        if (firstSessionType === 'cardio') return <Badge variant="outline" className="bg-pink-50 text-pink-700 border-pink-200 shrink-0">Conditioning</Badge>;
                        return <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shrink-0">Strength</Badge>;
                      })()}
                    </div>

                    {isCompleted && (
                      <p className="text-xs text-muted-foreground mt-1">{formatSessionDate(session!)}</p>
                    )}

                    <div className="mt-3">
                      {session?.stravaActivity ? (
                        <div className="flex items-center justify-around p-4 border rounded-lg bg-muted/50">
                          <div className="text-center">
                            <div className="text-2xl font-bold">{formatDistance(session.stravaActivity.distance || 0)}</div>
                            <div className="text-xs text-muted-foreground">DISTANCE</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold">{formatDuration(session.stravaActivity.moving_time || 0)}</div>
                            <div className="text-xs text-muted-foreground">TIME</div>
                          </div>
                        </div>
                      ) : session?.finishedAt ? (
                        <div>
                          <h4 className="font-semibold mb-2 text-sm">Completed Items</h4>
                          {getCompletedExercises(session.workoutDetails ?? workout).length > 0 ? (
                            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                              {getCompletedExercises(session.workoutDetails ?? workout).map((exercise, i) => (
                                <li key={i}>
                                  <span className="font-medium text-foreground">{exercise.name}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">No completed items details available for this session.</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <h4 className="font-semibold mb-2 text-sm">Planned Workout</h4>
                          <div className="space-y-3">
                            {hasRuns(workout) && workout.runs.map((run, i) => (
                              <div key={i} className="space-y-1">
                                <p className="text-sm font-medium text-foreground">{formatPlannedRun(run)}</p>
                              </div>
                            ))}
                            {hasExercises(workout) && (workout.exercises ?? []).map((exercise, i) => {
                              const formattedDetails = formatTextWithBullets(exercise.details);
                              return (
                                <div key={i} className="space-y-1">
                                  <p className="text-sm font-medium text-foreground">{exercise.name}</p>
                                  {formattedDetails.map((line, lineIndex) => (
                                    <p key={lineIndex} className="text-xs text-muted-foreground whitespace-pre-wrap ml-4">
                                      {line}
                                    </p>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {session && (
                      <div className="mt-4 pt-4 border-t">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-semibold text-sm">Your Notes</h4>
                          {!isEditingNotes && (
                            <Button variant="ghost" size="sm" onClick={() => setEditingNotesIndex(index)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </Button>
                          )}
                        </div>
                        {isEditingNotes ? (
                          <div className="space-y-2">
                            <Textarea
                              value={notesByIndex[index] ?? ''}
                              onChange={(e) => handleNotesChange(index, e.target.value)}
                              placeholder="Add notes about your workout..."
                              rows={3}
                            />
                            <Button size="sm" onClick={handleSaveNotes}>Save Notes</Button>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground border-l-2 pl-4 italic min-h-[32px]">
                            {notesByIndex[index] || 'No notes for this workout.'}
                          </p>
                        )}
                      </div>
                    )}

                    {(showMarkDone || showDoToday || showLinkStrava || showFixTreadmill) && (
                      <div className="pt-4 mt-4 border-t flex flex-col gap-2">
                        {showMarkDone && (
                          <Button
                            variant="default"
                            className="w-full"
                            onClick={() => handleMarkDone(index)}
                            disabled={markingDoneIndex === index}
                          >
                            {markingDoneIndex === index
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              : <CheckCircle className="mr-2 h-4 w-4" />
                            }
                            Mark as Completed
                          </Button>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                          {showDoToday && (
                            <Button
                              variant="accent"
                              className="w-full"
                              onClick={handleDoToday}
                            >
                              <Forward className="mr-2 h-4 w-4" />
                              Do This Workout Today
                            </Button>
                          )}
                          {showLinkStrava && (
                            <Button
                              variant="outline"
                              size={session ? 'sm' : 'default'}
                              className="w-full"
                              onClick={() => handleOpenLinker(index)}
                            >
                              <LinkIcon className="mr-2 h-4 w-4" />
                              Link Strava Activity
                            </Button>
                          )}
                          {showFixTreadmill && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => {
                                setSessionToFix(session!);
                                setIsFixOpen(true);
                              }}
                            >
                              <Wrench className="mr-2 h-4 w-4" />
                              Fix Treadmill File
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {workoutEvents.length === 0 && !loading && (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-muted-foreground">
                No workout data found. Complete some workouts or start a program to see them here.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      {sessionToLink && (
        <Suspense fallback={null}>
          <LinkStravaActivityDialog
            isOpen={isLinkerOpen}
            setIsOpen={setIsLinkerOpen}
            session={sessionToLink}
            onLinkSuccess={handleLinkSuccess}
          />
        </Suspense>
      )}
      {sessionToFix && (
        <Suspense fallback={null}>
          <FixTreadmillDialog
            isOpen={isFixOpen}
            setIsOpen={(open) => {
              setIsFixOpen(open);
              if (!open) setSessionToFix(null);
            }}
            session={sessionToFix}
            onComplete={handleFixComplete}
          />
        </Suspense>
      )}
    </>
  );
}

function WeekSection({ week, program, programStartDate, unitSystem, changedKeys, onResetWeek, onOpenDetail, onMarkDone, markingDoneKey }: {
  week: DaySlot[];
  program: Program;
  programStartDate: Date | null;
  unitSystem?: UnitSystem;
  changedKeys: Set<string>;
  onResetWeek: (keys: string[]) => void;
  onOpenDetail: (workout: WorkoutDay) => void;
  onMarkDone: (dateKey: string, index: number, workout: WorkoutDay) => void;
  markingDoneKey: string | null;
}) {
  const range = `${format(week[0].date, 'd MMM')} - ${format(week[week.length - 1].date, 'd MMM')}`;
  const dayInfo = programStartDate ? getWorkoutForDay(program, programStartDate, week[0].date) : null;
  const weekNumber = dayInfo && dayInfo.day >= 1 ? Math.ceil(dayInfo.day / 7) : undefined;
  const weekWorkouts = week.flatMap(d => d.workouts).filter(w => !isRestDayWorkout(w));
  const totalRunKm = weekWorkouts.filter(hasRuns).reduce((sum, w) => sum + (w as RunningWorkout).runs.reduce((s, r) => s + (r.distance || 0), 0), 0);
  const weekKeys = week.map(d => d.dateKey);
  const hasWeekChanges = weekKeys.some(k => changedKeys.has(k));

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
        <div>
          <p className="font-bold flex items-center gap-2">
            {range}
            {weekNumber !== undefined && <Badge variant="secondary">Week {weekNumber}</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">
            {weekWorkouts.length} session{weekWorkouts.length === 1 ? '' : 's'}
            {totalRunKm > 0 ? ` • ${convertDistance(totalRunKm, unitSystem ?? 'metric')} running` : ''}
          </p>
        </div>
        {hasWeekChanges && (
          <Button variant="ghost" size="sm" onClick={() => onResetWeek(weekKeys)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
        )}
      </div>
      <div className="divide-y">
        {week.map(day => (
          <DayRow key={day.dateKey} day={day} unitSystem={unitSystem} onOpenDetail={onOpenDetail} onMarkDone={onMarkDone} markingDoneKey={markingDoneKey} />
        ))}
      </div>
    </div>
  );
}

function DayRow({ day, unitSystem, onOpenDetail, onMarkDone, markingDoneKey }: {
  day: DaySlot;
  unitSystem?: UnitSystem;
  onOpenDetail: (workout: WorkoutDay) => void;
  onMarkDone: (dateKey: string, index: number, workout: WorkoutDay) => void;
  markingDoneKey: string | null;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: day.dateKey,
    disabled: day.isPast,
  });

  return (
    <div
      ref={setDropRef}
      className={cn(
        'flex items-start gap-3 px-4 py-3 bg-card transition-colors',
        isOver && !day.isPast && 'bg-green-100 dark:bg-green-950/40 ring-2 ring-green-500 ring-inset',
        day.isToday && 'bg-accent/10'
      )}
    >
      <div className="w-11 shrink-0 text-center pt-1.5">
        <p className={cn('text-[10px] font-semibold uppercase', day.isToday ? 'text-primary' : 'text-muted-foreground')}>
          {format(day.date, 'EEE')}
        </p>
        <p className="text-sm font-bold">{format(day.date, 'd')}</p>
      </div>

      <div className="flex-1 space-y-2 min-h-[2.5rem] flex flex-col justify-center">
        {day.workouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Rest</p>
        ) : (
          day.workouts.map((workout, idx) => (
            <WorkoutCard
              key={idx}
              dateKey={day.dateKey}
              index={idx}
              workout={workout}
              unitSystem={unitSystem}
              isToday={day.isToday}
              isPast={day.isPast}
              finishedSession={day.sessions.find(s => (s.sessionIndex ?? 0) === idx)}
              onOpenDetail={() => onOpenDetail(workout)}
              onMarkDone={() => onMarkDone(day.dateKey, idx, workout)}
              isMarkingDone={markingDoneKey === `${day.dateKey}::${idx}`}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorkoutCard({ dateKey, index, workout, unitSystem, isToday, isPast, finishedSession, onOpenDetail, onMarkDone, isMarkingDone }: {
  dateKey: string;
  index: number;
  workout: WorkoutDay;
  unitSystem?: UnitSystem;
  isToday: boolean;
  isPast: boolean;
  finishedSession?: WorkoutSession;
  onOpenDetail: () => void;
  onMarkDone: () => void;
  isMarkingDone: boolean;
}) {
  const isRest = isRestDayWorkout(workout);
  const isDone = !!finishedSession?.finishedAt && !finishedSession.skipped;
  const isSkipped = !!finishedSession?.skipped;
  const isLocked = !!finishedSession?.finishedAt;
  const isDraggable = !isPast && !isLocked && !isRest;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${dateKey}::${index}`,
    disabled: !isDraggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      onClick={onOpenDetail}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border-l-4 bg-muted/60 px-3 py-2 cursor-pointer',
        workoutAccentClass(workout),
        isDraggable && 'cursor-grab active:cursor-grabbing touch-none',
        isDragging && 'opacity-30'
      )}
    >
      <div className="min-w-0">
        <p className="font-semibold text-sm truncate">{workout.title}</p>
        {!isRest && <p className="text-xs text-muted-foreground">{summarizeWorkout(workout, unitSystem)}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        {isDone && (
          <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/50">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Done
          </Badge>
        )}
        {isSkipped && (
          <Badge variant="outline" className="bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/50">
            <XCircle className="h-3 w-3 mr-1" />
            Skipped
          </Badge>
        )}
        {isToday && !isLocked && !isRest && (
          <Button variant="secondary" size="sm" asChild>
            <Link href="/workout/active">Start</Link>
          </Button>
        )}
        {isPast && !isLocked && !isRest && (
          <Button variant="outline" size="sm" onClick={onMarkDone} disabled={isMarkingDone}>
            {isMarkingDone ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          </Button>
        )}
        {isDraggable && <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />}
      </div>
    </div>
  );
}

function WorkoutDetailDialog({ workout, unitSystem, onClose }: { workout: WorkoutDay | null; unitSystem?: UnitSystem; onClose: () => void }) {
  return (
    <Dialog open={!!workout} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {workout && (
          <>
            <DialogHeader>
              <DialogTitle>{workout.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {hasRuns(workout) ? (
                workout.runs.map((run, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-3">
                    <p className="font-medium text-sm">{formatPlannedRun(run)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {convertDistance(run.distance, unitSystem ?? 'metric')} · {run.paceZone} pace
                    </p>
                  </div>
                ))
              ) : null}
              {hasExercises(workout) ? (
                workout.exercises.map((ex, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-3">
                    <p className="font-medium text-sm">{ex.name}</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">
                      {unitSystem ? convertTextWithUnits(ex.details, unitSystem) : ex.details}
                    </p>
                  </div>
                ))
              ) : null}
              {!hasRuns(workout) && !hasExercises(workout) && (
                <p className="text-sm text-muted-foreground">Rest day — nothing scheduled.</p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Page: title + view toggle ─────────────────────────────────────────────

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<'schedule' | 'month'>('schedule');
  const { user, program, allSessions, sessionsLoaded, refreshData } = useUser();
  // Bumped after the plan moves in time, so the views reload their dates.
  const [reloadKey, setReloadKey] = useState(0);
  const handlePlanMoved = async () => {
    await refreshData();
    setReloadKey(k => k + 1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Training Calendar</h1>
          <p className="text-muted-foreground">
            {viewMode === 'schedule'
              ? 'Rearrange your upcoming week, or switch to the month view for an overview.'
              : 'Visualize your active program and track your progress.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user && <PausePlanButton user={user} onChanged={handlePlanMoved} />}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'schedule' | 'month')}>
            <TabsList>
              <TabsTrigger value="schedule" className="gap-1.5"><ListChecks className="h-4 w-4" />Schedule</TabsTrigger>
              <TabsTrigger value="month" className="gap-1.5"><CalendarDays className="h-4 w-4" />Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {user && (
        <PlanCatchUpCard
          user={user}
          program={program}
          allSessions={allSessions}
          sessionsLoaded={sessionsLoaded}
          onChanged={handlePlanMoved}
        />
      )}

      {viewMode === 'schedule' ? <WeeklyScheduleView key={reloadKey} /> : <MonthGridCalendarView key={reloadKey} />}
    </div>
  );
}
