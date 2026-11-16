// src/lib/marketing/eval/cases.ts
//
// A fixed set of briefs the drafter is judged against.
//
// Prompt changes used to be judged by drafting one email and reading it. One
// email says little: a change that improves a welcome email can quietly break
// a book launch. These cases cover the jobs the studio is actually asked to
// do, each with the things a good draft must and must not do, so a change is
// judged by its effect on all of them at once.
//
// Keep the briefs free of programme names and live prices except where a case
// is about them: the catalogue and price change, and a case that hard-codes
// them would start failing for reasons that have nothing to do with drafting.

import type { DraftEmailInput } from '../draft-prompt';

export interface EvalCase {
  id: string;
  /** The job this email does, for grouping results. */
  archetype:
    | 'welcome'
    | 'activation'
    | 'conversion'
    | 'winback'
    | 'announcement'
    | 'education'
    | 'product'
    | 'event';
  input: DraftEmailInput;
  expect: {
    /** Each entry is a set of alternatives; at least one must appear. */
    mentions?: string[][];
    /** None of these may appear (case-insensitive). {price} / {trialDays} are filled from live facts. */
    avoids?: string[];
    /** The button must lead here: an exact URL, or an app path like "/dashboard". */
    ctaTo?: string[];
    /** The brief gives no link, so the draft should leave one for the reviewer. */
    needsHumanLink?: boolean;
    /** Body word range; defaults to 80–300. */
    words?: [number, number];
  };
}

