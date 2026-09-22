// src/app/(app)/history/page.tsx
'use client';

import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { format } from 'date-fns';
import { Search, Filter, Calendar, CheckCircle2, XCircle, Clock, Trophy, Dumbbell, Route, ChevronDown, ChevronUp, Link as LinkIcon, Wrench, PlusSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getAuthInstance } from '@/lib/firebase';
import { getPaginatedUserSessions, type WorkoutSession } from '@/services/session-service-client';
import { cn } from '@/lib/utils';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import Link from 'next/link';
import { formatExerciseDetails } from '@/utils/text-formatter';
import type { Exercise, PlannedRun } from '@/models/types';
import { formatPlannedRun } from '@/lib/workout-utils';
import { hasRuns, hasExercises } from '@/lib/type-guards';
import { canFixTreadmill } from '@/lib/treadmill';

// Lazy load heavy dialogs
const ShareWorkoutDialog = lazy(() => import('@/components/share-workout-dialog').then(mod => ({ default: mod.ShareWorkoutDialog })));
const LinkStravaActivityDialog = lazy(() => import('@/components/link-strava-activity-dialog').then(mod => ({ default: mod.LinkStravaActivityDialog })));
const FixTreadmillDialog = lazy(() => import('@/components/fix-treadmill-dialog').then(mod => ({ default: mod.FixTreadmillDialog })));
const CustomWorkoutDialog = lazy(() => import('@/components/custom-workout-dialog').then(mod => ({ default: mod.CustomWorkoutDialog })));

