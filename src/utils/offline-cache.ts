// src/utils/offline-cache.ts
'use client';

import { User, WorkoutSession, Program } from '@/models/types';
import { logger } from '@/lib/logger';

const CACHE_KEYS = {
  USER: 'cached_user',
  SESSIONS: 'cached_sessions',
  PROGRAM: 'cached_program',
  TODAYS_WORKOUT: 'cached_todays_workout',
  TODAYS_SESSION: 'cached_todays_session',
  TODAYS_SESSIONS: 'cached_todays_sessions',
  LAST_SYNC: 'last_sync_time',
  PENDING_UPDATES: 'pending_updates',
};

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Cache utilities for offline PWA support
 */
export const OfflineCache = {
  /**
   * Save user data to local cache
   */
  saveUser(user: User): void {
    try {
      const entry: CacheEntry<User> = {
        data: user,
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEYS.USER, JSON.stringify(entry));
    } catch (error) {
      logger.error('Error caching user:', error);
    }
  },

  /**
   * Get cached user data
   */
  getUser(): User | null {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.USER);
      if (!cached) return null;

      const entry: CacheEntry<User> = JSON.parse(cached);

      // Check if cache is still valid
      if (Date.now() - entry.timestamp > CACHE_DURATION) {
        this.clearUser();
        return null;
      }

      return entry.data;
    } catch (error) {
      logger.error('Error reading cached user:', error);
      return null;
    }
  },

  /**
   * Save workout sessions to cache
   */
  saveSessions(sessions: WorkoutSession[]): void {
    try {
      const entry: CacheEntry<WorkoutSession[]> = {
        data: sessions.map(s => ({
          ...s,
          workoutDate: s.workoutDate instanceof Date ? s.workoutDate.toISOString() : s.workoutDate,
          startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
          finishedAt: s.finishedAt instanceof Date ? s.finishedAt.toISOString() : s.finishedAt,
        })) as any,
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEYS.SESSIONS, JSON.stringify(entry));
    } catch (error) {
      logger.error('Error caching sessions:', error);
    }
  },

  /**
   * Get cached workout sessions
   */
  getSessions(): WorkoutSession[] | null {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.SESSIONS);
      if (!cached) return null;

      const entry: CacheEntry<any[]> = JSON.parse(cached);

      if (Date.now() - entry.timestamp > CACHE_DURATION) {
        this.clearSessions();
        return null;
      }

      // Convert date strings back to Date objects
      return entry.data.map(s => ({
        ...s,
        workoutDate: new Date(s.workoutDate),
        startedAt: new Date(s.startedAt),
        finishedAt: s.finishedAt ? new Date(s.finishedAt) : undefined,
      }));
    } catch (error) {
      logger.error('Error reading cached sessions:', error);
      return null;
    }
  },

  /**
   * Save program data to cache
   */
  saveProgram(program: Program): void {
    try {
      const entry: CacheEntry<Program> = {
        data: program,
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEYS.PROGRAM, JSON.stringify(entry));
    } catch (error) {
      logger.error('Error caching program:', error);
    }
  },

  /**
   * Get cached program
   */
  getProgram(): Program | null {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.PROGRAM);
      if (!cached) return null;

      const entry: CacheEntry<Program> = JSON.parse(cached);

      if (Date.now() - entry.timestamp > CACHE_DURATION) {
        this.clearProgram();
        return null;
      }

      return entry.data;
    } catch (error) {
      logger.error('Error reading cached program:', error);
      return null;
    }
  },

  /**
   * Check if app is online
   */
  isOnline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine;
  },

  /**
   * Update last sync timestamp
   */
  updateSyncTime(): void {
    localStorage.setItem(CACHE_KEYS.LAST_SYNC, Date.now().toString());
  },

  /**
   * Get time since last sync in minutes
   */
  getTimeSinceSync(): number | null {
    const lastSync = localStorage.getItem(CACHE_KEYS.LAST_SYNC);
    if (!lastSync) return null;

    const minutes = Math.floor((Date.now() - parseInt(lastSync, 10)) / (60 * 1000));
    return minutes;
  },

  /**
   * Clear all cached data
   */
  clearAll(): void {
    Object.values(CACHE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  },

  clearUser(): void {
    localStorage.removeItem(CACHE_KEYS.USER);
  },

  clearSessions(): void {
    localStorage.removeItem(CACHE_KEYS.SESSIONS);
  },

  clearProgram(): void {
    localStorage.removeItem(CACHE_KEYS.PROGRAM);
  },

  /**
   * Save today's workout - CRITICAL for offline access
   * Never expires on the same day
   */
  saveTodaysWorkout(workout: any, date: Date = new Date()): void {
    try {
      const entry: CacheEntry<any> = {
        data: {
          workout,
          date: date.toISOString().split('T')[0], // Store just the date
        },
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEYS.TODAYS_WORKOUT, JSON.stringify(entry));
    } catch (error) {
      logger.error('Error caching today\'s workout:', error);
    }
  },

  /**
   * Get today's workout from cache
   * Returns null if cached workout is not for today
   */
  getTodaysWorkout(): any | null {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.TODAYS_WORKOUT);
      if (!cached) return null;

      const entry: CacheEntry<any> = JSON.parse(cached);
      const today = new Date().toISOString().split('T')[0];

      // Check if cached workout is for today
      if (entry.data.date !== today) {
        this.clearTodaysWorkout();
        return null;
      }

      return entry.data.workout;
    } catch (error) {
      logger.error('Error reading cached today\'s workout:', error);
      return null;
    }
  },

  clearTodaysWorkout(): void {
    localStorage.removeItem(CACHE_KEYS.TODAYS_WORKOUT);
  },

  /**
   * Save today's session for offline access
   */
  saveTodaysSession(session: WorkoutSession): void {
    try {
      const entry: CacheEntry<any> = {
        data: {
          ...session,
          workoutDate: session.workoutDate instanceof Date ? session.workoutDate.toISOString() : session.workoutDate,
          startedAt: session.startedAt instanceof Date ? session.startedAt.toISOString() : session.startedAt,
          finishedAt: session.finishedAt instanceof Date ? session.finishedAt?.toISOString() : session.finishedAt,
        },
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEYS.TODAYS_SESSION, JSON.stringify(entry));
    } catch (error) {
      logger.error('Error caching today\'s session:', error);
    }
  },

  /**
   * Get today's session from cache
   */
  getTodaysSession(): WorkoutSession | null {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.TODAYS_SESSION);
      if (!cached) return null;

      const entry: CacheEntry<any> = JSON.parse(cached);
      const today = new Date().toISOString().split('T')[0];
      const sessionDate = new Date(entry.data.workoutDate).toISOString().split('T')[0];

      // Only return if it's for today
      if (sessionDate !== today) {
        this.clearTodaysSession();
        return null;
      }

      return {
        ...entry.data,
        workoutDate: new Date(entry.data.workoutDate),
        startedAt: new Date(entry.data.startedAt),
        finishedAt: entry.data.finishedAt ? new Date(entry.data.finishedAt) : undefined,
      };
    } catch (error) {
      logger.error('Error reading cached today\'s session:', error);
      return null;
    }
  },

  clearTodaysSession(): void {
    localStorage.removeItem(CACHE_KEYS.TODAYS_SESSION);
  },

  /**
   * Save all of today's sessions (one per sub-workout, e.g. Run + Weight Training) for offline access.
   */
  saveTodaysSessions(sessions: WorkoutSession[]): void {
    try {
      const entry: CacheEntry<any[]> = {
        data: sessions.map(s => ({
          ...s,
          workoutDate: s.workoutDate instanceof Date ? s.workoutDate.toISOString() : s.workoutDate,
          startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
          finishedAt: s.finishedAt instanceof Date ? s.finishedAt?.toISOString() : s.finishedAt,
        })),
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEYS.TODAYS_SESSIONS, JSON.stringify(entry));
    } catch (error) {
      logger.error('Error caching today\'s sessions:', error);
    }
  },

  /**
   * Get today's sessions from cache. Returns null if not cached or not for today.
   */
  getTodaysSessions(): WorkoutSession[] | null {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.TODAYS_SESSIONS);
      if (!cached) return null;

      const entry: CacheEntry<any[]> = JSON.parse(cached);
      if (!entry.data || entry.data.length === 0) return null;

      const today = new Date().toISOString().split('T')[0];
      const sessionDate = new Date(entry.data[0].workoutDate).toISOString().split('T')[0];

      if (sessionDate !== today) {
        this.clearTodaysSessions();
        return null;
      }

      return entry.data.map(s => ({
        ...s,
        workoutDate: new Date(s.workoutDate),
        startedAt: new Date(s.startedAt),
        finishedAt: s.finishedAt ? new Date(s.finishedAt) : undefined,
      }));
    } catch (error) {
      logger.error('Error reading cached today\'s sessions:', error);
      return null;
    }
  },

  clearTodaysSessions(): void {
    localStorage.removeItem(CACHE_KEYS.TODAYS_SESSIONS);
  },

  /**
   * Queue an update for when connection is restored
   */
  queuePendingUpdate(update: { type: string; data: any; timestamp: number }): void {
    try {
      const pending = this.getPendingUpdates();
      pending.push(update);
      localStorage.setItem(CACHE_KEYS.PENDING_UPDATES, JSON.stringify(pending));
    } catch (error) {
      logger.error('Error queuing pending update:', error);
    }
  },

  /**
   * Get all pending updates
   */
  getPendingUpdates(): Array<{ type: string; data: any; timestamp: number }> {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.PENDING_UPDATES);
      return cached ? JSON.parse(cached) : [];
    } catch (error) {
      logger.error('Error reading pending updates:', error);
      return [];
    }
  },

  /**
   * Clear all pending updates (after successful sync)
   */
  clearPendingUpdates(): void {
    localStorage.removeItem(CACHE_KEYS.PENDING_UPDATES);
  },
};
