// src/models/types.ts

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  athleteId: number;
}

export interface GarminTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token expiry. */
  expiresAt: Date;
  /** Refresh-token expiry (Garmin issues a new one on each refresh). */
  refreshExpiresAt?: Date;
  /** Garmin user UUID returned by the user-id endpoint. Used to dedupe webhooks. */
  garminUserId?: string;
  scope?: string;
  tokenType?: string;
}

/** Short-lived state stored on the user doc between /connect and /exchange. */
export interface PendingGarminAuth {
  codeVerifier: string;
  state: string;
  /** Epoch ms when the pending auth expires (10 minutes after creation). */
  expiresAt: number;
}

/** Mapping of program day → Garmin workout id, so we can push updates / deletes. */
export interface GarminPlanSync {
  programId: string;
  /**
   * Map keyed by `${day}_${sessionIndex}` (older records use a bare day
   * number, which is normalised on read). `hash` fingerprints the pushed
   * content so an unchanged session is left alone on the next sync instead of
   * being deleted and re-created.
   */
  workouts: Record<
    string,
    { workoutId: string; scheduleId?: string; scheduledDate?: string; hash?: string }
  >;
  /** Workouts whose removal from Garmin failed; retried on every later sync. */
  pendingDeletes?: Array<{ workoutId: string; scheduleId?: string }>;
  lastSyncedAt: Date;
}

export interface PersonalRecords {
  backSquat?: string;
  deadlift?: string;
  benchPress?: string;
  run1k?: string;
  run5k?: string;
  run10k?: string;
  [key: string]: string | undefined;
}

export interface UserRunningProfile {
  benchmarkPaces: {
    mile?: number;
    fiveK?: number;
    tenK?: number;
    halfMarathon?: number;
  };
  injuryHistory?: string[];
}

export type SubscriptionStatus = 'trial' | 'active' | 'canceled' | 'expired' | 'incomplete' | 'paused';

export type UnitSystem = 'metric' | 'imperial';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  experience: 'beginner' | 'intermediate' | 'advanced';
  frequency: '3' | '4' | '5+';
  goal: 'strength' | 'endurance' | 'hybrid';
  unitSystem?: UnitSystem;
  programId?: string | null;
  startDate?: Date;
  personalRecords?: PersonalRecords;
  runningProfile?: UserRunningProfile;
  strava?: StravaTokens;
  lastStravaSync?: Date;
  garmin?: GarminTokens;
  garminConnectedAt?: Date;
  pendingGarminAuth?: PendingGarminAuth;
  garminPlanSync?: GarminPlanSync;
  customProgram?: (Workout | RunningWorkout)[] | null;
  /** Target race, stamped server-side when a race plan is generated. Read by
   *  the raceDateApproaching marketing trigger. */
  raceDate?: Date;
  raceName?: string;
  isAdmin?: boolean;
  subscriptionStatus?: SubscriptionStatus;
  stripeCustomerId?: string;
  subscriptionId?: string | null;
  trialStartDate?: Date;
  cancel_at_period_end?: boolean;
  cancellation_effective_date?: Date;
  /**
   * Finished workouts, maintained server-side by the marketing activity
   * reconciler (lib/marketing/activity.ts) from the workoutSessions stream.
   *
   * Read by segments, engagement tags and the `noWorkoutAfterNDays` /
   * `churnRisk` triggers. It was previously computed only inside getAllUsers()
   * for the admin table and never persisted, so every athlete document read
   * back `undefined` and all four of those consumers were silently wrong.
   */
  completedWorkouts?: number;
  /** When the most recent finished workout was counted. Server-maintained. */
  lastWorkoutAt?: Date;
  /**
   * The athlete's IANA timezone (e.g. "Europe/London"), refreshed from the
   * browser whenever they use the app. Server code runs in UTC and cannot
   * otherwise work out which calendar day they are on — see lib/program-day.ts.
   */
  timeZone?: string;
  notificationTime?: { hour: number; minute: number };
  /** "Do it tomorrow": the day (YYYY-MM-DD, athlete's calendar) they committed to train, for the reminder job. */
  trainingCommitment?: { date: string; workoutTitle: string } | null;
  // Analytics fields
  lastSeenAt?: Date;
  lastLoginAt?: Date;
  /** User clicked "Jump Straight In" and skipped the fitness assessment */
  onboardingSkipped?: boolean;
  /** Highest onboarding step reached (1–6); 6 = completed */
  onboardingCompletedStep?: number;
  /** Platform at last session: web | pwa | ios | android */
  platform?: string;
  sessionCount?: number;
  totalSessionMinutes?: number;
  // First-touch marketing attribution, captured from the marketing site at
  // signup (see src/lib/attribution.ts). Lets conversions be traced back to
  // the campaign/page that drove the trial signup.
  acquisitionSource?: string;
  acquisitionMedium?: string;
  acquisitionCampaign?: string;
  acquisitionTerm?: string;
  acquisitionContent?: string;
  acquisitionLandingPage?: string;
  acquisitionReferrer?: string;
  // Marketing email consent. Distinct from transactional mail (verification,
  // onboarding nudges, receipts), which is sent regardless because it is
  // necessary to the service the athlete signed up for. Only campaigns and
  // journeys honour this flag. Mirrored onto the athlete's
  // `marketingSubscribers` record so a send never has to join across
  // collections to decide whether it may mail someone.
  marketingConsent?: boolean;
  marketingConsentAt?: Date;
  marketingUnsubscribedAt?: Date;
}

export type ProgramType = 'hyrox' | 'running' | 'hybrid';

export type SessionType = 'run' | 'strength' | 'cardio' | 'rest';

