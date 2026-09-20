// src/contexts/user-context.tsx
'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { getAuthInstance } from '@/lib/firebase';
import { getUserClient } from '@/services/user-service-client';
import { getProgramClient } from '@/services/program-service-client';
import { getTodaysOneOffSession, getOrCreateProgramSessionsForDay, getRecentUserSessions, type WorkoutSession } from '@/services/session-service-client';
import { getWorkoutForDay } from '@/lib/workout-utils';
import type { User, Program, Workout, RunningWorkout, WorkoutDay } from '@/models/types';
import { calculateTrainingPaces } from '@/lib/pace-utils';
import { calculateStreakData, type StreakData } from '@/utils/streak-calculator';
import { OfflineCache } from '@/utils/offline-cache';
import { logger } from '@/lib/logger';

interface UserContextType {
    user: User | null;
    program: Program | null;
    todaysWorkout: { day: number; workout: Workout | RunningWorkout | null; sessions: WorkoutDay[] } | null;
    todaysSession: WorkoutSession | null;
    /** One persisted WorkoutSession per entry in todaysWorkout.sessions, so multi-type days (e.g. Run + Weight Training) can be started/finished/linked to Strava independently. */
    todaysWorkoutSessions: WorkoutSession[];
    allSessions: WorkoutSession[];
    streakData: StreakData;
    trainingPaces: Record<string, number> | null;
    loading: boolean;
    refreshData: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [program, setProgram] = useState<Program | null>(null);
    const [todaysWorkout, setTodaysWorkout] = useState<{ day: number; workout: Workout | RunningWorkout | null; sessions: WorkoutDay[] } | null>(null);
    const [todaysSession, setTodaysSession] = useState<WorkoutSession | null>(null);
    const [todaysWorkoutSessions, setTodaysWorkoutSessions] = useState<WorkoutSession[]>([]);
    const [allSessions, setAllSessions] = useState<WorkoutSession[]>([]);
    const [streakData, setStreakData] = useState<StreakData>({ currentStreak: 0, longestStreak: 0, totalWorkouts: 0, thisWeekWorkouts: 0, thisMonthWorkouts: 0 });
    const [trainingPaces, setTrainingPaces] = useState<Record<string, number> | null>(null);
    const [loading, setLoading] = useState(true);
    // Prevent concurrent refreshes (e.g. rapid re-mounts or multiple callers)
    const isRefreshingRef = useRef(false);

    const refreshData = useCallback(async () => {
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;

        const auth = await getAuthInstance();
        if (!auth.currentUser) {
            isRefreshingRef.current = false;
            return;
        }

        setLoading(true);

        // Try to load cached data first for offline-first experience
        const cachedWorkout = OfflineCache.getTodaysWorkout();
        const cachedSession = OfflineCache.getTodaysSession();
        const cachedSessions = OfflineCache.getTodaysSessions();

        if (cachedWorkout) {
            setTodaysWorkout(cachedWorkout);
        }
        if (cachedSession) {
            setTodaysSession(cachedSession);
        }
        if (cachedSessions) {
            setTodaysWorkoutSessions(cachedSessions);
        }

        try {
            const userId = auth.currentUser.uid;
            const currentUser = await getUserClient(userId);
            setUser(currentUser);

            if (!currentUser) return;

            if (currentUser.runningProfile) {
                const paces = calculateTrainingPaces(currentUser);
                setTrainingPaces(paces);
            }

            // Sessions drive streaks and history only, so they are deliberately NOT
            // awaited here: this read is the largest of the set, and awaiting it put
            // it in front of the program resolution that decides what the dashboard
            // actually shows. It now lands after the page is interactive.
            //
            // A failure (a Firestore index still building, a transient network drop)
            // must not stop today's workout resolving below: the difference is a
            // stale streak versus the app looking like the user has no program at all.
            void getRecentUserSessions(userId)
                .then(sessions => {
                    setAllSessions(sessions);
                    setStreakData(calculateStreakData(sessions));
                })
                .catch(error => {
                    logger.error('Failed to load workout sessions for streaks:', error);
                });

            // Update sync time
            OfflineCache.updateSyncTime();

            let workoutSessions: WorkoutSession[] = [];
            let currentWorkoutInfo;
            let currentProgram: Program | null = null;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // The one-off check and the program fetch do not depend on each other, so
            // they run together rather than as two serial round trips. A one-off wins
            // if there is one, and the program is simply discarded in that case.
            const [oneOffSession, fetchedProgram] = await Promise.all([
                // Treated as "no one-off today" so the program schedule below still runs.
                getTodaysOneOffSession(userId, today).catch(error => {
                    logger.error("Failed to check for today's one-off workout:", error);
                    return null;
                }),
                currentUser.programId && currentUser.startDate && !currentUser.customProgram
                    ? getProgramClient(currentUser.programId).catch(error => {
                        logger.error('Failed to load the assigned program:', error);
                        return null;
                    })
                    : Promise.resolve(null),
            ]);

            if (oneOffSession) {
                workoutSessions = [oneOffSession];
                currentWorkoutInfo = {
                    day: 0,
                    workout: oneOffSession.workoutDetails as Workout,
                    sessions: oneOffSession.workoutDetails ? [oneOffSession.workoutDetails as Workout] : [],
                };
            } else if (currentUser.programId && currentUser.startDate) {
                // A personalised customProgram overrides the stored plan, and is already
                // on the user document — which is why the fetch above skips it entirely.
                currentProgram = currentUser.customProgram
                    ? ({ id: currentUser.programId, workouts: currentUser.customProgram } as Program)
                    : fetchedProgram;

                // Only proceed if a program was found
                if (currentProgram) {
                    setProgram(currentProgram);

                    const scheduledWorkoutInfo = getWorkoutForDay(currentProgram, currentUser.startDate, today);

                    // Always resolve via the persisted layer, even when the program's default schedule
                    // has nothing for today — a training-calendar rearrangement may have moved a workout
                    // INTO today from another day, which only shows up as a persisted session, not as
                    // anything from getWorkoutForDay's program-default lookup.
                    try {
                        workoutSessions = await getOrCreateProgramSessionsForDay(userId, currentProgram.id, today, scheduledWorkoutInfo.sessions);
                        currentWorkoutInfo = {
                            day: scheduledWorkoutInfo.day,
                            workout: workoutSessions[0]?.workoutDetails ?? null,
                            sessions: workoutSessions.map(s => s.workoutDetails).filter((w): w is WorkoutDay => !!w),
                        };
                    } catch (error) {
                        // The persisted layer is unavailable, so fall back to the program's
                        // own schedule for today. Showing the planned workout (without the
                        // start/finish state that lives on the session docs) beats rendering
                        // "no workout scheduled" to someone who does have an active program.
                        logger.error("Failed to resolve today's program sessions:", error);
                        workoutSessions = [];
                        currentWorkoutInfo = {
                            day: scheduledWorkoutInfo.day,
                            workout: scheduledWorkoutInfo.sessions[0] ?? null,
                            sessions: scheduledWorkoutInfo.sessions,
                        };
                    }
                }
            }

            if (currentWorkoutInfo) {
                setTodaysWorkout(currentWorkoutInfo);
                // Cache today's workout for offline access
                OfflineCache.saveTodaysWorkout(currentWorkoutInfo);
            } else {
                setTodaysWorkout(null);
            }
            setTodaysWorkoutSessions(workoutSessions);
            OfflineCache.saveTodaysSessions(workoutSessions);
            if (workoutSessions.length > 0) {
                setTodaysSession(workoutSessions[0]);
                // Cache today's session for offline access
                OfflineCache.saveTodaysSession(workoutSessions[0]);
            } else {
                setTodaysSession(null);
            }

        } catch (error) {
            logger.error("Error fetching user data:", error);
        } finally {
            setLoading(false);
            isRefreshingRef.current = false;
        }
    }, []); // stable — only uses setters (stable) and module-level functions

