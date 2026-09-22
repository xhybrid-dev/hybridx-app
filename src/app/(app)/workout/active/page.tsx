'use client';

import { useEffect, useState, lazy, Suspense, useCallback, useMemo } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { Flag, Loader2, CalendarDays, AlertTriangle, Timer, X, Share2, Sparkles, Clock, Link as LinkIcon, CheckSquare, Square, WifiOff } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';

import { workoutSummary } from '@/ai/flows/workout-summary';
import { extendWorkout } from '@/ai/flows/extend-workout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { updateWorkoutSession, type WorkoutSession } from '@/services/session-service-client';
import type { User, Workout, RunningWorkout, Exercise, PlannedRun, TimerRecord, WorkoutDay, SkipReason } from '@/models/types';
import { formatPace } from '@/lib/pace-utils';
import { formatPlannedRun, getWorkoutForDay } from '@/lib/workout-utils';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { LinkStravaActivityDialog } from '@/components/link-strava-activity-dialog';
import { useUser } from '@/contexts/user-context';
import { useToast } from '@/hooks/use-toast';
import { hasRuns, hasExercises } from '@/lib/type-guards';
import { ExerciseHistory } from '@/components/exercise-history';
import { convertDistanceInText, convertTextWithUnits } from '@/lib/unit-conversion';
import { WorkoutTimer } from '@/components/workout-timer';
import { WorkoutSkipDialog } from '@/components/workout-skip-dialog';
import { trackEvent } from '@/lib/analytics';

const WorkoutCompleteModal = lazy(() => import('@/components/workout-complete-modal'));
const CustomWorkoutDialog = lazy(() => import('@/components/custom-workout-dialog').then(mod => ({ default: mod.CustomWorkoutDialog })));

export default function ActiveWorkoutPage() {
  const { user, todaysWorkout, todaysWorkoutSessions, trainingPaces, loading, refreshData } = useUser();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const daySessions: WorkoutDay[] = todaysWorkout?.sessions && todaysWorkout.sessions.length > 0
    ? todaysWorkout.sessions
    : (todaysWorkout?.workout ? [todaysWorkout.workout] : []);

  if (daySessions.length === 0 || todaysWorkoutSessions.length === 0) {
    return <NoWorkoutToday />;
  }

  const isMultiSession = daySessions.length > 1;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-400 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>You&apos;re offline — your progress is saved locally and will sync when reconnected.</span>
        </div>
      )}
      {daySessions.map((planned, index) => {
        const persisted = todaysWorkoutSessions[index] ?? todaysWorkoutSessions[0];
        if (!persisted) return null;
        return (
          <WorkoutSessionCard
            key={persisted.id}
            planned={planned}
            initialSession={persisted}
            day={todaysWorkout?.day ?? 0}
            isMultiSession={isMultiSession}
            sessionNumber={index + 1}
            sessionTotal={daySessions.length}
            user={user}
            trainingPaces={trainingPaces}
            refreshData={refreshData}
          />
        );
      })}
    </div>
  );
}

/** The centre "Workout" button on a day with nothing scheduled: somewhere useful to go, not a dead end. */
function NoWorkoutToday() {
  const { user, program, refreshData } = useUser();
  const [isLogOpen, setIsLogOpen] = useState(false);
  const paused = !!user?.planPausedAt;

  const title = paused ? 'Your plan is paused' : program ? 'Rest day' : 'No plan yet';
  const description = paused
    ? 'Nothing is due while you are away. Resume from the dashboard whenever you are ready.'
    : program
      ? 'Recovery is when the training lands. If you did something anyway, log it — it all counts.'
      : 'Pick a plan and a session will be waiting here every training day.';

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {program ? (
            <Button asChild variant="outline"><Link href="/calendar"><CalendarDays className="mr-2 h-4 w-4" />See this week</Link></Button>
          ) : (
            <Button asChild><Link href="/programs">Choose a program</Link></Button>
          )}
          <Button variant="outline" onClick={() => setIsLogOpen(true)} disabled={!user}>
            <Flag className="mr-2 h-4 w-4" />Log an activity
          </Button>
          <Button asChild variant="outline">
            <Link href={`/assistant?q=${encodeURIComponent("It's a rest day — what should I do to recover well?")}`}>
              <Sparkles className="mr-2 h-4 w-4" />Ask your coach
            </Link>
          </Button>
        </CardContent>
      </Card>
      {user && (
        <Suspense fallback={null}>
          <CustomWorkoutDialog isOpen={isLogOpen} setIsOpen={setIsLogOpen} userId={user.id} onLogged={refreshData} />
        </Suspense>
      )}
    </div>
  );
}

