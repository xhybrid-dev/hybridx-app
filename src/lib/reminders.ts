// src/lib/reminders.ts
//
// Who gets a reminder this run, and what it says. The reminder job runs every
// 15 minutes and sends to athletes whose chosen reminder time falls in the
// current quarter-hour, in their own timezone. It used to fire once at 07:00
// UTC for everyone (02:00 on the US east coast), ignoring the time athletes
// picked in Profile, and nagged lapsed athletes every day without end.

export const DEFAULT_REMINDER_TIME = { hour: 7, minute: 0 };
export const DEFAULT_TIME_ZONE = 'Europe/London';

/** Days without opening the app on which a lapsed athlete hears from us — then we stop. */
export const REENGAGE_ON_DAYS = [2, 5, 10];

export interface LocalClock {
  dateKey: string;
  hour: number;
  minute: number;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** Is `preferred` inside the quarter-hour this run covers? */
export function isReminderDue(clock: LocalClock, preferred: { hour: number; minute: number }): boolean {
  return clock.hour === preferred.hour && Math.floor(clock.minute / 15) === Math.floor(preferred.minute / 15);
}

export type Reminder =
  | { kind: 'commitment'; workoutTitle: string }
  | { kind: 'workout'; workoutTitle: string; exercises: string }
  | { kind: 'reengage'; workoutTitle: string | null }
  | { kind: 'none' };

export function decideReminder(args: {
  todaysWorkout: { title: string; exercises: string } | null;
  commitmentTitle: string | null;
  /** Whole days since they last opened the app; null if never recorded. */
  daysSinceSeen: number | null;
}): Reminder {
  const { todaysWorkout, commitmentTitle, daysSinceSeen } = args;
  if (commitmentTitle) return { kind: 'commitment', workoutTitle: commitmentTitle };

  const away = daysSinceSeen ?? 0;
  if (away >= REENGAGE_ON_DAYS[0]) {
    // A few well-spaced nudges, then silence: email journeys take it from there.
    return REENGAGE_ON_DAYS.includes(away)
      ? { kind: 'reengage', workoutTitle: todaysWorkout?.title ?? null }
      : { kind: 'none' };
  }

  // Rest day: nothing to remind them of.
  if (!todaysWorkout) return { kind: 'none' };
  return { kind: 'workout', workoutTitle: todaysWorkout.title, exercises: todaysWorkout.exercises };
}

export function reengageMessage(daysAway: number, workoutTitle: string | null): string {
  if (daysAway >= 10) {
    return workoutTitle
      ? `It's been a while — ${workoutTitle} is ready, or pick up your plan wherever suits you.`
      : "It's been a while. Your plan will pick up wherever you left off — no catching up needed.";
  }
  if (daysAway >= 5) {
    return workoutTitle
      ? `Missed a few sessions? No problem. ${workoutTitle} is today — or pick up where you left off.`
      : 'Missed a few sessions? No problem — open the app and pick up where you left off.';
  }
  return workoutTitle ? `${workoutTitle} is on today. Even a short version counts 💪` : 'Your plan is ready when you are 💪';
}
