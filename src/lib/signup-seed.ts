// src/lib/signup-seed.ts
//
// A sign-up started from a tool on hybridx.club arrives with the athlete's
// answers in the link, so the form opens already filled in:
//
//   /signup?tool=week-planner&days=4&goal=hybrid&experience=beginner
//   /signup?tool=athx&event=athx&edition=women&division=pro&race=2027-01-23
//
// Plain parameters, not a signed seed. Everything here is an answer the
// athlete gives on the form anyway, shown to them and changeable before
// anything is saved, so signing would protect nothing and would need a secret
// shared by both projects (another deploy step that can break the build).
// Each value is checked against the form's own choices; anything else is
// ignored, never repaired.
//
// The site builds these links in src/lib/app-seed.ts. The two are pinned by
// src/lib/__tests__/signup-seed.test.ts here and the cross-repo test there.

import { addDays, addYears, format, isValid, parseISO, startOfDay } from 'date-fns';
import { ATHX_DIVISIONS, ATHX_EDITIONS, type AthxDivision, type AthxEdition } from './athx-programs';

export const SEED_TOOLS = ['week-planner', 'strength-engine-test', 'athx'] as const;
export type SeedTool = (typeof SEED_TOOLS)[number];

/** How the form names where the answers came from. */
export const SEED_TOOL_LABELS: Record<SeedTool, string> = {
  'week-planner': 'the week planner',
  'strength-engine-test': 'the strength and engine test',
  athx: 'the ATHX page',
};

export const SEED_EVENTS = ['hyrox', 'athx'] as const;
export type SeedEvent = (typeof SEED_EVENTS)[number];

const EXPERIENCE = ['beginner', 'intermediate', 'advanced'] as const;
const GOALS = ['strength', 'endurance', 'hybrid'] as const;

/** The same bound the race step puts on a date: at least a week away. */
export const MIN_DAYS_TO_RACE = 7;

export interface SignupSeed {
  tool?: SeedTool;
  event?: SeedEvent;
  experience?: (typeof EXPERIENCE)[number];
  frequency?: '3' | '4' | '5+';
  goal?: (typeof GOALS)[number];
  athxEdition?: AthxEdition;
  athxDivision?: AthxDivision;
  /** YYYY-MM-DD. */
  raceDate?: string;
}

function oneOf<T extends string>(values: readonly T[], v: string | null): T | undefined {
  return v !== null && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Days a week, as the form's three answers. */
export function frequencyFor(days: string | null): SignupSeed['frequency'] {
  if (days === null || !/^[1-7]$/.test(days)) return undefined;
  const n = Number(days);
  return n <= 3 ? '3' : n === 4 ? '4' : '5+';
}

function raceDateFrom(v: string | null, today: Date): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = parseISO(v);
  if (!isValid(d) || format(d, 'yyyy-MM-dd') !== v) return undefined;
  const day = startOfDay(today);
  return d >= addDays(day, MIN_DAYS_TO_RACE) && d <= addYears(day, 2) ? v : undefined;
}

/** The seed a sign-up link carries, or null when it carries nothing usable. */
export function parseSignupSeed(search: string, today: Date = new Date()): SignupSeed | null {
  const p = new URLSearchParams(search);
  const seed: SignupSeed = {
    tool: oneOf(SEED_TOOLS, p.get('tool')),
    event: oneOf(SEED_EVENTS, p.get('event')),
    experience: oneOf(EXPERIENCE, p.get('experience')),
    frequency: frequencyFor(p.get('days')),
    goal: oneOf(GOALS, p.get('goal')),
    athxEdition: oneOf(ATHX_EDITIONS, p.get('edition')),
    athxDivision: oneOf(ATHX_DIVISIONS, p.get('division')),
    raceDate: raceDateFrom(p.get('race'), today),
  };
  // An edition or division is only an ATHX answer.
  if (seed.event !== 'athx') {
    delete seed.athxEdition;
    delete seed.athxDivision;
  }
  const kept = Object.fromEntries(Object.entries(seed).filter(([, v]) => v !== undefined)) as SignupSeed;
  return Object.keys(kept).length ? kept : null;
}

/** Whether a seed has everything sign-up needs to pick an ATHX plan without asking. */
export function seedPicksAthxPlan(seed: SignupSeed | null): boolean {
  return seed?.event === 'athx' && !!seed.athxEdition && !!seed.athxDivision;
}