/** Who a program is available to.
 *  'public' (or absent, for programs created before custom programs existed) —
 *  every signed-in athlete can browse and start it.
 *  'custom' — only the athletes in `assignedUserIds` can see or start it. */
export type ProgramVisibility = 'public' | 'custom';

export interface Program {
  id: string;
  name: string;
  description: string;
  programType: ProgramType;
  workouts: (Workout | RunningWorkout)[];
  /** Absent means 'public' — existing programs keep working untouched. */
  visibility?: ProgramVisibility;
  /** Athletes this custom program is assigned to. Only meaningful when
   *  visibility is 'custom'. */
  assignedUserIds?: string[];
  /** Athletes who were unassigned while this was their active program. They
   *  keep read access so their dashboard and calendar keep working, but the
   *  program no longer appears in their program list, so they cannot restart
   *  it once they move on. Managed server-side — see
   *  `src/lib/program-visibility.ts`. */
  retainedUserIds?: string[];
}

export type TargetRace = 'mile' | '5k' | '10k' | 'half-marathon' | 'marathon' | 'ultra';

export interface RunningProgram extends Omit<Program, 'workouts'> {
  programType: 'running';
  targetRace?: TargetRace;
  workouts: RunningWorkout[];
}

export interface Workout {
  day: number;
  title: string;
  exercises: Exercise[];
  programType: 'hyrox';
}

export interface RunningWorkout {
  day: number;
  title: string;
  runs: PlannedRun[];
  programType: 'running';
  targetRace?: TargetRace;
  exercises: [];
}

export type WorkoutDay = Workout | RunningWorkout;

export type PaceZone = 'recovery' | 'easy' | 'marathon' | 'threshold' | 'interval' | 'repetition';

export interface PlannedRun {
  type: 'easy' | 'tempo' | 'intervals' | 'long' | 'recovery';
  distance: number;
  paceZone: PaceZone;
  description: string;
  targetPace?: number;
  effortLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  noIntervals?: number;
}

export interface Exercise {
  name: string;
  details: string;
  /** Discriminates strength vs cardio sessions within exercise rows; drives Garmin sport routing. */
  sessionType?: 'strength' | 'cardio';
  /** Explicit Garmin sport type string (e.g. 'STRENGTH_TRAINING', 'CARDIO_TRAINING'). */
  garminSport?: string;
  // Optional structured fields for Garmin sync — invisible to all UI display components
  garminExerciseCategory?: string;
  garminExerciseName?: string;
  weightKg?: number;
  restSeconds?: number;
  sets?: number;
  reps?: number;
}

// ── Timer types ───────────────────────────────────────────────────────────────

export type TimerMode = 'for-time' | 'amrap' | 'emom' | 'tabata' | 'reps';

export interface TimerSet {
  setNumber: number;
  duration: number; // seconds
}

export interface TimerRound {
  roundNumber: number;
  sets: TimerSet[];
  startTime: number;   // seconds elapsed when round started
  totalDuration: number; // seconds
}

/** Persisted timer result saved onto a WorkoutSession */
export interface TimerRecord {
  timerMode: TimerMode;
  totalTime: number;   // seconds
  completedAt: string; // ISO date string
  workoutLog?: TimerRound[];               // For Time: round/set splits
  amrapRounds?: number;                    // AMRAP: rounds completed
  repLog?: { set: number; reps: number }[]; // Reps: per-set counts
}

// ─────────────────────────────────────────────────────────────────────────────

export interface WorkoutSession {
    id: string;
    userId: string;
    programId: string;
    workoutDate: Date;
    workoutTitle: string;
    programType: ProgramType;
    startedAt: Date;
    finishedAt?: Date;
    notes?: string;
    duration?: string;
    /** Position of this session among sibling sessions scheduled for the same day (e.g. a Run + a Weight Training session both on day 5). Undefined/0 = the day's only (or first) session. */
    sessionIndex?: number;
    /** Total number of sibling sessions scheduled for this day, as of session creation. */
    sessionCount?: number;
    extendedExercises?: Exercise[];
    skipped?: boolean;
    workoutDetails?: Workout | RunningWorkout;
    exerciseChecklist?: Record<string, boolean>;
    timerRecord?: TimerRecord;
    stravaId?: string;
    uploadedToStrava?: boolean;
    stravaUploadedAt?: Date;
    stravaActivity?: {
        distance?: number;
        moving_time?: number;
        name?: string;
    };
    /** Set when the linked Strava activity was rebuilt by the treadmill file fixer. */
    treadmillFix?: {
        originalStravaId: string;
        fixedStravaId: string;
        fixedAt: Date;
    };
}

export interface Article {
  id: string;
  title: string;
  content: string;
  prompt: string;
  tags: string[];
  createdAt: Date;
}

// ── Journal types ─────────────────────────────────────────────────────────────

export type MoodLevel = 'great' | 'good' | 'okay' | 'tired' | 'struggling';

export type JournalTag =
  | 'form'
  | 'mental'
  | 'nutrition'
  | 'achievement'
  | 'challenge'
  | 'recovery'
  | 'motivation'
  | 'technique'
  | 'injury'
  | 'progress';

export interface JournalEntry {
  id: string;
  userId: string;
  date: Date;                    // Date the athlete is journaling about (defaults to today)
  content: string;               // Free-form journal text
  mood?: MoodLevel;              // Optional mood indicator
  tags?: JournalTag[];           // Optional category tags
  aiInsight?: string;            // Legacy: combined AI insight (kept for backward compat)
  aiInsightGeneratedAt?: Date;   // Legacy timestamp
  aiInterpretation?: string;     // What the coach hears / reads between the lines
  aiCoachResponse?: string;      // Direct coaching advice
  aiAnalysisGeneratedAt?: Date;  // When the split analysis was last generated
  createdAt: Date;
  updatedAt: Date;
}