    useEffect(() => {
        const initialize = async () => {
            const auth = await getAuthInstance();
            const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
                if (firebaseUser) {
                    refreshData();
                } else {
                    setUser(null);
                    setProgram(null);
                    setTodaysWorkout(null);
                    setTodaysSession(null);
                    setTodaysWorkoutSessions([]);
                    setAllSessions([]);
                    setStreakData({ currentStreak: 0, longestStreak: 0, totalWorkouts: 0, thisWeekWorkouts: 0, thisMonthWorkouts: 0 });
                    setTrainingPaces(null);
                    setLoading(false);
                }
            });
            return unsubscribe;
        };

        let unsubscribe: () => void;
        initialize().then(unsub => unsubscribe = unsub);

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    const value = useMemo(() => ({
        user,
        program,
        todaysWorkout,
        todaysSession,
        todaysWorkoutSessions,
        allSessions,
        streakData,
        trainingPaces,
        loading,
        refreshData
    }), [user, program, todaysWorkout, todaysSession, todaysWorkoutSessions, allSessions, streakData, trainingPaces, loading]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
}

// === PERFORMANCE OPTIMIZED SELECTOR HOOKS ===
// Use these hooks to subscribe to specific parts of the context
// This prevents unnecessary re-renders when unrelated state changes

/**
 * Subscribe to user profile only
 * Re-renders only when user or trainingPaces change
 */
export function useUserProfile() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUserProfile must be used within a UserProvider');
    }
    return useMemo(() => ({
        user: context.user,
        trainingPaces: context.trainingPaces,
        loading: context.loading,
        refreshData: context.refreshData
    }), [context.user, context.trainingPaces, context.loading, context.refreshData]);
}

/**
 * Subscribe to today's workout only
 * Re-renders only when todaysWorkout, todaysSession, or program change
 */
export function useTodaysWorkout() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useTodaysWorkout must be used within a UserProvider');
    }
    return useMemo(() => ({
        program: context.program,
        todaysWorkout: context.todaysWorkout,
        todaysSession: context.todaysSession,
        todaysWorkoutSessions: context.todaysWorkoutSessions,
        loading: context.loading,
        refreshData: context.refreshData
    }), [context.program, context.todaysWorkout, context.todaysSession, context.todaysWorkoutSessions, context.loading, context.refreshData]);
}

/**
 * Subscribe to sessions and streaks only
 * Re-renders only when allSessions or streakData change
 */
export function useSessions() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useSessions must be used within a UserProvider');
    }
    return useMemo(() => ({
        allSessions: context.allSessions,
        streakData: context.streakData,
        loading: context.loading,
        refreshData: context.refreshData
    }), [context.allSessions, context.streakData, context.loading, context.refreshData]);
}

/**
 * Subscribe to user and today's workout (common combination)
 * Re-renders only when user, program, todaysWorkout, or todaysSession change
 */
export function useUserAndWorkout() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUserAndWorkout must be used within a UserProvider');
    }
    return useMemo(() => ({
        user: context.user,
        program: context.program,
        todaysWorkout: context.todaysWorkout,
        todaysSession: context.todaysSession,
        trainingPaces: context.trainingPaces,
        loading: context.loading,
        refreshData: context.refreshData
    }), [context.user, context.program, context.todaysWorkout, context.todaysSession, context.trainingPaces, context.loading, context.refreshData]);
}
