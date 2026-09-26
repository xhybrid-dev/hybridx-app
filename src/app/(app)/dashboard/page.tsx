// src/app/(app)/dashboard/page.tsx
'use client';

import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart, Target, Loader2, Route, Zap, PlusSquare, Link as LinkIcon, CheckCircle, History, Calendar, CheckSquare, Sparkles, Trophy, ArrowRight, MessageCircle } from 'lucide-react';
import { subWeeks, startOfWeek, isWithinInterval, isFuture, startOfDay, addDays, isSameDay, format } from 'date-fns';
import { Capacitor } from '@capacitor/core';

import { CoachPanel, useCoachNotes } from '@/components/coach-panel';
import { CoachMarkdown } from '@/components/coach-markdown';
import { dashboardSummary } from '@/ai/flows/dashboard-summary';
import { workoutSummary } from '@/ai/flows/workout-summary';
import { generateWorkout } from '@/ai/flows/generate-workout';
import { generateHyroxStarter } from '@/ai/flows/generate-hyrox-starter';
import { updateUser } from '@/services/user-service-client';
import { CompleteOnboardingDialog } from '@/components/complete-onboarding-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ChartContainer, BarChart as RechartsBarChart, Bar, XAxis, ChartTooltip, CartesianGrid, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { getOrCreateWorkoutSession, getUserSessionsInRange, updateWorkoutSession, type WorkoutSession } from '@/services/session-service-client';
import { saveScheduleChanges } from '@/services/session-service';
import { getWorkoutForDay } from '@/lib/workout-utils';
import { planPostpone } from '@/lib/postpone';
import { trackEvent } from '@/lib/analytics';
import type { WorkoutDay, RunningWorkout, Workout, PlannedRun } from '@/models/types';
import type { StravaActivity } from '@/services/strava-service';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/pace-utils';
import { formatPlannedRun } from '@/lib/workout-utils';
import { useToast } from '@/hooks/use-toast';
import { cancelScheduledReminder, checkAndScheduleNotification, scheduleDailyNotification } from '@/utils/notification-scheduler';
import { useNotificationPermission } from '@/hooks/use-notification-permission';
import { StatsWidget } from '@/components/stats-widget';
import { Badge } from '@/components/ui/badge';
import { useUser } from '@/contexts/user-context';
import { logger } from '@/lib/logger';
import { aiCopyKey, readAiCopy, writeAiCopy } from '@/lib/ai-copy-cache';
import { hasRuns, hasExercises } from '@/lib/type-guards';
import { AndroidBetaBanner } from '@/components/android-beta-banner';
import { TrialBanner } from '@/components/trial-banner';
import { RacePrepDialog } from '@/components/race-prep-dialog';
import { PlanAdjustmentNotice } from '@/components/plan-adjustment-notice';
import { PlanCatchUpCard } from '@/components/plan-catch-up-card';
import { ProgramFinishCard } from '@/components/program-finish-card';
import { programDayFor } from '@/lib/program-day';
import type { StravaLoadError } from '@/components/today-strava-feed';

// Lazy load heavy AI-powered components
// const WeeklyAnalysisDialog = lazy(() => import('@/components/weekly-analysis-dialog').then(mod => ({ default: mod.WeeklyAnalysisDialog })));
const CustomWorkoutDialog = lazy(() => import('@/components/custom-workout-dialog').then(mod => ({ default: mod.CustomWorkoutDialog })));
const TrainingLoadCard = lazy(() => import('@/components/training-load-card').then(mod => ({ default: mod.TrainingLoadCard })));
const TodayStravaFeed = lazy(() => import('@/components/today-strava-feed').then(mod => ({ default: mod.TodayStravaFeed })));

const chartConfig = {
  workouts: {
    label: "Workouts",
    color: "hsl(var(--primary))",
  },
};

