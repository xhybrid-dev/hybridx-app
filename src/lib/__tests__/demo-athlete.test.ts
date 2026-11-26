import { describe, expect, it } from 'vitest';
import {
  DEMO_PLAN_WEEKS,
  buildDemoConversation,
  buildDemoNotes,
  buildDemoPlan,
  buildDemoSessions,
  demoPlanStartDay,
  zonedDayNumber,
  zonedInstant,
} from '../demo-athlete';

const DAY_MS = 86_400_000;
const dayOf = (iso: string) => Date.parse(iso) / DAY_MS;

describe('demo plan', () => {
  const plan = buildDemoPlan();

  it('runs 16 weeks and ends on race day, a Saturday', () => {
    const last = plan[plan.length - 1];
    expect(last.title).toBe('Race Day');
    expect(last.day).toBe((DEMO_PLAN_WEEKS - 1) * 7 + 6);
  });

  it('keeps third-party event brands out of everything a screenshot can show', () => {
    // Only what renders: titles, exercise and run text, coach copy. (The
    // internal programType enum value 'hyrox' is never shown.)
    const visible = [
      ...plan.flatMap(w => [
        w.title,
        ...(w.exercises ?? []).flatMap(e => [e.name, e.details]),
        ...((w as { runs?: { description: string }[] }).runs ?? []).map(r => r.description),
      ]),
      ...buildDemoConversation('Alex', new Date('2027-01-30'), new Date('2026-11-26')).map(m => m.content),
      ...buildDemoNotes('Alex', new Date('2027-01-30')).map(n => n.content),
    ].join('\n');
    expect(visible).not.toMatch(/hyrox|athx/i);
  });
});

describe('calendar helpers', () => {
  it('finds midnight in the athlete zone, across summer time', () => {
    expect(zonedInstant(dayOf('2026-11-26'), 'Europe/London').toISOString()).toBe('2026-11-26T00:00:00.000Z');
    expect(zonedInstant(dayOf('2026-07-01'), 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(zonedInstant(dayOf('2026-11-26'), 'America/New_York', 9).toISOString()).toBe('2026-11-26T14:00:00.000Z');
  });

  it('reads today in the athlete zone', () => {
    expect(zonedDayNumber(new Date('2026-11-26T23:30:00Z'), 'Europe/London')).toBe(dayOf('2026-11-26'));
    expect(zonedDayNumber(new Date('2026-11-26T23:30:00Z'), 'Asia/Tokyo')).toBe(dayOf('2026-11-27'));
  });

  it('starts the plan on a Monday so today lands in the requested week', () => {
    const today = dayOf('2026-11-26'); // a Thursday
    const start = demoPlanStartDay(today, 7);
    expect(new Date(start * DAY_MS).getUTCDay()).toBe(1);
    expect(Math.floor((today - start) / 7) + 1).toBe(7);
  });
});

describe('demo history', () => {
  const plan = buildDemoPlan();
  const today = dayOf('2026-11-26');
  const start = demoPlanStartDay(today, 7);
  const sessions = buildDemoSessions(plan, 'demo-plan-x', start, today, 'Europe/London');

  it('completes every planned session before today and nothing from today on', () => {
    const before = plan.filter(w => start + w.day - 1 < today);
    expect(sessions).toHaveLength(before.length);
    for (const session of sessions) {
      expect(session.workoutDate.getTime()).toBeLessThan(today * DAY_MS);
      expect(session.finishedAt.getTime()).toBeGreaterThan(session.startedAt.getTime());
    }
  });

  it('dates each session at local midnight, as the app does', () => {
    const londonTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (const session of sessions) {
      expect(londonTime.format(session.workoutDate)).toBe('00:00');
    }
    // The plan starts in British Summer Time, so early sessions are 23:00 UTC.
    expect(sessions[0].workoutDate.getUTCHours()).toBe(23);
  });

  it('records the EMOM timer on EMOM days', () => {
    const emoms = sessions.filter(s => s.workoutTitle.includes('EMOM'));
    expect(emoms.length).toBeGreaterThan(0);
    expect(emoms.every(s => s.timerRecord?.timerMode === 'emom')).toBe(true);
  });
});