export default function WorkoutHistoryPage() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'skipped' | 'missed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'hyrox' | 'running'>('all');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'duration'>('date-desc');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [sessionToLink, setSessionToLink] = useState<WorkoutSession | null>(null);
  const [isLinkerOpen, setIsLinkerOpen] = useState(false);
  const [sessionToFix, setSessionToFix] = useState<WorkoutSession | null>(null);
  const [isFixOpen, setIsFixOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLogWorkoutOpen, setIsLogWorkoutOpen] = useState(false);

  const refreshSessions = async () => {
    const auth = await getAuthInstance();
    const user = auth.currentUser;
    if (!user) return;
    const result = await getPaginatedUserSessions(user.uid, 20);
    setSessions(result.sessions);
    setLastDoc(result.lastDoc);
    setHasMore(result.hasMore);
  };

  const toggleExpanded = (sessionId: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  useEffect(() => {
    const initialize = async () => {
      const auth = await getAuthInstance();
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          setUserId(user.uid);
          try {
            const result = await getPaginatedUserSessions(user.uid, 20);
            setSessions(result.sessions);
            setLastDoc(result.lastDoc);
            setHasMore(result.hasMore);
          } catch (error) {
            console.error('Error fetching workout history:', error);
          } finally {
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
      });
      return unsubscribe;
    };

    let unsubscribe: () => void;
    initialize().then((unsub) => (unsubscribe = unsub));

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const loadMore = async () => {
    const auth = await getAuthInstance();
    const user = auth.currentUser;

    if (!user || !lastDoc || !hasMore || loadingMore) return;

    setLoadingMore(true);
    try {
      const result = await getPaginatedUserSessions(user.uid, 20, lastDoc);
      setSessions(prev => [...prev, ...result.sessions]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error('Error loading more sessions:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredAndSortedSessions = useMemo(() => {
    let filtered = sessions;

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter((session) =>
        session.workoutTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.notes?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter === 'completed') {
      filtered = filtered.filter((session) => session.finishedAt && !session.skipped);
    } else if (statusFilter === 'skipped') {
      filtered = filtered.filter((session) => session.skipped);
    } else if (statusFilter === 'missed') {
      filtered = filtered.filter((session) => !session.finishedAt && !session.skipped);
    }

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter((session) => session.programType === typeFilter);
    }

    // Sort
    filtered.sort((a, b) => {
        // Convert to number explicitly to satisfy TS
      if (sortBy === 'date-desc') {
        return new Date(b.workoutDate).getTime() - new Date(a.workoutDate).getTime();
      } else if (sortBy === 'date-asc') {
        return new Date(a.workoutDate).getTime() - new Date(b.workoutDate).getTime();
      } else {
        // Sort by duration
        // Ensure duration is treated as a number. Assuming duration is string "120" or number 120
        const aDuration = Number(a.duration) || 0;
        const bDuration = Number(b.duration) || 0;
        return bDuration - aDuration;
      }
    });

    return filtered;
  }, [sessions, searchQuery, statusFilter, typeFilter, sortBy]);

  const stats = useMemo(() => {
    const completed = sessions.filter((s) => s.finishedAt && !s.skipped);
    const totalDuration = completed.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    const avgDuration = completed.length > 0 ? totalDuration / completed.length : 0;
    const missed = sessions.filter((s) => !s.finishedAt && !s.skipped);

    return {
      total: sessions.length,
      completed: completed.length,
      skipped: sessions.filter((s) => s.skipped).length,
      missed: missed.length,
      completionRate: sessions.length > 0 ? Math.round((completed.length / sessions.length) * 100) : 0,
      avgDuration: Math.round(avgDuration),
    };
  }, [sessions]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-1/4" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Workout History</h1>
          <p className="text-muted-foreground">Track your progress and review past workouts.</p>
        </div>
        {userId && (
          <Button onClick={() => setIsLogWorkoutOpen(true)} className="shrink-0">
            <PlusSquare className="mr-2 h-4 w-4" />
            Log New Workout
          </Button>
        )}
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <p className="text-xs text-muted-foreground">{stats.completionRate}% completion rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Missed</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{stats.missed}</div>
            <p className="text-xs text-muted-foreground">started, not finished</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Skipped</CardTitle>
            <XCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{stats.skipped}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgDuration}</div>
            <p className="text-xs text-muted-foreground">minutes per workout</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search workouts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                  <SelectItem value="missed">Missed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={typeFilter} onValueChange={(value: any) => setTypeFilter(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="hyrox">HYROX</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sort By</Label>
              <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Newest First</SelectItem>
                  <SelectItem value="date-asc">Oldest First</SelectItem>
                  <SelectItem value="duration">Duration</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workout List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {filteredAndSortedSessions.length} {filteredAndSortedSessions.length === 1 ? 'Workout' : 'Workouts'}
          </h2>
          {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTypeFilter('all');
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>

        {filteredAndSortedSessions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No workouts found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
                  ? 'Try adjusting your filters or search query.'
                  : 'Start your fitness journey by completing your first workout!'}
              </p>
              <Link href="/dashboard">
                <Button>Go to Dashboard</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredAndSortedSessions.map((session) => {
              const isCompleted = session.finishedAt && !session.skipped;
              const isMissed = !session.finishedAt && !session.skipped;

              return (
                <Card key={session.id} className={cn('transition-all hover:shadow-md', {
                  'border-green-500/50': isCompleted,
                  'border-orange-500/50': session.skipped,
                  'border-red-400/50': isMissed,
                })}>
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start gap-3">
                          <div className={cn('p-2 rounded-lg mt-1', {
                            'bg-blue-500/10': session.programType === 'hyrox',
                            'bg-green-500/10': session.programType === 'running',
                          })}>
                            {session.programType === 'running' ? (
                              <Route className="h-5 w-5 text-green-500" />
                            ) : (
                              <Dumbbell className="h-5 w-5 text-blue-500" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-lg">{session.workoutTitle}</h3>
                              {isCompleted && (
                                <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/50">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Completed
                                </Badge>
                              )}
                              {session.skipped && (
                                <Badge variant="outline" className="bg-orange-500/10 text-orange-700 border-orange-500/50">
                                  Skipped
                                </Badge>
                              )}
                              {isMissed && (
                                <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/50">
                                  Missed
                                </Badge>
                              )}
                              {session.stravaId && (
                                <Badge variant="outline" className="bg-orange-500/10 text-orange-700 border-orange-500/50">
                                  <LinkIcon className="h-3 w-3 mr-1" />
                                  Strava
                                </Badge>
                              )}
                              {!!session.sessionCount && session.sessionCount > 1 && (
                                <Badge variant="outline" className="text-muted-foreground">
                                  Session {(session.sessionIndex ?? 0) + 1} of {session.sessionCount}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {format(session.workoutDate, 'MMM d, yyyy')}
                              </span>
                              {session.duration && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {session.duration} min
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {session.notes && (
                          <>
                            <Separator className="my-2" />
                            <p className="text-sm text-muted-foreground italic pl-14">
                              "{session.notes}"
                            </p>
                          </>
                        )}

                        {session.extendedExercises && session.extendedExercises.length > 0 && (
                          <div className="pl-14 pt-2">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Extended with:</p>
                            <div className="flex flex-wrap gap-1">
                              {session.extendedExercises.slice(0, 3).map((ex, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {ex.name}
                                </Badge>
                              ))}
                              {session.extendedExercises.length > 3 && (
                                <Badge variant="secondary" className="text-xs">
                                  +{session.extendedExercises.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Workout Details Section */}
                        {session.workoutDetails && (
                          <>
                            <Separator className="my-3" />
                            <div className="pl-14">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleExpanded(session.id)}
                                className="h-8 px-2 text-xs -ml-2"
                              >
                                {expandedSessions.has(session.id) ? (
                                  <>
                                    <ChevronUp className="h-4 w-4 mr-1" />
                                    Hide Details
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="h-4 w-4 mr-1" />
                                    Show Details
                                  </>
                                )}
                              </Button>

                              {expandedSessions.has(session.id) && (
                                <div className="mt-3 space-y-3">
                                  {hasRuns(session.workoutDetails) && (
                                    <div className="space-y-2">
                                      {session.workoutDetails.runs.map((run: PlannedRun, idx: number) => (
                                        <div key={idx} className="bg-muted/30 rounded-lg p-3">
                                          <div className="flex items-start gap-2">
                                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary mt-0.5">
                                              {idx + 1}
                                            </div>
                                            <div className="flex-1">
                                              <p className="font-medium text-sm">{formatPlannedRun(run)}</p>
                                              <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                                                <span>{run.distance}km</span>
                                                <span className="capitalize">{run.paceZone} pace</span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {hasExercises(session.workoutDetails) && (
                                    <div className="space-y-2">
                                      {session.workoutDetails.exercises.map((exercise: Exercise, idx: number) => {
                                        const formattedDetails = formatExerciseDetails(exercise.details);
                                        return (
                                          <div key={idx} className="bg-muted/30 rounded-lg p-3">
                                            <div className="flex items-start gap-2">
                                              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary mt-0.5">
                                                {idx + 1}
                                              </div>
                                              <div className="flex-1">
                                                <p className="font-medium text-sm mb-1">{exercise.name}</p>
                                                {formattedDetails.length > 0 && (
                                                  <div className="space-y-1">
                                                    {formattedDetails.map((line, lineIdx) => (
                                                      <div key={lineIdx} className="text-xs text-muted-foreground">
                                                        {line.type === 'bullet' ? (
                                                          <div className="flex items-start gap-2">
                                                            <span className="text-primary mt-0.5">•</span>
                                                            <span className="flex-1">{line.content}</span>
                                                          </div>
                                                        ) : (
                                                          <p>{line.content}</p>
                                                        )}
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex md:flex-col gap-2 md:items-end shrink-0">
                        {isCompleted && (
                          <Suspense fallback={<div className="h-10 w-10" />}>
                            <ShareWorkoutDialog session={session} />
                          </Suspense>
                        )}
                        {isCompleted && !session.stravaId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              setSessionToLink(session);
                              setIsLinkerOpen(true);
                            }}
                          >
                            <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
                            Link Strava
                          </Button>
                        )}
                        {isCompleted && canFixTreadmill(session) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              setSessionToFix(session);
                              setIsFixOpen(true);
                            }}
                          >
                            <Wrench className="h-3.5 w-3.5 mr-1.5" />
                            Fix Treadmill
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Load More Button */}
            {hasMore && !loading && (
              <div className="flex justify-center pt-4">
                <Button
                  onClick={loadMore}
                  disabled={loadingMore}
                  variant="outline"
                  size="lg"
                >
                  {loadingMore ? 'Loading...' : 'Load More Workouts'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {sessionToLink && (
      <Suspense fallback={null}>
        <LinkStravaActivityDialog
          isOpen={isLinkerOpen}
          setIsOpen={setIsLinkerOpen}
          session={sessionToLink}
          onLinkSuccess={async () => {
            setIsLinkerOpen(false);
            setSessionToLink(null);
            // Refresh the session list so the Strava badge appears immediately
            await refreshSessions();
          }}
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
          onComplete={async () => {
            setIsFixOpen(false);
            setSessionToFix(null);
            // Refresh so the re-linked (corrected) activity shows immediately
            await refreshSessions();
          }}
        />
      </Suspense>
    )}

    {userId && (
      <Suspense fallback={null}>
        <CustomWorkoutDialog
          isOpen={isLogWorkoutOpen}
          setIsOpen={setIsLogWorkoutOpen}
          userId={userId}
          onLogged={refreshSessions}
        />
      </Suspense>
    )}
    </>
  );
}