export default function DashboardPage() {
  const { user, program, todaysWorkout, todaysSession, todaysWorkoutSessions, allSessions, sessionsLoaded, streakData, trainingPaces, loading, refreshData } = useUser();
  const [progressData, setProgressData] = useState<{ week: string, workouts: number }[]>([]);
  const [todayStravaSummary, setTodayStravaSummary] = useState<string | null>(null);
  const [stravaRecentActivities, setStravaRecentActivities] = useState<StravaActivity[]>([]);
  // True once TodayStravaFeed has resolved (success OR no Strava connection) — gates the AI summary
  const [todayStravaLoaded, setTodayStravaLoaded] = useState(false);
  const [stravaLoadError, setStravaLoadError] = useState<StravaLoadError | null>(null);
  // Prevent the dashboard summary from firing more than once per mount
  const summaryFiredRef = useRef(false);

  // What the coach remembers the athlete has told it. Both AI lines on this
  // page are written with it, so a week off that the athlete already explained
  // doesn't come back at them as a missed week.
  const coachNotes = useCoachNotes(!!user);
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState(false);
  const [isMarkingDone, setIsMarkingDone] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [isCustomWorkoutDialogOpen, setIsCustomWorkoutDialogOpen] = useState(false);
  const [isGeneratingStarterPlan, setIsGeneratingStarterPlan] = useState(false);
  const [showCompleteOnboarding, setShowCompleteOnboarding] = useState(false);
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('profileBannerDismissed') === 'true'
  );
  const starterPlanTriggeredRef = useRef(false);
  const [summary, setSummary] = useState("Here's your plan for today. Let's get it done.");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [workoutSummaryText, setWorkoutSummaryText] = useState("Assign a program to your profile to see your workout.");
  const [workoutSummaryLoading, setWorkoutSummaryLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { isGranted } = useNotificationPermission();
  
  // New User Detection
  // "New" has to mean genuinely at the start, not merely "no sessions came back".
  // Keying this off allSessions alone put an athlete 82 days into a program behind
  // the week-1 welcome takeover whenever the sessions query returned empty or
  // failed, hiding the real dashboard (and their actual program) entirely.
  const isNewUser = !loading && allSessions.length === 0 && (todaysWorkout?.day ?? 0) <= 7;

  // Calculate progress data when sessions or Strava activities change
  useEffect(() => {
    if (allSessions.length > 0 || stravaRecentActivities.length > 0) {
        const weeklyProgress = generateProgressData(allSessions, stravaRecentActivities);
        setProgressData(weeklyProgress);
    }
  }, [allSessions, stravaRecentActivities]);

  // Mark Strava as "not needed" for non-connected users so the summary doesn't wait forever
  useEffect(() => {
    if (!loading && user && !user.strava?.accessToken) {
      setTodayStravaLoaded(true);
    }
  }, [loading, user]);

  // Auto-generate a Hyrox starter plan for users who skipped onboarding and have no program
  useEffect(() => {
    if (loading || !user) return;
    if (!user.onboardingSkipped || user.programId) return;
    if (starterPlanTriggeredRef.current) return;

    starterPlanTriggeredRef.current = true;
    setIsGeneratingStarterPlan(true);

    generateHyroxStarter({ userName: user.firstName })
      .then(async (result) => {
        await updateUser(user.id, {
          customProgram: result.workouts as any,
          programId: 'hyrox-starter',
          startDate: new Date(),
        });
        await refreshData();
      })
      .catch((err) => {
        logger.error('Failed to generate Hyrox starter plan:', err);
      })
      .finally(() => {
        setIsGeneratingStarterPlan(false);
      });
  }, [loading, user]);

  // Effect for AI Dashboard Summary — fires ONCE after all data including Strava is ready.
  // Using summaryFiredRef to prevent double-firing when todayStravaLoaded flips to true.
  useEffect(() => {
    if (!user || !program || !todaysWorkout || progressData.length === 0) return;
    if (!todayStravaLoaded) return; // Wait until we know whether there are Strava activities today
    if (!coachNotes.loaded) return; // Speak with the athlete's context, or not at all
    if (summaryFiredRef.current) return; // Don't fire more than once per mount

    summaryFiredRef.current = true;

    const weeklyConsistency = [
      `3 weeks ago: ${progressData[0]?.workouts ?? 0} workouts`,
      `2 weeks ago: ${progressData[1]?.workouts ?? 0} workouts`,
      `last week: ${progressData[2]?.workouts ?? 0} workouts`,
      `this week so far: ${progressData[3]?.workouts ?? 0} workouts`,
    ].join(', ');
    // Only pass Strava activity when it loaded successfully (not when errored)
    const stravaForSummary = stravaLoadError ? undefined : (todayStravaSummary ?? undefined);

    // Cache-first: this copy is day-stable, and re-generating it on every mount
    // made the dashboard wait on a model each time the athlete navigated back.
    const cacheKey = aiCopyKey(
      'dashboard', user.id,
      program.name, todaysWorkout.day, weeklyConsistency,
      stravaForSummary, coachNotes.promptText,
    );
    const cached = readAiCopy(cacheKey);
    if (cached) {
      setSummary(cached);
      setSummaryLoading(false);
      return;
    }

    setSummaryLoading(true);
    dashboardSummary({
      userName: user.firstName,
      programName: program.name,
      daysCompleted: todaysWorkout.day > 0 ? todaysWorkout.day : 0,
      weeklyConsistency,
      todayStravaActivity: stravaForSummary,
      coachNotes: coachNotes.promptText ?? undefined,
    }).then(result => {
      setSummary(result.summary);
      writeAiCopy(cacheKey, result.summary);
    }).catch(aiError => {
      logger.error("Failed to generate AI dashboard summary:", aiError);
      // Deliberately not cached — a fallback line should not stick for the day.
      setSummary("Here's your plan for today. Let's get it done.");
    }).finally(() => {
      setSummaryLoading(false);
    });
  }, [user, program, todaysWorkout, progressData, todayStravaLoaded, stravaLoadError, coachNotes.loaded]); // todayStravaSummary and coachNotes.promptText intentionally excluded — read via closure once loaded

  // Effect for AI Workout Summary — staggered 1s after mount to avoid concurrent Gemini calls
  useEffect(() => {
    if (!user || !todaysWorkout?.workout || !todaysSession) {
      setWorkoutSummaryLoading(false);
      return;
    }

    const runParts = hasRuns(todaysWorkout.workout) ? todaysWorkout.workout.runs.map(r => r.type) : [];
    const exParts = hasExercises(todaysWorkout.workout) ? todaysWorkout.workout.exercises.map(e => e.name) : [];
    const exercisesForSummary = [...runParts, ...exParts].join(', ');

    const cacheKey = aiCopyKey(
      'workout', user.id,
      todaysWorkout.workout.title, exercisesForSummary,
      todaysSession.notes, coachNotes.promptText,
    );
    const cached = readAiCopy(cacheKey);
    if (cached) {
      // Cache hit: render immediately and skip both the stagger and the call.
      setWorkoutSummaryText(cached);
      setWorkoutSummaryLoading(false);
      return;
    }

    setWorkoutSummaryLoading(true);

    // Delay slightly so dashboard summary fires first, avoiding concurrent API calls
    const timer = setTimeout(() => {
      workoutSummary({
        userName: user.firstName,
        workoutTitle: todaysWorkout.workout!.title,
        exercises: exercisesForSummary,
        userNotes: todaysSession.notes,
        coachNotes: coachNotes.promptText ?? undefined,
      }).then(result => {
        setWorkoutSummaryText(result.summary);
        writeAiCopy(cacheKey, result.summary);
      }).catch(aiError => {
        logger.error("Failed to generate AI workout summary:", aiError);
        // Not cached: the fallback is the bare workout title, not coaching copy.
        setWorkoutSummaryText(todaysWorkout.workout!.title);
      }).finally(() => {
        setWorkoutSummaryLoading(false);
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [user, todaysWorkout, todaysSession]);

  // Native apps schedule tomorrow's reminder on the device as a fallback for
  // when a server push can't reach them. (Web gets the server push; the old
  // web path was a 24-hour setTimeout that died with the tab.)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user || !program || !user.startDate || user.planPausedAt) return;
    const tomorrow = addDays(startOfDay(new Date()), 1);
    const next = getWorkoutForDay(program, user.startDate, tomorrow).sessions;
    if (next.length === 0) {
      void cancelScheduledReminder();
      return;
    }
    const parts = next.flatMap(w => [
      ...(hasRuns(w) ? w.runs.map(r => r.type) : []),
      ...(hasExercises(w) ? w.exercises.map(e => e.name) : []),
    ]);
    checkAndScheduleNotification({ workoutTitle: next[0].title, exercises: parts.join(', ') }, user.notificationTime)
      .catch(error => logger.error('Error scheduling notification:', error));
  }, [user, program]);

  const generateProgressData = (sessions: WorkoutSession[], stravaActivities: StravaActivity[] = []) => {
      const now = new Date();
      const weeklyData: { week: string, workouts: number }[] = [];
      // A Strava activity linked to a session is the same workout — count it once.
      const linkedStravaIds = new Set(sessions.map(s => s.stravaId).filter(Boolean).map(String));
      const unlinkedActivities = stravaActivities.filter(a => !linkedStravaIds.has(String(a.id)));

      for (let i = 3; i >= 0; i--) {
          const weekStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999); // include all of Sunday

          const appCount = sessions.filter(s =>
              s.finishedAt && !s.skipped && isWithinInterval(s.finishedAt, { start: weekStart, end: weekEnd })
          ).length;

          const stravaCount = unlinkedActivities.filter(a => {
              const d = new Date(a.start_date_local || a.start_date);
              return isWithinInterval(d, { start: weekStart, end: weekEnd });
          }).length;

          weeklyData.push({
              week: `W${4-i}`,
              workouts: appCount + stravaCount
          });
      }
      return weeklyData;
  }
  
  const handleStartWorkout = () => {
      if (todaysWorkout?.workout) {
          router.push('/workout/active');
      }
  }
  
  const handleGenerateWorkout = async () => {
    if (!user) return;
    setIsGeneratingWorkout(true);
    toast({ title: 'Generating your workout...', description: 'The AI is building a custom session for you.' });
    try {
        const generated = await generateWorkout({
            userName: user.firstName,
            experience: user.experience,
        });

        const oneOffWorkout: WorkoutDay = {
            ...generated,
            day: 0,
            programType: 'hyrox',
        } as WorkoutDay;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await getOrCreateWorkoutSession(user.id, 'one-off-ai', today, oneOffWorkout, true);
        // The dashboard and /workout/active read today's workout from the shared user
        // context, not Firestore — without this they keep showing the pre-generation
        // rest day and only the calendar (which queries sessions directly) has it.
        await refreshData();

        toast({ title: 'Workout Generated!', description: 'Redirecting you to start your session.' });
        router.push('/workout/active');

    } catch (error) {
        logger.error("Failed to generate AI workout:", error);
        toast({ title: 'Error', description: 'Could not generate a workout. Please try again.', variant: 'destructive' });
        setIsGeneratingWorkout(false);
    }
  };

  // Moves today's session to tomorrow (tomorrow's goes to the next rest day),
  // records the commitment for the morning reminder, and schedules a native
  // reminder where there is one. This button used to show a toast promising a
  // reminder and do nothing else.
  const handleCommitTomorrow = async () => {
      if (!user || !program || !user.startDate || !todaysWorkout?.sessions.length) return;
      setIsPostponing(true);
      try {
          const today = startOfDay(new Date());
          const lastDay = addDays(today, 6);
          const persisted = await getUserSessionsInRange(user.id, today, lastDay);
          if (persisted.some(s => isSameDay(s.workoutDate, today) && s.finishedAt)) {
              toast({ title: 'Already done today', description: 'Nice work — nothing to move.' });
              return;
          }

          const week = Array.from({ length: 7 }, (_, offset) => {
              const date = addDays(today, offset);
              const scheduled = persisted
                  .filter(s => isSameDay(s.workoutDate, date) && !['one-off-ai', 'custom-workout'].includes(s.programId))
                  .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0));
              const workouts = scheduled.length > 0
                  ? scheduled.map(s => s.workoutDetails).filter((w): w is WorkoutDay => !!w)
                  : getWorkoutForDay(program, user.startDate!, date).sessions;
              return { date, workouts };
          });

          const plan = planPostpone(week);
          if (!plan) return;
          await saveScheduleChanges({ programId: program.id, days: plan.changes });

          const tomorrow = addDays(today, 1);
          const movedTitle = week[0].workouts[0].title;
          await updateUser(user.id, {
              trainingCommitment: { date: format(tomorrow, 'yyyy-MM-dd'), workoutTitle: movedTitle },
          });
          void scheduleDailyNotification(
              { workoutTitle: movedTitle, exercises: week[0].workouts.map(w => w.title).join(', ') },
              user.notificationTime,
          ).catch(err => logger.error('Could not schedule the reminder:', err));

          trackEvent(user.id, 'workout_postponed', { title: movedTitle, bumped: !!plan.bumpedTo });
          await refreshData();
          toast({
              title: `${movedTitle} is now tomorrow`,
              description: [
                  plan.bumpedTo ? `Tomorrow's session moved to ${format(plan.bumpedTo, 'EEEE')}.` : null,
                  isGranted || Capacitor.isNativePlatform()
                      ? "We'll remind you in the morning."
                      : 'Turn on notifications in Profile for a morning reminder.',
              ].filter(Boolean).join(' '),
          });
      } catch (error) {
          logger.error('Failed to move today to tomorrow:', error);
          toast({ title: 'Could not move the session', description: 'Please try again.', variant: 'destructive' });
      } finally {
          setIsPostponing(false);
      }
  };

  const handleMarkDone = async () => {
      if (!todaysSession || !todaysWorkout?.workout) return;
      setIsMarkingDone(true);
      try {
          await updateWorkoutSession(todaysSession.id, {
              finishedAt: new Date(),
              workoutTitle: todaysWorkout.workout.title,
          });
          trackEvent(user!.id, 'workout_completed', { source: 'dashboard_mark_done', sessionId: todaysSession.id, title: todaysWorkout.workout.title });
          await refreshData();
          toast({ title: 'Workout Completed!', description: 'Nice work — one more toward this week.' });
      } catch (error) {
          logger.error('Failed to mark workout done:', error);
          toast({ title: 'Error', description: 'Could not mark workout as done.', variant: 'destructive' });
      } finally {
          setIsMarkingDone(false);
      }
  };

  // Stable callback — prevents TodayStravaFeed from re-fetching on every parent render
  const handleStravaActivitiesLoaded = useCallback((s: string | null, recentActivities: StravaActivity[], error?: StravaLoadError) => {
    setTodayStravaSummary(s);
    setStravaRecentActivities(recentActivities);
    setStravaLoadError(error ?? null);
    setTodayStravaLoaded(true);
  }, []);

  const programStartsInFuture = user?.startDate && isFuture(user.startDate);
  const showGenerateWorkoutButton = !program || programStartsInFuture || !todaysWorkout?.workout;
  // All of today's sessions (there may be more than one, e.g. a Run + a Weight Training session) must be
  // wrapped up before the "Today's Workout" card switches to its completed state.
  const isWorkoutCompleted = todaysWorkoutSessions.length > 0 && todaysWorkoutSessions.every((s) => !!s.finishedAt);
  const completedWorkoutCount = allSessions.filter((s) => s.finishedAt && !s.skipped).length;
  // The retired 3-session AI starter: anyone still on it has nothing after day 3.
  const isStarterPlan = user?.programId === 'hyrox-starter';
  const starterEnded = isStarterPlan && (todaysWorkout?.day ?? 0) > 3;
  const showProfilePrompt =
    !!user?.onboardingSkipped && (starterEnded || (completedWorkoutCount >= 3 && !profileBannerDismissed));
  
  if (loading) {
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
            </div>
             <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader><Skeleton className="h-6 w-3/4" /></CardHeader>
                    <CardContent><Skeleton className="h-48 w-full" /></CardContent>
                    <CardFooter><Skeleton className="h-10 w-full" /></CardFooter>
                </Card>
                <div className="space-y-6">
                    <Card><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
                    <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>
                </div>
            </div>
        </div>
    );
  }

  const workoutHasRuns = hasRuns(todaysWorkout?.workout);
  const workoutHasExercises = hasExercises(todaysWorkout?.workout);
  const isStravaConnected = user?.strava?.accessToken;

  // === NEW USER ONBOARDING DASHBOARD ===
  if (isNewUser || isGeneratingStarterPlan) {
      return (
        <div className="space-y-6 animate-in fade-in duration-700">
            <div className="space-y-1">
                <h1 className="text-3xl font-bold tracking-tight text-primary">
                    Welcome to Week 1, {user?.firstName}!
                </h1>
                <p className="text-muted-foreground text-lg">
                    The hardest step is the first one. Let's make it easy.
                </p>
            </div>

            {user && (
              <PlanAdjustmentNotice userId={user.id} todaysSessions={todaysWorkoutSessions} onChanged={refreshData} />
            )}

            <AndroidBetaBanner userEmail={user?.email} userName={user?.firstName} />

            <div className="grid gap-6 md:grid-cols-2">
                {/* HERO CARD: TODAY'S WORKOUT */}
                <Card className="border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5 shadow-lg">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-xl">
                            {isStarterPlan ? (
                              <Sparkles className="h-6 w-6 text-primary" />
                            ) : (
                              <Target className="h-6 w-6 text-primary" />
                            )}
                            {isStarterPlan ? 'Your Hyrox Starter Plan' : 'Your First Mission'}
                        </CardTitle>
                        <CardDescription>
                            {isStarterPlan
                              ? 'AI-generated Hyrox workouts to get you moving — then we\'ll match you to a full program.'
                              : 'Complete just 1 workout this week to build momentum.'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isGeneratingStarterPlan ? (
                            <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm font-medium">Building your Hyrox starter workouts...</p>
                                <p className="text-xs">The AI coach is designing 3 sessions for you</p>
                            </div>
                        ) : todaysWorkout?.workout ? (
                            <div className="space-y-4">
                                <div className="p-4 bg-background/80 rounded-lg border">
                                    <h3 className="font-bold text-lg">{todaysWorkout.workout.title}</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Day {todaysWorkout.day} • {workoutHasRuns && workoutHasExercises ? 'Hybrid' : workoutHasRuns ? 'Running' : 'Strength'}
                                        {todaysWorkout.sessions.length > 1 && ` • +${todaysWorkout.sessions.length - 1} more session${todaysWorkout.sessions.length > 2 ? 's' : ''} today`}
                                    </p>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    Can't do it today? No problem. Commit to tomorrow and we'll hold you accountable.
                                </p>
                            </div>
                        ) : (
                            <div className="text-center py-6">
                                {starterEnded ? (
                                    <>
                                        <p>Your starter sessions are done — let&apos;s get you on a full plan.</p>
                                        <Button className="mt-3" onClick={() => setShowCompleteOnboarding(true)}>
                                            Get My Program <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <p>No workout scheduled today.</p>
                                        <Button variant="link" onClick={handleGenerateWorkout}>
                                            Generate a Quick Start Session
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </CardContent>
                    <CardFooter className="flex flex-col sm:flex-row gap-3">
                        <Button 
                            variant="default" 
                            size="lg" 
                            className="w-full font-bold shadow-md hover:shadow-xl transition-all"
                            onClick={handleStartWorkout}
                            disabled={!todaysWorkout?.workout}
                        >
                            <Zap className="mr-2 h-5 w-5 fill-yellow-400 text-yellow-400" />
                            Start First Workout
                        </Button>
                        <Button
                            variant="outline"
                            size="lg"
                            className="w-full"
                            onClick={handleCommitTomorrow}
                            disabled={!todaysWorkout?.workout || isPostponing || isWorkoutCompleted}
                        >
                            {isPostponing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
                            Do It Tomorrow
                        </Button>
                    </CardFooter>
                </Card>

                {/* SIDEBAR: WHY HYBRIDX */}
                <div className="space-y-6">
                    <Card className="bg-muted/30">
                        <CardHeader>
                            <CardTitle className="text-lg">Why HybridX?</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="flex gap-3">
                                <div className="bg-primary/10 p-2 rounded-full h-fit">
                                    <Zap className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <p className="font-semibold">AI Adaptability</p>
                                    <p className="text-muted-foreground">Busy week, sore legs, holiday coming? Tell your coach and it reworks what&apos;s ahead.</p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="bg-primary/10 p-2 rounded-full h-fit">
                                    <Target className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <p className="font-semibold">Event Prep</p>
                                    <p className="text-muted-foreground">Training for Hyrox or a Marathon? Give us the race date and we&apos;ll build the plan back from it.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <RacePrepDialog />

                    {/* SETUP STEPS */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Quick Setup</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {!isStravaConnected && (
                                <Link href="/profile" className="flex items-center justify-between p-3 rounded-md hover:bg-muted transition-colors border border-dashed">
                                    <span className="flex items-center gap-2 text-sm font-medium">
                                        <LinkIcon className="h-4 w-4" /> Connect Strava
                                    </span>
                                    <Badge variant="secondary">Recommended</Badge>
                                </Link>
                            )}
                            <div className="flex items-center justify-between p-3 rounded-md bg-muted/20 border">
                                <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                    <CheckCircle className="h-4 w-4 text-green-500" /> Account Created
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
            {user && (
              <CompleteOnboardingDialog
                open={showCompleteOnboarding}
                onOpenChange={setShowCompleteOnboarding}
                userId={user.id}
                userName={user.firstName}
                onComplete={refreshData}
              />
            )}
        </div>
      );
  }

  // === EXISTING DASHBOARD (Standard) ===
  return (
    <>
      <div className="space-y-6">
        {/* Today's session is the first thing on the page. Everything else —
            coach, trial, integrations — comes after it. */}
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Welcome back, {user?.firstName || 'Athlete'}
        </h1>

        {/* Trial countdown: at the top only in its last few days. */}
        <TrialBanner when="urgent" />

        {user && (
          <PlanAdjustmentNotice userId={user.id} todaysSessions={todaysWorkoutSessions} onChanged={refreshData} />
        )}

        {user && (
          <PlanCatchUpCard
            user={user}
            program={program}
            allSessions={allSessions}
            sessionsLoaded={sessionsLoaded}
            onChanged={refreshData}
          />
        )}

        {user?.startDate && (
          <ProgramFinishCard
            user={user}
            program={program}
            todayProgramDay={programDayFor(user.startDate, startOfDay(new Date()))}
            allSessions={allSessions}
          />
        )}

        {/* First-workout activation nudge — completing the first session is the
            strongest predictor of retention, so we surface it prominently until done. */}
        {!loading && !program && !user?.planPausedAt && (
          <Card className="border-accent/50 bg-gradient-to-r from-accent/10 to-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Zap className="h-5 w-5 text-accent" />
                Pick a plan to train with
              </CardTitle>
              <CardDescription>
                A plan puts a session here every training day, with reminders and a coach that knows what&apos;s next.
              </CardDescription>
            </CardHeader>
            <CardFooter className="pt-0">
              <Button size="sm" onClick={() => router.push('/programs')}>
                Choose a program
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Profile completion prompt — shown after 3 workouts for users who skipped onboarding */}
        {showProfilePrompt && (
          <Card className="border-primary/40 bg-gradient-to-r from-primary/5 to-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="h-5 w-5 text-primary" />
                {starterEnded
                  ? 'Your starter sessions are done'
                  : `You've smashed ${completedWorkoutCount} workouts!`}
              </CardTitle>
              <CardDescription>
                {starterEnded
                  ? 'Answer three quick questions and we’ll put you on a full plan that fits your week.'
                  : 'Answer three quick questions and we’ll match you to a plan built around your goal and schedule.'}
              </CardDescription>
            </CardHeader>
            <CardFooter className="gap-2 pt-0">
              <Button size="sm" onClick={() => setShowCompleteOnboarding(true)}>
                Get My Program <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              {!starterEnded && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    localStorage.setItem('profileBannerDismissed', 'true');
                    setProfileBannerDismissed(true);
                  }}
                >
                  Maybe Later
                </Button>
              )}
            </CardFooter>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className={cn("lg:col-span-2", isWorkoutCompleted && "bg-muted/30")}>
            <CardHeader>
              <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {workoutHasRuns && !workoutHasExercises ? <Route className="h-6 w-6" /> : <Target className="h-6 w-6" />}
                      {program && todaysWorkout?.workout && !programStartsInFuture ? (todaysWorkout.day > 0 ? `Today's Workout (Day ${todaysWorkout.day})` : "Today's Workout") : "Today's Plan"}
                      {user?.customProgram && user.customProgram.length > 0 && (
                        <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 ml-2">
                          <Zap className="mr-1 h-3 w-3" />
                          Personalized
                        </Badge>
                      )}
                    </CardTitle>
                  </div>
                  {isWorkoutCompleted && (
                      <Badge variant="outline" className="bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800">
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Completed
                      </Badge>
                  )}
              </div>
              <CardDescription asChild>
                  <div className={cn("mt-2 p-3 bg-accent/20 border border-accent/50 rounded-md transform -rotate-1 shadow-sm", {
                      "animate-pulse": workoutSummaryLoading,
                      "hidden": !todaysWorkout?.workout || programStartsInFuture
                  })}>
                      <div className="rotate-1 text-foreground/90 italic">
                          {workoutSummaryLoading
                            ? 'Generating your daily tip...'
                            : <CoachMarkdown content={workoutSummaryText} variant="inline" />}
                      </div>
                  </div>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isWorkoutCompleted ? (
                 <div className="text-center text-muted-foreground py-10">
                    <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                    <p className="font-semibold text-foreground">Great job! You've completed today's workout.</p>
                    <p className="text-sm">Check your progress in the calendar or history.</p>
                 </div>
              ) : todaysWorkout?.workout && !programStartsInFuture ? (
                  <div className="space-y-4">
                      <Separator />
                      {todaysWorkout.sessions.map((sessionWorkout, idx) => {
                        const sHasRuns = hasRuns(sessionWorkout);
                        const sHasExercises = hasExercises(sessionWorkout);
                        const persistedSession = todaysWorkoutSessions[idx];
                        const isSessionDone = !!persistedSession?.finishedAt;
                        const isMultiSession = todaysWorkout.sessions.length > 1;
                        return (
                          <div key={idx} className={cn('pt-4', idx > 0 && 'border-t')}>
                            {isMultiSession && (
                              <div className="flex items-center justify-between mb-2 gap-2">
                                <p className="text-sm font-semibold">
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1.5">
                                    Session {idx + 1} of {todaysWorkout.sessions.length}
                                  </span>
                                  {sessionWorkout.title}
                                </p>
                                {isSessionDone && (
                                  <Badge variant="outline" className="bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800 shrink-0">
                                    <CheckCircle className="mr-1 h-3 w-3" />
                                    Done
                                  </Badge>
                                )}
                              </div>
                            )}
                            {isSessionDone ? (
                              <p className="text-sm text-muted-foreground">Completed — nice work.</p>
                            ) : (
                              <ul className="space-y-4">
                                {sHasRuns && (sessionWorkout as RunningWorkout).runs.map((run: PlannedRun) => (
                                    <li key={run.description}>
                                      <p className="font-medium">{formatPlannedRun(run)}</p>
                                      {trainingPaces ? (
                                          <p className="text-sm text-muted-foreground">
                                              Target Pace: <span className="font-semibold text-primary">{formatPace(trainingPaces[run.paceZone])}</span> / km
                                          </p>
                                      ) : (
                                          <p className="text-sm text-yellow-600">Enter benchmark times in your profile to see target paces.</p>
                                      )}
                                    </li>
                                ))}
                                {sHasRuns && sHasExercises && (
                                    <li><Separator /></li>
                                )}
                                {sHasExercises && (sessionWorkout as Workout).exercises.map((ex) => (
                                    <li key={ex.name}>
                                        <p className="font-medium">{ex.name}</p>
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ex.details}</p>
                                    </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                  </div>
              ) : (
                  <div className="text-center text-muted-foreground py-10">
                      {programStartsInFuture ? (
                          <>
                              <p>Your program <span className="font-semibold text-foreground">{program?.name}</span> is scheduled to start in the future.</p>
                              <p className="text-sm">In the meantime, why not generate or log a workout for today?</p>
                          </>
                      ) : (
                          <>
                              <p>No workout scheduled for today.</p>
                              <p className="text-sm">
                                {program
                                  ? 'Rest day — or generate a session with AI, or log something you did.'
                                  : <>Pick a plan from <Link href="/programs" className="underline">Programs</Link>, generate a session with AI, or log something you did.</>}
                              </p>
                          </>
                      )}
                  </div>
              )}
            </CardContent>
            <CardFooter className="flex-col md:flex-row gap-2">
              {isWorkoutCompleted ? (
                <Button variant="outline" className="w-full" asChild>
                    <Link href="/history">
                        <History className="mr-2 h-4 w-4" />
                        View Workout History
                    </Link>
                </Button>
              ) : showGenerateWorkoutButton ? (
                  <Button variant="accent" className="w-full" onClick={handleGenerateWorkout} disabled={isGeneratingWorkout}>
                      {isGeneratingWorkout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                      {isGeneratingWorkout ? 'Generating...' : 'Generate AI Workout'}
                  </Button>
              ) : (
                  <div className="w-full flex flex-col md:flex-row gap-2">
                      <Button variant="accent" className="w-full" onClick={handleStartWorkout} disabled={!todaysWorkout?.workout}>
                          <Zap className="mr-2 h-4 w-4" />
                          Start / Resume Workout
                      </Button>
                      {todaysSession && todaysWorkoutSessions.length <= 1 && (
                          <Button variant="outline" className="w-full" onClick={handleMarkDone} disabled={isMarkingDone}>
                              {isMarkingDone
                                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  : <CheckSquare className="mr-2 h-4 w-4" />
                              }
                              Mark as Done
                          </Button>
                      )}
                  </div>
              )}
              <Button variant="outline" className="w-full" onClick={() => setIsCustomWorkoutDialogOpen(true)}>
                   <PlusSquare className="mr-2 h-4 w-4" />
                   Log New Workout
              </Button>
              {/* The coach reached from the session it's about, with the question
                  already asked — not a chat tab you have to remember exists. */}
              {todaysWorkout?.workout && !programStartsInFuture && !isWorkoutCompleted && (
                <Button variant="ghost" className="w-full" asChild>
                    <Link
                        href={`/assistant?q=${encodeURIComponent(
                            `Talk me through today's ${todaysWorkout.workout.title} — how should I approach it?`,
                        )}`}
                    >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Ask your coach about this
                    </Link>
                </Button>
              )}
            </CardFooter>
          </Card>

          <div className="space-y-6">

            {/* ADDED RACE PREP DIALOG HERE */}
            <RacePrepDialog />

            {/* Training Load Card — shown when Strava is connected */}
            {isStravaConnected && user && (
              <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
                <TrainingLoadCard />
              </Suspense>
            )}

            {stravaLoadError === 'reconnect_required' && (
              <Card className="bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-800 dark:text-red-300">
                    <LinkIcon className="h-5 w-5" />
                    Strava Disconnected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    Your Strava connection has expired. Reconnect to resume activity syncing and personalised insights.
                  </p>
                </CardContent>
                <CardFooter>
                  <Button asChild variant="outline" className="w-full border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 hover:bg-red-100 hover:text-red-900 dark:hover:bg-red-950/70 dark:hover:text-red-200">
                    <Link href="/profile">Reconnect Strava</Link>
                  </Button>
                </CardFooter>
              </Card>
            )}

            {!isStravaConnected && !stravaLoadError && (
              <Card className="bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-300">
                    <LinkIcon className="h-5 w-5" />
                    Connect to Strava
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    Automatically sync your activities to track progress and get personalized insights.
                  </p>
                </CardContent>
                <CardFooter>
                  <Button asChild variant="outline" className="w-full border-orange-300 dark:border-orange-800 text-orange-800 dark:text-orange-300 hover:bg-orange-100 hover:text-orange-900 dark:hover:bg-orange-950/70 dark:hover:text-orange-200">
                    <Link href="/profile">Connect Account</Link>
                  </Button>
                </CardFooter>
              </Card>
            )}

            <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                      <BarChart className="h-6 w-6" />
                      Weekly Consistency
                  </CardTitle>
                  <CardDescription>
                      Your completed workouts over the last 4 weeks.
                  </CardDescription>
              </CardHeader>
              <CardContent>
                  <ChartContainer config={chartConfig} className="h-40 w-full">
                      <RechartsBarChart 
                          accessibilityLayer
                          data={progressData} 
                          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
                      >
                          <CartesianGrid vertical={false} />
                          <XAxis 
                              dataKey="week" 
                              tickLine={false} 
                              axisLine={false} 
                              tickMargin={8}
                              tickFormatter={(value) => value.slice(0, 3)}
                          />
                          <ChartTooltip 
                              cursor={false} 
                              content={<ChartTooltipContent indicator="dot" />} 
                          />
                          <Bar 
                              dataKey="workouts" 
                              fill="hsl(var(--primary))" 
                              radius={8} 
                          />
                      </RechartsBarChart>
                  </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </div>

        <CoachPanel
          summary={summary}
          summaryLoading={summaryLoading}
          notes={coachNotes.notes}
          onDismissNote={coachNotes.dismiss}
          onNotesMayHaveChanged={coachNotes.refresh}
        />

        <TrialBanner when="calm" />

        {/* Android Beta Testing Banner */}
        <AndroidBetaBanner
          userEmail={user?.email}
          userName={user?.firstName}
        />

        {/* Today's Strava Activity Feed — only rendered when Strava is connected */}
        {isStravaConnected && user && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Today&apos;s Activity
            </h2>
            <Suspense fallback={
              <div className="flex gap-3">
                <Skeleton className="h-16 flex-1 rounded-xl" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </div>
            }>
              <TodayStravaFeed onActivitiesLoaded={handleStravaActivitiesLoaded} />
            </Suspense>
          </div>
        )}

        <StatsWidget streakData={streakData} loading={loading} />
      </div>
      {user && (
        <Suspense fallback={null}>
          <CustomWorkoutDialog
            isOpen={isCustomWorkoutDialogOpen}
            setIsOpen={setIsCustomWorkoutDialogOpen}
            userId={user.id}
            onLogged={refreshData}
         />
        </Suspense>
      )}
      {user && (
        <CompleteOnboardingDialog
          open={showCompleteOnboarding}
          onOpenChange={setShowCompleteOnboarding}
          userId={user.id}
          userName={user.firstName}
          onComplete={refreshData}
        />
      )}
    </>
  );
}
