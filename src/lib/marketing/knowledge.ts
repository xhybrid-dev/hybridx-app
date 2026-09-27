// src/lib/marketing/knowledge.ts
//
// The live business snapshot injected into every AI marketing prompt.
//
// This is the part a general-purpose email tool cannot replicate. MailChimp's
// assistant knows your brand colours and your past copy; this knows the actual
// programme catalogue, the current trial length and price, how large each
// segment really is, and — the compounding part — which of your own subject
// lines and calls to action historically earned opens.
//
// Facts are read from where they are enforced rather than restated in a prompt.
// The brand briefing that came over from HXMailer claimed a "1-month free
// trial" while TRIAL_DAYS was 14; anything drafted from it would have promised
// twice the trial on offer.

import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { TRIAL_DAYS } from '@/lib/trial';
import type { Program } from '@/models/types';
import { CAMPAIGNS } from './queue';
import { SUBSCRIBERS } from './subscribers';
import type { Campaign } from './types';
import { listRoutes } from './route-store';
import { routeTag } from './sources';

export interface ProgramFact {
  id: string;
  name: string;
  description: string;
  programType: string;
  weeks: number | null;
}

export interface AudienceFact {
  tag: string;
  count: number;
}

/**
 * A funnel somebody can arrive by, as the planner needs to see it.
 *
 * Present because a campaign for a specific funnel is the commonest thing
 * anybody asks the studio for, and it could not be planned: the model was shown
 * a flat list of tags with no way to tell `route:magnet-athx-guide` from
 * `interest:android`, and no vocabulary for "the people who came in this way".
 */
export interface RouteFact {
  id: string;
  label: string;
  description: string;
  /** The tag every subscriber from this route carries. */
  tag: string;
  count: number;
  /** True when consent is only granted by a clicked confirmation link. */
  confirmedOptIn: boolean;
}

export interface CampaignPerformanceFact {
  subject: string;
  recipients: number;
  openRate: number;
  clickRate: number;
}

export interface KnowledgeSnapshot {
  trialDays: number;
  priceLabel: string;
  programs: ProgramFact[];
  features: string[];
  totalMailable: number;
  topSegments: AudienceFact[];
  /** Every live intake route, so a campaign can be aimed at one funnel's cohort. */
  intakeRoutes: RouteFact[];
  /** Best- and worst-performing past campaigns, so drafts learn from real outcomes. */
  bestCampaigns: CampaignPerformanceFact[];
  worstCampaigns: CampaignPerformanceFact[];
  capturedAt: string;
}

/**
 * Static feature inventory.
 *
 * Kept as a typed constant rather than prose in the brand file so that adding a
 * feature to the app and telling the AI about it is one edit in one place.
 *
 * The Edge Coach and adaptive-analysis lines lead with what the athlete gets,
 * not with "AI" — src/ai/brand-context.ts asks drafts to do the same, and a
 * fact bullet that opens "AI coaching..." would hand the model a ready-made
 * AI-first headline regardless of what the brand voice rules say. Still
 * exactly the same features; only which word comes first changed.
 */
export const APP_FEATURES = [
  'Six structured 12-week HYROX training programmes across every experience level',
  'Edge Coach — personal coaching that adapts to your training, answers technique and race-strategy questions, and sends daily summaries',
  'Weekly plan adjustments that reshape upcoming sessions around how you actually trained',
  'Race-day planner that counts back from an event date with a periodised build',
  'Strava integration — activity sync and AI-generated post descriptions',
  'Garmin integration — push workouts to the watch and pull activities back',
  'Workout tracking with streaks, consistency scoring and progress charts',
  'VDOT calculator and pace-zone guidance',
  'Talk to Coach — send your coach a typed or voice note (ill, away, a niggle, how a session went) and it remembers, easing off and adjusting instead of chasing missed sessions',
  'Available on iOS, Android and web as a PWA',
] as const;

const CACHE_TTL_MS = 15 * 60_000;
let cache: { snapshot: KnowledgeSnapshot; expiresAt: number } | null = null;

/** Drop the cached snapshot. Called after a programme or settings change. */
export function invalidateKnowledge(): void {
  cache = null;
}

/**
 * Assemble the snapshot, cached for fifteen minutes.
 *
 * Cached because drafting a multi-email journey calls this once per email, and
 * the underlying facts change on the order of weeks. Fifteen minutes is short
 * enough that a price change reaches the next draft session.
 */
