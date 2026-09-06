// src/ai/coach-tools.ts
//
// The tools the Edge Coach can reach for mid-conversation.
//
// The briefing in coach-context.ts covers the last four weeks and the week
// ahead, which answers most questions. Everything past that horizon — "how did
// my sled pushes go in July?", "what did I actually run on Tuesday?", "what's
// in block 3?" — needs a lookup, and these are those lookups. They are built
// per request with `dynamicTool` so each one closes over the authenticated
// athlete's id: the model never gets to name whose data it is reading.

import { z } from 'genkit';
import { addDays, format, startOfDay, subDays } from 'date-fns';

import { ai } from '@/ai/genkit';
import { logger } from '@/lib/logger';
import { getWorkoutForDay } from '@/lib/workout-utils';
import {
  computeDailyPMC,
  computeTrainingSummary,
  formatTrainingSummaryForAI,
} from '@/services/training-load-service';
import { getUser } from '@/services/user-service';
import {
  buildSchedule,
  getEffectiveProgram,
  getRecentJournalEntries,
  getSessionsInRange,
  getStravaActivities,
} from '@/services/coach-context';
import {
  describeWorkout,
  matchesExerciseName,
  summariseJournalEntry,
  summariseSession,
} from '@/lib/coach/insights';
import { analyzeAndAdjust } from '@/ai/flows/analyze-and-adjust';
import type { Exercise, PlannedRun, Workout, RunningWorkout } from '@/models/types';

/** A plan change the coach has drafted but not applied — the athlete confirms it in the UI. */
export interface PlanProposal {
  analysis: string;
  adjustments: Array<{
    day: number;
    originalTitle: string;
    modifiedTitle: string;
    reason: string;
    modifiedWorkout: Workout | RunningWorkout;
  }>;
}

/** Collects what the tools did during one turn, for the API response. */
export interface CoachToolTrace {
  used: string[];
  planProposal: PlanProposal | null;
}

const MAX_DAYS_LOOKBACK = 365;

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : startOfDay(parsed);
}

/** Sessions a single tool call will return before it starts summarising instead. */
const MAX_HISTORY_ROWS = 120;

function clampRange(from: Date, to: Date, today: Date): { from: Date; to: Date } {
  const earliest = subDays(today, MAX_DAYS_LOOKBACK);
  const latest = addDays(today, 120);
  // A reversed range is a model slip, not a reason to answer "nothing found".
  const [start, end] = from <= to ? [from, to] : [to, from];
  return {
    from: start < earliest ? earliest : start,
    to: end > latest ? latest : end,
  };
}

/**
 * Builds the coach's toolset for one athlete.
 *
 * `trace` is mutated as tools run so the caller can tell the athlete what the
 * coach looked at, and can surface any drafted plan change for confirmation.
 */