interface WorkoutSessionCardProps {
  planned: WorkoutDay;
  initialSession: WorkoutSession;
  day: number;
  isMultiSession: boolean;
  sessionNumber: number;
  sessionTotal: number;
  user: User | null;
  trainingPaces: Record<string, number> | null;
  refreshData: () => Promise<void>;
}

function WorkoutSessionCard({ planned, initialSession, day, isMultiSession, sessionNumber, sessionTotal, user, trainingPaces, refreshData }: WorkoutSessionCardProps) {
  const { toast } = useToast();
  const [session, setSession] = useState<WorkoutSession>(initialSession);
  const [extendedExercises, setExtendedExercises] = useState<Exercise[]>(initialSession.extendedExercises || []);
  const [isExtending, setIsExtending] = useState(false);
  const [notes, setNotes] = useState(initialSession.notes || '');
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [isSkipOpen, setIsSkipOpen] = useState(false);
  const { program, streakData } = useUser();
  const weekProgress = { done: streakData.thisWeekWorkouts, target: streakData.weeklyTarget };
  const nextSession = useMemo(() => {
    if (!program || !user?.startDate || user.planPausedAt) return null;
    const today = startOfDay(new Date());
    for (let offset = 1; offset <= 7; offset++) {
      const date = addDays(today, offset);
      const next = getWorkoutForDay(program, user.startDate, date).sessions[0];
      if (next) return { title: next.title, date };
    }
    return null;
  }, [program, user?.startDate, user?.planPausedAt]);
  const [isLinkerOpen, setIsLinkerOpen] = useState(false);
  const [exerciseChecklist, setExerciseChecklist] = useState<Record<string, boolean>>(initialSession.exerciseChecklist || {});
  const [showTimer, setShowTimer] = useState(false);

  useEffect(() => {
    setSession(initialSession);
    setNotes(initialSession.notes || '');
    setExerciseChecklist(initialSession.exerciseChecklist || {});
    if (!['one-off-ai', 'custom-workout'].includes(initialSession.programId)) {
      setExtendedExercises(initialSession.extendedExercises || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession.id]);

  const week = day > 0 ? Math.ceil(day / 7) : 0;
  const dayOfWeek = day > 0 ? (day % 7 === 0 ? 7 : day % 7) : 0;
  const isRunning = hasRuns(planned);
  const isHybrid = hasRuns(planned) && hasExercises(planned);
  const isOneOffWorkout = ['one-off-ai', 'custom-workout'].includes(session.programId);
  const canExtendWorkout = planned.programType === 'hyrox' || isHybrid || isOneOffWorkout;

  const loadWorkoutSummary = useCallback(async () => {
    if (!user || summaryText || summaryLoading) return;
    setSummaryLoading(true);
    try {
      const exercisesForSummary = [
        ...(hasRuns(planned) ? (planned as RunningWorkout).runs.map(r => r.type) : []),
        ...(hasExercises(planned) ? [...(planned as Workout).exercises, ...extendedExercises].map(e => e.name) : []),
      ].join(', ');
      const summaryPromise = workoutSummary({ userName: user.firstName, workoutTitle: planned.title, exercises: exercisesForSummary });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI summary timeout')), 15000));
      const summaryResult = await Promise.race([summaryPromise, timeoutPromise]) as any;
      setSummaryText(summaryResult.summary);
    } catch (error) {
      console.error('Failed to generate AI workout summary:', error);
      setSummaryText(planned.title);
    } finally {
      setSummaryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, planned, extendedExercises, summaryText, summaryLoading]);

  // The first time the athlete opens an unfinished session is when it really
  // started: the doc itself is created whenever the dashboard first loads that
  // day, which made the derived duration hours long.
  useEffect(() => {
    if (!user || initialSession.finishedAt || initialSession.startedInApp) return;
    const startedAt = new Date();
    setSession(prev => ({ ...prev, startedAt, startedInApp: true }));
    updateWorkoutSession(initialSession.id, { startedAt, startedInApp: true }).catch(err => console.error('Failed to record start:', err));
    trackEvent(user.id, 'workout_started', { sessionId: initialSession.id, title: planned.title, programId: initialSession.programId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, initialSession.id]);

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => { loadWorkoutSummary(); }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, planned]);

  const debouncedSaveNotes = useDebouncedCallback(async (value: string) => {
    await updateWorkoutSession(session.id, { notes: value });
  }, 1500);

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
    debouncedSaveNotes(e.target.value);
  };

  const debouncedSaveChecklist = useDebouncedCallback(async (checklist: Record<string, boolean>) => {
    await updateWorkoutSession(session.id, { exerciseChecklist: checklist });
  }, 800);

  const handleToggleExercise = (key: string) => {
    if (session.finishedAt) return;
    const updated = { ...exerciseChecklist, [key]: !exerciseChecklist[key] };
    setExerciseChecklist(updated);
    debouncedSaveChecklist(updated);
  };

  const handleExtendWorkout = async () => {
    setIsExtending(true);
    try {
      let originalExercises: Exercise[] = [];
      if (hasExercises(planned)) {
        originalExercises = (planned as Workout).exercises || [];
      }
      const result = await extendWorkout({
        workoutTitle: planned.title,
        workoutType: planned.programType,
        exercises: JSON.stringify([...originalExercises, ...extendedExercises]),
      });
      const allExtended = [...extendedExercises, ...result.newExercises];
      setExtendedExercises(allExtended);
      await updateWorkoutSession(session.id, { extendedExercises: allExtended });
    } catch (error) {
      console.error('Failed to extend workout:', error);
      toast({ title: 'Could not extend workout', description: 'AI extension failed. Please try again.', variant: 'destructive' });
    } finally {
      setIsExtending(false);
    }
  };

  const handleFinishWorkout = async () => {
    debouncedSaveNotes.flush();
    const finishedAt = new Date();
    const updatedSessionData = { ...session, finishedAt, notes, workoutTitle: planned.title, programType: planned.programType };
    setSession(updatedSessionData);
    await updateWorkoutSession(session.id, { finishedAt, notes, workoutTitle: planned.title, programType: planned.programType });
    if (user) {
      trackEvent(user.id, 'workout_completed', {
        source: 'active_workout',
        sessionId: session.id,
        title: planned.title,
        itemsChecked: checkedCount,
        itemsTotal: totalCount,
      });
    }
    setIsCompleteModalOpen(true);
    refreshData();
  };

  const handleSkipWorkout = async (skipReason: SkipReason) => {
    debouncedSaveNotes.flush();
    const finishedAt = new Date();
    const skipNotes = notes ? `${notes}\n\n[WORKOUT SKIPPED]` : '[WORKOUT SKIPPED]';
    const update = { finishedAt, notes: skipNotes, workoutTitle: planned.title, programType: planned.programType, skipped: true, skipReason };
    setSession(prev => ({ ...prev, ...update }));
    await updateWorkoutSession(session.id, update);
    if (user) trackEvent(user.id, 'workout_skipped', { sessionId: session.id, title: planned.title, reason: skipReason });
    refreshData();
  };

  const handleLinkSuccess = async () => {
    setIsLinkerOpen(false);
    await refreshData();
    setIsCompleteModalOpen(true);
  };

  const handleTimerComplete = useCallback(async (record: TimerRecord) => {
    await updateWorkoutSession(session.id, { timerRecord: record });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const exerciseKeys: string[] = [
    ...(hasRuns(planned) ? (planned as RunningWorkout).runs.map((_, i) => `run-${i}`) : []),
    ...(hasExercises(planned) ? (planned as Workout).exercises.map((_, i) => `ex-${i}`) : []),
  ].concat(extendedExercises.map((_, i) => `ext-${i}`));

  const checkedCount = exerciseKeys.filter(k => exerciseChecklist[k]).length;
  const totalCount = exerciseKeys.length;
  const progressPct = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  return (
    <>
      <Card className="bg-accent/20 border-accent">
        <CardHeader>
          <div className="flex-1">
            {isMultiSession && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Session {sessionNumber} of {sessionTotal}</p>
            )}
            <CardTitle className="text-2xl font-bold tracking-tight">{planned.title}</CardTitle>
            <CardDescription className="font-medium text-foreground/80">
              {summaryLoading ? (
                <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
              ) : summaryText ? (
                <div className="relative">{summaryText}</div>
              ) : (
                <div className="relative">{planned.title}<span className="text-xs text-muted-foreground/60 ml-2">⏳ Enhancing...</span></div>
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            {!isOneOffWorkout && day > 0 && (
              <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /><span>Week {week}, Day {dayOfWeek}</span></div>
            )}
            {isOneOffWorkout && session.duration && (
              <div className="flex items-center gap-2"><Clock className="h-4 w-4" /><span>{session.duration}</span></div>
            )}
          </div>

          {isRunning && !trainingPaces && (
            <div className="p-4 border border-yellow-400 bg-yellow-50 rounded-md text-yellow-800 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5" />
              <div>
                <h4 className="font-semibold">Paces Not Calculated</h4>
                <p className="text-sm">To see your personalized training paces, please add at least one benchmark race time to your profile.</p>
                <Button variant="link" className="p-0 h-auto mt-1 text-sm text-yellow-800" asChild>
                  <Link href="/profile">Update Your Profile</Link>
                </Button>
              </div>
            </div>
          )}

          <Button variant="secondary" className="w-full" onClick={() => setShowTimer((prev) => !prev)}>
            <Timer className="mr-2" />
            {showTimer ? 'Hide Timer' : 'Use the Timer'}
          </Button>

          {showTimer && (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <WorkoutTimer onComplete={handleTimerComplete} />
            </div>
          )}

          {!session.finishedAt && totalCount > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{checkedCount} / {totalCount} completed</span>
                <span>{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          )}

          <div className="space-y-3">
            {hasRuns(planned) && (
              <>
                {isHybrid && <h4 className="text-sm font-semibold text-muted-foreground">Runs</h4>}
                {(planned as RunningWorkout).runs.map((run: PlannedRun, index) => {
                  const key = `run-${index}`;
                  const isDone = !!exerciseChecklist[key];
                  const rawLabel = formatPlannedRun(run);
                  const description = user?.unitSystem === 'imperial' ? convertDistanceInText(rawLabel, 'imperial') : rawLabel;
                  return (
                    <Card key={`${run.description}-${index}`} className={isDone ? 'opacity-60' : ''}>
                      <CardContent className="py-4 px-2 flex items-center gap-4">
                        {!session.finishedAt && (
                          <button onClick={() => handleToggleExercise(key)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}>
                            {isDone ? <CheckSquare className="h-6 w-6 text-primary" /> : <Square className="h-6 w-6" />}
                          </button>
                        )}
                        <div className="flex-1">
                          <p className={`font-semibold ${isDone ? 'line-through text-muted-foreground' : ''}`}>{description}</p>
                          {trainingPaces && (
                            <p className="text-sm text-muted-foreground">Target Pace: <span className="font-semibold text-primary">{formatPace(trainingPaces[run.paceZone])}</span> / km</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}
            {hasExercises(planned) && (
              <>
                {isHybrid && <h4 className="text-sm font-semibold text-muted-foreground mt-2">Exercises</h4>}
                {(planned as Workout).exercises.map((ex: Exercise, index) => {
                  const key = `ex-${index}`;
                  const isDone = !!exerciseChecklist[key];
                  const details = user?.unitSystem ? convertTextWithUnits(ex.details, user.unitSystem) : ex.details;
                  return (
                    <Card key={`${ex.name}-${index}`} className={isDone ? 'opacity-60' : ''}>
                      <CardContent className="py-4 px-2 flex items-center gap-4">
                        {!session.finishedAt && (
                          <button onClick={() => handleToggleExercise(key)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}>
                            {isDone ? <CheckSquare className="h-6 w-6 text-primary" /> : <Square className="h-6 w-6" />}
                          </button>
                        )}
                        <div className="flex-1">
                          <p className={`font-semibold ${isDone ? 'line-through text-muted-foreground' : ''}`}>{ex.name}</p>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details}</p>
                          {user && <ExerciseHistory userId={user.id} exerciseName={ex.name} />}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}

            {extendedExercises.length > 0 && (
              <><Separator /><h3 className="text-base font-semibold !mt-6">Workout Extension:</h3></>
            )}

            {extendedExercises.map((item, index) => {
              const key = `ext-${index}`;
              const isDone = !!exerciseChecklist[key];
              const details = user?.unitSystem ? convertTextWithUnits(item.details, user.unitSystem) : item.details;
              return (
                <Card key={`${item.name}-${index}`} className={`border-dashed border-primary/50 ${isDone ? 'opacity-60' : ''}`}>
                  <CardContent className="py-4 px-2 flex items-center gap-4">
                    {!session.finishedAt && (
                      <button onClick={() => handleToggleExercise(key)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}>
                        {isDone ? <CheckSquare className="h-6 w-6 text-primary" /> : <Square className="h-6 w-6" />}
                      </button>
                    )}
                    <div className="flex-1">
                      <p className={`font-semibold ${isDone ? 'line-through text-muted-foreground' : ''}`}>{item.name}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details}</p>
                      {user && <ExerciseHistory userId={user.id} exerciseName={item.name} />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {canExtendWorkout && !session.finishedAt && (
            <div className="pt-2">
              <Button variant="outline" className="w-full" onClick={handleExtendWorkout} disabled={isExtending}>
                {isExtending ? <Loader2 className="mr-2 animate-spin" /> : <Sparkles className="mr-2 text-yellow-400" />}
                {isExtending ? 'Generating...' : 'Extend Workout with AI'}
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`workout-notes-${session.id}`} className="text-base font-semibold">Workout Notes</Label>
            <Textarea id={`workout-notes-${session.id}`} placeholder="How did the workout feel? Any PRs? Aches or pains?" value={notes} onChange={handleNotesChange} disabled={!!session.finishedAt} rows={4} />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-4">
            {!session.finishedAt ? (
              <>
                <Button className="w-full" onClick={handleFinishWorkout}><Flag className="mr-2" />Finish{isMultiSession ? ' Session' : ' Workout'}</Button>
                <Button variant="outline" className="w-full" onClick={() => setIsLinkerOpen(true)}><LinkIcon className="mr-2" />Link Strava Activity</Button>
                <Button variant="outline" className="w-full" onClick={() => setIsSkipOpen(true)}><X className="mr-2" />Skip</Button>
              </>
            ) : session.skipped ? (
              <p className="w-full text-center text-sm text-muted-foreground">Skipped — your next session is on the dashboard.</p>
            ) : (
              <Button className="w-full" variant="secondary" onClick={() => setIsCompleteModalOpen(true)}><Share2 className="mr-2" />Share Workout</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {session.finishedAt && !session.skipped && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}>
          <WorkoutCompleteModal
            isOpen={isCompleteModalOpen}
            onClose={() => setIsCompleteModalOpen(false)}
            session={session}
            userHasStrava={!!user?.strava?.accessToken}
            weekProgress={weekProgress}
            nextSession={nextSession}
          />
        </Suspense>
      )}
      <WorkoutSkipDialog open={isSkipOpen} onOpenChange={setIsSkipOpen} workoutTitle={planned.title} onConfirm={handleSkipWorkout} />
      <LinkStravaActivityDialog isOpen={isLinkerOpen} setIsOpen={setIsLinkerOpen} session={session} onLinkSuccess={handleLinkSuccess} />
    </>
  );
}