export async function getKnowledgeSnapshot(): Promise<KnowledgeSnapshot> {
  if (cache && cache.expiresAt > Date.now()) return cache.snapshot;

  const db = getAdminDb();

  const [programsSnap, mailableCount, campaignsSnap, tagSnap] = await Promise.all([
    db.collection('programs').get(),
    db
      .collection(SUBSCRIBERS)
      .where('status', '==', 'active')
      .where('consent.marketing', '==', true)
      .count()
      .get(),
    db.collection(CAMPAIGNS).where('status', '==', 'sent').limit(200).get(),
    db.collection(SUBSCRIBERS).select('tags').limit(5000).get(),
  ]);

  const programs: ProgramFact[] = programsSnap.docs.map((d) => {
    const p = d.data() as Program;
    return {
      id: d.id,
      name: p.name,
      description: p.description ?? '',
      programType: p.programType ?? 'hyrox',
      // Programmes store a flat workout list; twelve weeks is the shape, but
      // derive it rather than asserting it.
      weeks: p.workouts?.length ? Math.round(p.workouts.length / 7) : null,
    };
  });

  const performance: CampaignPerformanceFact[] = campaignsSnap.docs
    .map((d) => d.data() as Campaign)
    .filter((c) => (c.recipientCount ?? 0) >= 20) // too few recipients to mean anything
    .map((c) => ({
      subject: c.subject,
      recipients: c.recipientCount,
      openRate: (c.openCount ?? 0) / c.recipientCount,
      clickRate: (c.clickCount ?? 0) / c.recipientCount,
    }))
    .sort((a, b) => b.openRate - a.openRate);

  const tagCounts = new Map<string, number>();
  for (const doc of tagSnap.docs) {
    for (const tag of (doc.data().tags ?? []) as string[]) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  // Routes come from the store rather than the code registry, so a funnel that
  // registered itself last Thursday is offered to the planner today — which is
  // the whole reason routes are data. Archived ones are left out: a retired
  // funnel should not be proposed as a target.
  //
  // Counts are read from the tag census already gathered above rather than a
  // query per route. It samples 5,000 subscribers, so these are indicative
  // sizes for choosing between funnels, not the audience figure a send reports.
  let intakeRoutes: RouteFact[] = [];
  try {
    intakeRoutes = (await listRoutes())
      .filter((route) => route.status !== 'archived')
      .map((route) => ({
        id: route.id,
        label: route.label,
        description: route.description,
        tag: routeTag(route.id),
        count: tagCounts.get(routeTag(route.id)) ?? 0,
        confirmedOptIn: route.consentPolicy === 'confirmed',
      }))
      .sort((a, b) => b.count - a.count);
  } catch (err) {
    // The snapshot feeds every AI flow. A route lookup that throws must cost
    // the planner its funnel list, not the drafting of an email.
    logger.error(
      '[marketing/knowledge] could not read intake routes:',
      err instanceof Error ? err.message : String(err),
    );
  }

  const snapshot: KnowledgeSnapshot = {
    trialDays: TRIAL_DAYS,
    priceLabel: process.env.MARKETING_PRICE_LABEL || '£5/month',
    programs,
    features: [...APP_FEATURES],
    totalMailable: mailableCount.data().count,
    topSegments: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25),
    intakeRoutes,
    bestCampaigns: performance.slice(0, 5),
    worstCampaigns: performance.slice(-3).reverse(),
    capturedAt: new Date().toISOString(),
  };

  cache = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
  logger.log(
    `[marketing/knowledge] snapshot: ${programs.length} programmes, ` +
      `${snapshot.totalMailable} mailable, ${performance.length} campaigns with history`,
  );
  return snapshot;
}

/**
 * Format the snapshot for a prompt.
 *
 * Presented as an explicit "LIVE BUSINESS FACTS" block with an instruction not
 * to go beyond it, because the failure mode being guarded against is the model
 * confidently supplying a plausible price or programme name from training data.
 * The validator in validate.ts is the backstop; this is the first line.
 */
export function formatKnowledgeForPrompt(snapshot: KnowledgeSnapshot): string {
  const programLines = snapshot.programs.length
    ? snapshot.programs
        .map((p) => `- "${p.name}" (${p.programType}${p.weeks ? `, ~${p.weeks} weeks` : ''}): ${p.description}`)
        .join('\n')
    : '- (No programmes found. Do not name any specific programme.)';

  const performanceLines = snapshot.bestCampaigns.length
    ? snapshot.bestCampaigns
        .map((c) => `- "${c.subject}" — ${(c.openRate * 100).toFixed(1)}% opened, ${(c.clickRate * 100).toFixed(1)}% clicked`)
        .join('\n')
    : '- (No campaign history yet.)';

  const weakLines = snapshot.worstCampaigns.length
    ? snapshot.worstCampaigns
        .map((c) => `- "${c.subject}" — ${(c.openRate * 100).toFixed(1)}% opened`)
        .join('\n')
    : '- (Not enough history.)';

  // Named funnels, listed apart from the flat tag census. The planner cannot
  // aim a campaign at "the people who took the ATHX guide" from a tag list that
  // says only `route:magnet-athx-guide: 412` — it needs the label, what the
  // person actually did, and the tag that selects them.
  const routeLines = snapshot.intakeRoutes.length
    ? snapshot.intakeRoutes
        .map(
          (r) =>
            `- ${r.id} — "${r.label}" (${r.count} subscribers, tag \`${r.tag}\`` +
            `${r.confirmedOptIn ? ', confirmed opt-in' : ''}): ${r.description}`,
        )
        .join('\n')
    : '- (No intake routes found. Do not narrow a campaign to a funnel.)';

  return `## LIVE BUSINESS FACTS

These are read from the live HYBRIDX system. Use ONLY these values for anything
factual — price, trial length, programme names, feature claims. Do not state a
price, trial length or programme that does not appear here, and do not invent
statistics. If you need a fact that is not listed, leave it out.

**Pricing:** ${snapshot.priceLabel}
**Free trial:** ${snapshot.trialDays} days, no payment card required

**Training programmes currently offered:**
${programLines}

**Product features you may reference:**
${snapshot.features.map((f) => `- ${f}`).join('\n')}

**Audience:** ${snapshot.totalMailable.toLocaleString()} subscribers can currently receive marketing email.

**Largest segments (tag: subscriber count):**
${snapshot.topSegments.slice(0, 12).map((s) => `- ${s.tag}: ${s.count}`).join('\n')}

**Funnels people arrive by (route id — label (size, tag): what they did):**
${routeLines}

**Subject lines that performed best with this audience:**
${performanceLines}

**Subject lines that performed worst — avoid these patterns:**
${weakLines}
`;
}

/** Convenience: snapshot plus formatted block, for the flows. */
export async function getPromptKnowledge(): Promise<{ snapshot: KnowledgeSnapshot; block: string }> {
  const snapshot = await getKnowledgeSnapshot();
  return { snapshot, block: formatKnowledgeForPrompt(snapshot) };
}
