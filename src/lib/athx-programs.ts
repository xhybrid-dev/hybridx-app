// src/lib/athx-programs.ts
//
// The ATHX 2027 plans as sign-up offers them. The programs themselves are the
// six imported from src/data/athx-2027 (see its README): one per edition and
// division, imported through admin, so their Firestore ids are not known here.
// Sign-up shows them from this list, before the athlete has an account (the
// programs collection is readable only when signed in), and finds the program
// by its exact name once the account exists (getProgramByNameClient).
//
// The names are pinned to the CSVs by src/lib/__tests__/athx-programs.test.ts,
// so renaming a file's program without changing this fails in CI rather than
// sending ATHX athletes to the dashboard with no plan.

export const ATHX_EDITIONS = ['men', 'women'] as const;
export type AthxEdition = (typeof ATHX_EDITIONS)[number];

export const ATHX_DIVISIONS = ['lite', 'athx', 'pro'] as const;
export type AthxDivision = (typeof ATHX_DIVISIONS)[number];

export const ATHX_EDITION_LABELS: Record<AthxEdition, string> = { men: "Men's", women: "Women's" };
export const ATHX_DIVISION_LABELS: Record<AthxDivision, string> = { lite: 'Lite', athx: 'ATHX', pro: 'Pro' };

/** The program's name in the catalogue, exactly as the CSV imports it. */
export function athxProgramName(edition: AthxEdition, division: AthxDivision): string {
  return `ATHX 2027 — ${ATHX_EDITION_LABELS[edition]} ${ATHX_DIVISION_LABELS[division]} Division`;
}

/**
 * What sign-up stores as `selectedProgramId` for an ATHX plan until the real
 * id is looked up: never a Firestore id, which are 20 alphanumerics.
 */
const SELECTION = /^athx:(men|women):(lite|athx|pro)$/;

export function athxSelectionId(edition: AthxEdition, division: AthxDivision): string {
  return `athx:${edition}:${division}`;
}

export function parseAthxSelection(id: string | null | undefined): { edition: AthxEdition; division: AthxDivision } | null {
  const m = SELECTION.exec(id ?? '');
  return m ? { edition: m[1] as AthxEdition, division: m[2] as AthxDivision } : null;
}

/** Facts from the CSVs (and src/lib/__tests__/athx-2027-programs.test.ts). */
export const ATHX_PLAN = {
  weeks: 12,
  trainingDaysPerWeek: 6,
  summary:
    'Strength, Endurance and MetCon X, with fuelling, hydration, recovery and one thing worth knowing on every day.',
} as const;

/** The three plans of an edition, the athlete's division first. */
export function athxOptions(edition: AthxEdition, division: AthxDivision | undefined) {
  const order = division ? [division, ...ATHX_DIVISIONS.filter((d) => d !== division)] : [...ATHX_DIVISIONS];
  return order.map((d) => ({
    id: athxSelectionId(edition, d),
    name: athxProgramName(edition, d),
    division: d,
  }));
}
