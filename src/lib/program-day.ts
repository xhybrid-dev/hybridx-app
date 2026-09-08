// src/lib/program-day.ts
//
// Which calendar day a stored date belongs to, and which day of a program that
// is. One implementation, because getting it subtly wrong is invisible: nothing
// errors, the coach just talks about the wrong day.
//
// Two kinds of value are stored, and they are not the same kind of thing:
//
//   workoutDate  — a DAY MARKER. The browser writes the athlete's local
//                  midnight (session-service-client sets hours to 0). For a UK
//                  athlete in summer that is 23:00 UTC the evening before.
//   startDate    — an INSTANT. Written as `new Date()` at whatever moment the
//                  athlete picked a program, so typically mid-afternoon.
//
// Read in UTC, a day marker floors back a day and an instant does not, which is
// why no single offset-guessing rule works: rounding to the nearest midnight
// fixes the marker and pushes the instant a day forward. The only thing that
// resolves both is knowing the athlete's timezone, and then it is the same
// operation for both — ask what date it was, where they are.
//
// Without a timezone these fall back to the runtime's own zone, which is what
// the code did before and is correct in the browser (the athlete's own zone)
// while being a day out on the server for markers from positive-offset zones.

const DAY_MS = 86_400_000;

/** A validated IANA timezone, or undefined. Never trust a client-supplied string. */
export function normaliseTimeZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.length > 64) return undefined;
  try {
    // Throws RangeError on anything Intl doesn't recognise.
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // en-CA gives YYYY-MM-DD, which sorts and parses without further work.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The calendar date an instant falls on, as YYYY-MM-DD.
 * With a timezone this is the date the athlete would call it; without one it is
 * the date in the runtime's own zone.
 */
export function calendarDayKey(date: Date, timeZone?: string): string {
  if (timeZone) return zoneFormatter(timeZone).format(date);
  const local = new Date(date);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
    local.getDate(),
  ).padStart(2, '0')}`;
}

/** The same calendar day, counted in days since the epoch, for arithmetic. */
export function calendarDayIndex(date: Date, timeZone?: string): number {
  const [year, month, day] = calendarDayKey(date, timeZone).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/**
 * A stored date re-pinned to midnight of the day it belongs to, in the
 * *runtime's* zone.
 *
 * The runtime's zone matters: `format`, `differenceInCalendarDays` and
 * `startOfWeek` all read local fields, so giving them a value whose local
 * Y/M/D is the athlete's calendar day makes every one of them correct without
 * each call site having to know about timezones.
 */
export function toCalendarDay(date: Date, timeZone?: string): Date {
  const [year, month, day] = calendarDayKey(date, timeZone).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The 1-based program day for `targetDay`. Day 1 is the start date itself;
 * days before it come back zero or negative.
 *
 * The two arguments are read differently, on purpose:
 *
 *   startDate — a stored INSTANT (`new Date()` when the program was picked).
 *               Only the athlete's own zone says which calendar day that was,
 *               so `startDateZone` is what resolves it.
 *   targetDay — the calendar day being asked about, as a date whose
 *               RUNTIME-LOCAL Y/M/D is that day. Callers holding a raw instant
 *               must put it through `toCalendarDay(instant, zone)` first.
 *
 * Reading both in the athlete's zone looks tidier and is wrong: it re-zones a
 * target that has already been resolved, and lands a day out whenever the
 * runtime and the athlete are in different zones.
 */
export function programDayFor(
  startDate: Date,
  targetDay: Date,
  startDateZone?: string,
): number {
  return calendarDayIndex(targetDay) - calendarDayIndex(startDate, startDateZone) + 1;
}