// {price} and {trialDays} are filled in from the live facts when scoring.
const APP_PITCH = ['free trial', '{trialDays}-day', '{trialDays} day', '{price}'];

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'welcome-1',
    archetype: 'welcome',
    input: {
      brief: 'Welcome a new signup. Get them to open their dashboard and see their first week of training.',
      journeyGoal: 'Turn new signups into athletes who log their first workout in week one.',
      audienceDescription: 'People who created an account today and have not trained yet.',
      position: 'email 1 of 3, sent straight after sign-up',
    },
    expect: { ctaTo: ['/dashboard', '/calendar', '/training', '/'], mentions: [['first', 'week', 'today']] },
  },
  {
    id: 'welcome-2-sequence',
    archetype: 'welcome',
    input: {
      brief: 'Introduce the Edge Coach: they can ask it about technique, race strategy or a missed session.',
      journeyGoal: 'Turn new signups into athletes who log their first workout in week one.',
      audienceDescription: 'Signed up two days ago.',
      position: 'email 2 of 3, sent 2 days in',
      siblingEmails: [
        {
          subject: 'Your first week is ready',
          body: '# Your first week is ready\nIt starts with one short session.\n\nHi [First Name],\n\nYour plan is built around the days you said you can train. Open it and the first session is waiting.\n\n[button: See your first week -> dashboard]',
        },
      ],
    },
    expect: { ctaTo: ['/coach'], mentions: [['Edge Coach']], avoids: ['Your first week is ready'] },
  },
  {
    id: 'activation-no-workout',
    archetype: 'activation',
    input: {
      brief: 'They signed up five days ago and have not logged a single workout. Make starting feel small and easy: one session today.',
      audienceDescription: 'Trialists with zero completed workouts.',
    },
    expect: { ctaTo: ['/dashboard', '/training', '/calendar'], avoids: ['you failed', 'lazy'] },
  },
  {
    id: 'trial-ending',
    archetype: 'conversion',
    input: {
      brief: 'Their free trial ends in 3 days. Remind them what they keep by staying on, and state the price after the trial.',
      audienceDescription: 'Trialists who have logged at least three workouts.',
    },
    expect: { ctaTo: ['/subscription'], mentions: [['{price}']] },
  },
  {
    id: 'trial-ending-inactive',
    archetype: 'conversion',
    input: {
      brief: 'Trial ends in 3 days and they have never trained. Do not push payment; get them to try one session before it ends.',
      audienceDescription: 'Trialists with no workouts, trial ending soon.',
    },
    expect: { ctaTo: ['/dashboard', '/training', '/calendar'] },
  },
  {
    id: 'winback-cancelled',
    archetype: 'winback',
    input: {
      brief: 'Win back athletes who cancelled in the last 60 days. Lead with the race planner: tell it your race date and it builds the plan backwards from it.',
      audienceDescription: 'Cancelled subscribers, cancelled within 60 days.',
      position: 'email 1 of 3',
    },
    expect: { ctaTo: ['/dashboard', '/subscription', '/calendar', '/training', '/'], mentions: [['race date', 'race day', 'your race']] },
  },
  {
    id: 'reengage-inactive',
    archetype: 'winback',
    input: {
      brief: 'Paying members who have not logged a workout in 30 days. No guilt. Tell them about Talk to Coach: send a note saying you were ill or away and the plan eases you back in.',
      audienceDescription: 'Active subscribers, inactive 30+ days.',
    },
    expect: { ctaTo: ['/coach', '/dashboard'], avoids: APP_PITCH },
  },
  {
    id: 'announce-garmin',
    archetype: 'announcement',
    input: {
      brief: 'Announce Garmin integration: workouts push to the watch and activities sync back. Short.',
      audienceDescription: 'Everyone on the list.',
    },
    expect: { mentions: [['Garmin']], words: [50, 220] },
  },
  {
    id: 'announce-strava',
    archetype: 'announcement',
    input: {
      brief: 'Remind members that Strava sync can write their activity description for them after each session.',
      audienceDescription: 'Active subscribers who have not connected Strava.',
    },
    expect: { mentions: [['Strava']], ctaTo: ['/profile', '/dashboard', '/activity-feed'] },
  },
  {
    id: 'education-compromised-running',
    archetype: 'education',
    input: {
      brief: 'A useful newsletter-style email: three practical tips for compromised running (running after the stations). Mention that the app programmes train this, but the value is the tips.',
      audienceDescription: 'Whole list.',
    },
    expect: { mentions: [['compromised running', 'running after', 'heavy legs']], words: [150, 400] },
  },
  {
    id: 'education-race-week',
    archetype: 'education',
    input: {
      brief: 'Race-week advice: how to taper, what to eat the day before, and pacing the first run. Three short sections.',
      audienceDescription: 'Athletes with a race date in the next 10 days.',
    },
    expect: { words: [150, 400] },
  },
  {
    id: 'programme-beginners',
    archetype: 'conversion',
    input: {
      brief: 'For people who have never raced HYROX: there is a beginner programme built for a first race. Feature the beginner programme from the catalogue.',
      audienceDescription: 'Subscribers tagged as first-timers.',
    },
    expect: { ctaTo: ['/programs'] },
  },
  {
    id: 'programme-doubles',
    archetype: 'conversion',
    input: {
      brief: 'Partner and relay racers: feature the doubles and relay programme from the catalogue.',
      audienceDescription: 'Subscribers interested in doubles.',
    },
    expect: { ctaTo: ['/programs'], mentions: [['partner', 'doubles', 'relay']] },
  },
  {
    id: 'book-with-link',
    archetype: 'product',
    input: {
      brief: 'Launch our new book "The Compromised Runner", £14.99 paperback, at https://shop.hybridx.club/books/compromised-runner. It is a book, not part of the app.',
      audienceDescription: 'Whole list.',
    },
    expect: {
      ctaTo: ['https://shop.hybridx.club/books/compromised-runner'],
      mentions: [['The Compromised Runner'], ['£14.99']],
      avoids: APP_PITCH,
    },
  },
  {
    id: 'digital-no-link',
    archetype: 'product',
    input: {
      brief: 'Promote our downloadable HYROX station technique guide (PDF). No link yet — the shop page is not live.',
      audienceDescription: 'Whole list.',
    },
    expect: { needsHumanLink: true, avoids: APP_PITCH },
  },
  {
    id: 'event-external',
    archetype: 'event',
    input: {
      brief: 'Invite people to our free community training session in London on Saturday 6 December, 9am. Sign up at https://hybridx.club/events/london-december.',
      audienceDescription: 'Subscribers in London.',
    },
    expect: { ctaTo: ['https://hybridx.club/events/london-december'], mentions: [['London'], ['6 December', 'December 6', 'Saturday']], avoids: APP_PITCH },
  },
  {
    id: 'no-invented-stats',
    archetype: 'conversion',
    input: {
      brief: 'Convince sceptical trialists that an adaptive plan beats a static PDF plan. Do not cite any statistics.',
      audienceDescription: 'Trialists.',
    },
    expect: { avoids: ['% of'] },
  },
  {
    id: 'ambiguous-short-brief',
    archetype: 'activation',
    input: { brief: 'Get people back to the app.' },
    expect: {},
  },
  {
    id: 'guide-funnel-welcome',
    archetype: 'welcome',
    input: {
      brief: 'They downloaded our free ATHX race guide. Thank them, give one useful idea from the theme of race preparation, and invite them to try the app.',
      audienceDescription: 'People who came in through the ATHX guide.',
      position: 'email 1 of 2',
    },
    expect: { mentions: [['guide']] },
  },
  {
    id: 'upgrade-annual-tone',
    archetype: 'conversion',
    input: {
      brief: 'Members who have trained consistently for 8 weeks: celebrate the streak and point them at their progress charts. No sales pitch.',
      audienceDescription: 'Active subscribers with 8-week streaks.',
    },
    expect: { avoids: APP_PITCH, ctaTo: ['/dashboard', '/activity-feed', '/profile', '/training'] },
  },
];