export function buildCoachTools(userId: string, trace: CoachToolTrace, now = new Date()) {
  const today = startOfDay(now);

  const record = (name: string) => {
    if (!trace.used.includes(name)) trace.used.push(name);
  };

  const trainingHistory = ai.dynamicTool(
    {
      name: 'getTrainingHistory',
      description:
        "Look up the athlete's scheduled and completed sessions for any date range, including their own notes and whether each was completed, skipped or missed. Use for questions about periods outside the last four weeks, or when you need the detail of a specific week.",
      inputSchema: z.object({
        fromDate: z.string().describe('Start of the range, YYYY-MM-DD.'),
        toDate: z.string().describe('End of the range, YYYY-MM-DD.'),
        includePrescribedDetail: z
          .boolean()
          .optional()
          .describe('Include the exercises/runs prescribed for each session.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('training history');
      const { from, to } = clampRange(
        parseDate(input.fromDate, subDays(today, 28)),
        parseDate(input.toDate, today),
        today,
      );
      const sessions = await getSessionsInRange(userId, from, to);
      if (sessions.length === 0) {
        return `No sessions on record between ${format(from, 'd MMM yyyy')} and ${format(to, 'd MMM yyyy')}.`;
      }

      // A year-wide range would otherwise return several hundred lines; keep the
      // most recent and say what was left out so the coach can narrow the range.
      const shown = sessions.slice(-MAX_HISTORY_ROWS);
      const omitted = sessions.length - shown.length;
      const lines = shown.map(session =>
        summariseSession(session, { today, includeDetail: input.includePrescribedDetail }),
      );

      return omitted > 0
        ? `Showing the most recent ${shown.length} of ${sessions.length} sessions in that range; ask for a narrower range to see the earlier ${omitted}.\n${lines.join('\n')}`
        : lines.join('\n');
    },
  );

  const upcomingPlan = ai.dynamicTool(
    {
      name: 'getUpcomingPlan',
      description:
        'Get what is scheduled for the athlete over the coming days, with the full prescribed content of each session. Use when advising on how to approach an upcoming session or how to rearrange a week.',
      inputSchema: z.object({
        days: z.number().optional().describe('How many days ahead to look. Default 7, max 42.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('upcoming plan');
      const user = await getUser(userId);
      if (!user) return 'No athlete profile found.';
      const program = await getEffectiveProgram(user);
      if (!program || !user.startDate) return 'The athlete has no active program scheduled.';

      const horizon = Math.min(Math.max(input.days ?? 7, 1), 42);
      const to = addDays(today, horizon);
      const sessions = await getSessionsInRange(userId, today, to);
      const schedule = buildSchedule(today, to, sessions, program, user.startDate, today);

      return schedule
        .map(day => {
          const label = `${format(day.date, 'EEE d MMM')}${day.programDay ? ` (program day ${day.programDay})` : ''}`;
          if (day.sessions.length === 0) return `${label}: rest`;
          return day.sessions
            .map(s => `${label}: ${s.title} [${s.status}] — ${s.detail}`)
            .join('\n');
        })
        .join('\n');
    },
  );

  const movementHistory = ai.dynamicTool(
    {
      name: 'findMovementHistory',
      description:
        'Find every time the athlete has trained a specific movement or session type (e.g. "sled push", "wall balls", "threshold run") — when, what was prescribed, and what they said about it. Use for questions about progress on a lift or station.',
      inputSchema: z.object({
        movement: z.string().describe('Movement or exercise name, e.g. "sled push".'),
        days: z.number().optional().describe('How far back to search. Default 120, max 365.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record(`history of "${input.movement}"`);
      const days = Math.min(Math.max(input.days ?? 120, 7), MAX_DAYS_LOOKBACK);
      const sessions = await getSessionsInRange(userId, subDays(today, days), today);

      const hits: string[] = [];
      for (const session of sessions.reverse()) {
        const exercises: Exercise[] = [
          ...(session.workoutDetails?.exercises ?? []),
          ...(session.extendedExercises ?? []),
        ];
        const runs: PlannedRun[] =
          (session.workoutDetails as { runs?: PlannedRun[] } | undefined)?.runs ?? [];

        const matchedExercises = exercises.filter(e => matchesExerciseName(e.name, input.movement));
        const matchedRuns = runs.filter(
          run =>
            matchesExerciseName(run.description ?? '', input.movement) ||
            matchesExerciseName(run.type ?? '', input.movement),
        );
        const titleMatch = matchesExerciseName(session.workoutTitle, input.movement);

        if (matchedExercises.length === 0 && matchedRuns.length === 0 && !titleMatch) continue;

        const detail = [
          ...matchedExercises.map(e => `${e.name} — ${e.details}`),
          ...matchedRuns.map(r => `${r.distance}km ${r.description} (RPE ${r.effortLevel})`),
        ].join('; ');

        hits.push(
          `${format(session.workoutDate, 'd MMM yyyy')} | ${session.workoutTitle} | ${
            session.finishedAt ? 'completed' : session.skipped ? 'skipped' : 'not completed'
          } | ${detail || 'session title match'}${
            session.notes?.trim() ? ` | notes: "${session.notes.trim()}"` : ''
          }`,
        );

        if (hits.length >= 25) break;
      }

      if (hits.length === 0) {
        return `No sessions in the last ${days} days involved "${input.movement}". Note that prescriptions are stored, not logged loads — if the athlete didn't write weights in their notes, we don't have them.`;
      }
      return `Sessions involving "${input.movement}" (most recent first):\n${hits.join('\n')}`;
    },
  );

  const stravaActivities = ai.dynamicTool(
    {
      name: 'getStravaActivities',
      description:
        'Get the athlete\'s actual recorded activities from Strava — distance, moving time, pace, heart rate and perceived effort. Use when a question is about what they really ran/rode/lifted rather than what was prescribed.',
      inputSchema: z.object({
        days: z.number().optional().describe('How far back to look. Default 30, max 60.'),
        activityType: z
          .string()
          .optional()
          .describe('Filter by Strava type, e.g. "Run", "Ride", "WeightTraining".'),
        limit: z.number().optional().describe('Maximum activities to return. Default 20.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('Strava activities');
      const days = Math.min(Math.max(input.days ?? 30, 1), 60);
      const activities = await getStravaActivities(userId, days);
      if (activities.length === 0) {
        return 'No Strava activities available — the athlete either has not connected Strava or has nothing recorded in this window.';
      }

      const cutoff = subDays(today, days);
      const filtered = activities
        .filter(activity => new Date(activity.start_date) >= cutoff)
        .filter(activity =>
          input.activityType
            ? (activity.sport_type || activity.type || '')
                .toLowerCase()
                .includes(input.activityType.toLowerCase())
            : true,
        )
        .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50));

      if (filtered.length === 0) return 'No matching Strava activities in that window.';

      return filtered
        .map(activity => {
          const km = activity.distance ? activity.distance / 1000 : 0;
          const minutes = activity.moving_time ? activity.moving_time / 60 : 0;
          const pace =
            km > 0 && minutes > 0
              ? `${Math.floor(minutes / km)}:${String(Math.round(((minutes / km) % 1) * 60)).padStart(2, '0')}/km`
              : null;
          return [
            format(new Date(activity.start_date), 'd MMM'),
            activity.sport_type || activity.type,
            activity.name,
            km > 0 ? `${km.toFixed(1)}km` : null,
            minutes > 0 ? `${Math.round(minutes)}m` : null,
            pace,
            activity.average_heartrate ? `avg HR ${Math.round(activity.average_heartrate)}` : null,
            activity.suffer_score ? `effort ${activity.suffer_score}` : null,
          ]
            .filter(Boolean)
            .join(' | ');
        })
        .join('\n');
    },
  );

  const trainingLoadDetail = ai.dynamicTool(
    {
      name: 'getTrainingLoadDetail',
      description:
        'Get the athlete\'s training load curve — fitness (CTL), fatigue (ATL) and form (TSB) day by day over recent weeks, plus the modality breakdown. Use when advising on fatigue, tapering, deloads or whether they can absorb more work.',
      inputSchema: z.object({
        days: z.number().optional().describe('Days of daily load history to include. Default 21, max 60.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('training load');
      const activities = await getStravaActivities(userId, 60);
      if (activities.length === 0) {
        return 'No training load data — Strava is not connected, so ATL/CTL/TSB cannot be computed. Reason from completed sessions and how the athlete says they feel instead.';
      }

      const summary = formatTrainingSummaryForAI(computeTrainingSummary(activities));
      const window = Math.min(Math.max(input.days ?? 21, 7), 60);
      const pmc = computeDailyPMC(activities, 90).slice(-window);
      const curve = pmc
        .filter((_, index) => index % 2 === 0 || index === pmc.length - 1)
        .map(point => `${point.date}: load ${point.load}, CTL ${point.ctl}, ATL ${point.atl}, TSB ${point.tsb}`)
        .join('\n');

      return `${summary}\n\nDaily curve (every other day, last ${window} days):\n${curve}`;
    },
  );

  const journalTool = ai.dynamicTool(
    {
      name: 'getJournalEntries',
      description:
        "Read the athlete's training journal — their own words on how sessions felt, what is bothering them, and what they are pleased with. Use when a question touches motivation, confidence, niggles or life context.",
      inputSchema: z.object({
        limit: z.number().optional().describe('How many entries to return, newest first. Default 10, max 30.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('journal');
      const entries = await getRecentJournalEntries(
        userId,
        Math.min(Math.max(input.limit ?? 10, 1), 30),
      );
      if (entries.length === 0) return 'The athlete has not written any journal entries.';
      return entries.map(entry => summariseJournalEntry(entry, 600)).join('\n');
    },
  );

  const programOutline = ai.dynamicTool(
    {
      name: 'getProgramOutline',
      description:
        'Get the shape of the athlete\'s whole program week by week, including where they are in it and what is still to come. Use when explaining why a block looks the way it does or what is coming next.',
      inputSchema: z.object({
        fromWeek: z.number().optional().describe('First program week to include. Defaults to the whole program.'),
        toWeek: z.number().optional().describe('Last program week to include.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('program outline');
      const user = await getUser(userId);
      if (!user) return 'No athlete profile found.';
      const program = await getEffectiveProgram(user);
      if (!program) return 'The athlete has no active program.';

      const cycleLength = Math.max(...program.workouts.map(w => w.day), 0);
      const currentDay = user.startDate
        ? getWorkoutForDay(program, user.startDate, today).day
        : null;

      const weeks = new Map<number, string[]>();
      for (const workout of [...program.workouts].sort((a, b) => a.day - b.day)) {
        const week = Math.ceil(workout.day / 7);
        weeks.set(week, [...(weeks.get(week) ?? []), `d${workout.day} ${workout.title}`]);
      }

      const lines = [...weeks.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([week]) =>
          (input.fromWeek === undefined || week >= input.fromWeek) &&
          (input.toWeek === undefined || week <= input.toWeek),
        )
        .map(([week, titles]) => {
          const marker =
            currentDay && Math.ceil(currentDay / 7) === week ? ' ← currently here' : '';
          return `Week ${week}${marker}: ${titles.join(' | ')}`;
        });

      return [
        `${program.name} (${program.programType}) — ${cycleLength} days, ${Math.ceil(cycleLength / 7)} weeks`,
        program.description ?? '',
        user.customProgram?.length
          ? 'This athlete is on a personalised version: earlier coach adjustments have been applied.'
          : '',
        ...lines,
      ]
        .filter(Boolean)
        .join('\n');
    },
  );

  const workoutDetail = ai.dynamicTool(
    {
      name: 'getWorkoutDetail',
      description:
        'Get the complete prescribed content of the session(s) on a specific date — every exercise, set/rep scheme and run segment. Use before giving execution advice on a particular session.',
      inputSchema: z.object({
        date: z.string().describe('The date, YYYY-MM-DD. Defaults to today.'),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('workout detail');
      const date = parseDate(input.date, today);
      const user = await getUser(userId);
      if (!user) return 'No athlete profile found.';
      const program = await getEffectiveProgram(user);
      const sessions = await getSessionsInRange(userId, date, date);
      const schedule = buildSchedule(date, date, sessions, program, user.startDate, today);
      const day = schedule[0];

      if (!day || day.sessions.length === 0) {
        return `${format(date, 'EEEE d MMM yyyy')} is a rest day — nothing scheduled.`;
      }

      return day.sessions
        .map(session => {
          const full = session.session?.workoutDetails
            ? describeWorkout(session.session.workoutDetails, 40)
            : session.detail;
          const notes = session.notes ? `\nAthlete's notes: "${session.notes}"` : '';
          return `${format(date, 'EEEE d MMM yyyy')} — ${session.title} [${session.status}]\n${full}${notes}`;
        })
        .join('\n\n');
    },
  );

  const planChange = ai.dynamicTool(
    {
      name: 'draftPlanChange',
      description:
        "Draft concrete changes to the athlete's upcoming plan — reduced volume, a swapped session, an injury work-around, more running. Call this only when the athlete wants their plan changed, and say what you have drafted in your reply. The change is NOT applied: the athlete confirms it in the app, so tell them it is waiting for them to approve.",
      inputSchema: z.object({
        instruction: z
          .string()
          .describe(
            'What the plan should become, in plain language, including the reason — e.g. "knee pain on squats, swap heavy lower-body work for low-impact conditioning for the next week".',
          ),
      }),
      outputSchema: z.string(),
    },
    async input => {
      record('plan adjustment draft');
      try {
        const user = await getUser(userId);
        if (!user || !user.programId || !user.startDate) {
          return 'Cannot draft plan changes: the athlete has no active program with a start date.';
        }
        const program = await getEffectiveProgram(user);
        if (!program) return 'Cannot draft plan changes: the program could not be loaded.';

        const recent = await getSessionsInRange(userId, subDays(today, 21), today);
        const recentHistory = recent
          .filter(session => session.finishedAt || session.skipped)
          .slice(-5)
          .map(session => ({
            date: format(session.workoutDate, 'yyyy-MM-dd'),
            workoutTitle: session.workoutTitle,
            notes: session.notes || '',
            skipped: !!session.skipped,
          }));

        const upcomingWorkouts: Array<Workout | RunningWorkout> = [];
        for (let offset = 1; offset <= 7; offset++) {
          const { sessions } = getWorkoutForDay(program, user.startDate, addDays(today, offset));
          upcomingWorkouts.push(...(sessions as Array<Workout | RunningWorkout>));
        }

        if (upcomingWorkouts.length === 0) {
          return 'There are no scheduled workouts in the next 7 days to adjust.';
        }

        const result = await analyzeAndAdjust({
          userName: user.firstName || 'Athlete',
          userGoal: user.goal || 'hybrid performance',
          recentHistory,
          upcomingWorkouts: upcomingWorkouts as never,
          customRequest: input.instruction,
        });

        const adjustments = (result.adjustments ?? []) as PlanProposal['adjustments'];
        if (!result.needsAdjustment || adjustments.length === 0) {
          trace.planProposal = null;
          return `No changes drafted. ${result.analysis}`;
        }

        trace.planProposal = { analysis: result.analysis, adjustments };

        return [
          `Drafted ${adjustments.length} change(s), waiting on the athlete to approve in the app:`,
          ...adjustments.map(
            adjustment =>
              `- Day ${adjustment.day}: "${adjustment.originalTitle}" → "${adjustment.modifiedTitle}" (${adjustment.reason})`,
          ),
        ].join('\n');
      } catch (error) {
        logger.error(
          '[coach-tools] draftPlanChange failed:',
          error instanceof Error ? error.message : String(error),
        );
        return 'Could not draft the plan change right now. Give the athlete the advice in words instead, and suggest they use Analyze My Week.';
      }
    },
  );

  return [
    workoutDetail,
    upcomingPlan,
    trainingHistory,
    movementHistory,
    stravaActivities,
    trainingLoadDetail,
    journalTool,
    programOutline,
    planChange,
  ];
}
