// src/lib/postpone.ts
//
// "Do it tomorrow": move today's session to tomorrow without losing a session
// or stacking two into one day. Tomorrow's own session moves to the next rest
// day in the coming week; only if the week has none do the two share a day.

export interface DayPlan<W> {
  date: Date;
  workouts: W[];
}

export interface PostponePlan<W> {
  /** Days whose workout lists change, ready for saveScheduleChanges. */
  changes: DayPlan<W>[];
  /** Where tomorrow's original session ended up, if it had to move. */
  bumpedTo: Date | null;
}

/**
 * `week` is today first, then the following days in order (at least two).
 * Returns null when there is nothing to move today.
 */
export function planPostpone<W>(week: DayPlan<W>[]): PostponePlan<W> | null {
  const [today, tomorrow, ...later] = week;
  if (!today || !tomorrow || today.workouts.length === 0) return null;

  if (tomorrow.workouts.length === 0) {
    return {
      changes: [
        { date: today.date, workouts: [] },
        { date: tomorrow.date, workouts: [...today.workouts] },
      ],
      bumpedTo: null,
    };
  }

  const freeDay = later.find(day => day.workouts.length === 0);
  if (!freeDay) {
    return {
      changes: [
        { date: today.date, workouts: [] },
        { date: tomorrow.date, workouts: [...today.workouts, ...tomorrow.workouts] },
      ],
      bumpedTo: null,
    };
  }

  return {
    changes: [
      { date: today.date, workouts: [] },
      { date: tomorrow.date, workouts: [...today.workouts] },
      { date: freeDay.date, workouts: [...tomorrow.workouts] },
    ],
    bumpedTo: freeDay.date,
  };
}
