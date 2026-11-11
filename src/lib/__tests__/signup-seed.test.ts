import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { csvToProgram } from '../program-csv';
import {
  ATHX_DIVISIONS,
  ATHX_EDITIONS,
  athxOptions,
  athxProgramName,
  athxSelectionId,
  parseAthxSelection,
} from '../athx-programs';
import { frequencyFor, parseSignupSeed, SEED_EVENTS, SEED_TOOLS, seedPicksAthxPlan } from '../signup-seed';

const today = new Date('2026-11-11T09:00:00Z');

// The site (xhybrid-dev/hybridx-web-x) builds these links in src/lib/app-seed.ts
// and pins the same literal values in src/lib/__tests__/cross-repo-agreement.test.ts.
describe('the sign-up seed agrees with hybridx.club', () => {
  it('knows the tools and events the site sends', () => {
    expect([...SEED_TOOLS]).toEqual(['week-planner', 'strength-engine-test', 'athx']);
    expect([...SEED_EVENTS]).toEqual(['hyrox', 'athx']);
    expect([...ATHX_EDITIONS]).toEqual(['men', 'women']);
    expect([...ATHX_DIVISIONS]).toEqual(['lite', 'athx', 'pro']);
  });

  it('reads a week planner link', () => {
    expect(parseSignupSeed('?tool=week-planner&event=hyrox&days=4&experience=beginner&goal=hybrid&src=page-calculators-week-planner', today)).toEqual({
      tool: 'week-planner',
      event: 'hyrox',
      frequency: '4',
      experience: 'beginner',
      goal: 'hybrid',
    });
  });

  it('reads an ATHX link, with its race date', () => {
    expect(parseSignupSeed('?tool=athx&event=athx&edition=women&division=pro&race=2027-01-23', today)).toEqual({
      tool: 'athx',
      event: 'athx',
      athxEdition: 'women',
      athxDivision: 'pro',
      raceDate: '2027-01-23',
    });
  });
});

describe('parseSignupSeed', () => {
  it('maps days a week onto the form’s three answers', () => {
    expect(['1', '3', '4', '5', '7'].map(frequencyFor)).toEqual(['3', '3', '4', '5+', '5+']);
    expect(frequencyFor('8')).toBeUndefined();
    expect(frequencyFor('5+')).toBeUndefined();
  });

  it('ignores anything that is not one of the form’s own answers', () => {
    expect(parseSignupSeed('?tool=nope&experience=elite&goal=speed&days=0&event=marathon', today)).toBeNull();
    expect(parseSignupSeed('', today)).toBeNull();
    expect(parseSignupSeed('?src=guide-a&utm_source=x', today)).toBeNull();
  });

  it('drops an edition or division sent without ATHX', () => {
    expect(parseSignupSeed('?edition=men&division=pro&goal=strength', today)).toEqual({ goal: 'strength' });
  });

  it('takes a race date only from a week to two years away, and only a real one', () => {
    expect(parseSignupSeed('?race=2026-11-17', today)).toBeNull();
    expect(parseSignupSeed('?race=2026-11-18', today)).toEqual({ raceDate: '2026-11-18' });
    expect(parseSignupSeed('?race=2028-11-12', today)).toBeNull();
    expect(parseSignupSeed('?race=2027-02-30', today)).toBeNull();
    expect(parseSignupSeed('?race=next-week', today)).toBeNull();
  });

  it('says when it can pick an ATHX plan without asking', () => {
    expect(seedPicksAthxPlan(parseSignupSeed('?event=athx&edition=men&division=lite', today))).toBe(true);
    expect(seedPicksAthxPlan(parseSignupSeed('?event=athx&edition=men', today))).toBe(false);
    expect(seedPicksAthxPlan(null)).toBe(false);
  });
});

describe('the ATHX 2027 plans sign-up offers', () => {
  const dir = path.join(process.cwd(), 'src/data/athx-2027');
  const imported = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => csvToProgram(fs.readFileSync(path.join(dir, f), 'utf-8')).data.name);

  it('names exactly the six programs the CSVs import, so the lookup by name finds them', () => {
    const offered = ATHX_EDITIONS.flatMap((e) => ATHX_DIVISIONS.map((d) => athxProgramName(e, d)));
    expect(offered.sort()).toEqual([...imported].sort());
  });

  it('round-trips a selection, and never mistakes a Firestore id for one', () => {
    expect(parseAthxSelection(athxSelectionId('women', 'pro'))).toEqual({ edition: 'women', division: 'pro' });
    expect(parseAthxSelection('JrHDGwFm0Cn4sRJosApH')).toBeNull();
    expect(parseAthxSelection(undefined)).toBeNull();
  });

  it('lists an edition’s three plans with the athlete’s division first', () => {
    expect(athxOptions('men', 'pro').map((o) => o.division)).toEqual(['pro', 'lite', 'athx']);
    expect(athxOptions('women', undefined).map((o) => o.division)).toEqual(['lite', 'athx', 'pro']);
  });
});
