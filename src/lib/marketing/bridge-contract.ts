// src/lib/marketing/bridge-contract.ts
//
// The wire contract between a funnel and the mailing system.
//
// This exists because the two halves drifted. The marketing site sent
// `utm: { source, medium, campaign }`; this app read `utm.utm_source`. Both
// were internally consistent, both typechecked, neither knew about the other —
// and so every lead's first-touch attribution was quietly discarded from the
// day the bridge was built. Nothing failed. The data was simply not there.
//
// Two independently-declared shapes that must match will eventually not match.
// So the contract is declared once, here, parsed rather than trusted, and
// published at GET /api/marketing/leads so anything building a new funnel can
// read what the fields are instead of guessing from an example.
//
// Compatibility is deliberate: both UTM spellings are accepted and normalised.
// A future funnel should not have to know which of them history settled on, and
// a contract that rejects the callers it already has is not a contract, it is
// an outage.

import { z } from 'zod';
import { parseAcquisitionSrc } from '@/lib/acquisition-src';

/** Bumped when a field's meaning changes. Reported by the contract endpoint. */
export const BRIDGE_CONTRACT_VERSION = '1.3.0';

/**
 * A tag a funnel may attach. Constrained rather than trusted: this arrives from
 * another service, and an unbounded tag write would let a compromised funnel
 * place people into any segment. `route:` is reserved — origin is decided by
 * the registry from the authenticated call, never claimed by the payload.
 */
const TAG_PATTERN = /^[a-z0-9:-]{1,40}$/;

/**
 * UTM parameters, in either spelling.
 *
 * `utm_source` is what a browser query string carries, and `source` is what a
 * form handler naturally names it after stripping the prefix. Both are real,
 * both are in use, so both are accepted and `normaliseUtm` collapses them.
 *
 * Values are `unknown` rather than `string` so a form serialising a null or a
 * number cannot fail the whole payload. normaliseUtm already coerces safely, so
 * strictness here would buy nothing and cost leads.
 */
const utmSchema = z.record(z.string(), z.unknown()).optional();

export const leadPayloadSchema = z.object({
  email: z.string().trim().min(3).max(254),

  name: z.string().trim().max(160).optional(),

  /**
   * The funnel. A registry route id, a legacy source name, or the slug of a
   * funnel launched since the last deploy — the registry resolves all three and
   * registers the last one on sight.
   */
  source: z.string().trim().min(1).max(64).optional(),

  /**
   * Whether the person agreed to ongoing marketing, as distinct from requesting
   * an asset. Omitted means "the route decides", which is the conservative
   * reading; sending `true` without evidence is what turns a mailing list into
   * a liability, so it is stated explicitly rather than defaulted.
   */
  consent: z.boolean().optional(),

  consentMethod: z.string().trim().max(120).optional(),

  /**
   * The funnel's consent *posture*, as distinct from `consent`, which is the
   * answer for this one submission.
   *
   * The two differ exactly where it matters most. A confirmed opt-in funnel
   * sends `consent: false` on capture and `true` on the click, so a route
   * auto-registered from the first lead was recorded as granting no consent at
   * all — and the routes console excludes `none` routes from its "collecting
   * addresses nothing will act on" warning, on the reasonable grounds that
   * such a route was never going to be mailed. A double opt-in funnel was
   * therefore the one kind that could go live with no journey attached and no
   * warning, which is the opposite of what the warning is for.
   *
   * Optional and additive: a caller that omits it gets the old inference.
   */
  consentPolicy: z.enum(['implied', 'explicit', 'confirmed', 'none']).optional(),

  utm: utmSchema,

  /**
   * Where on hybridx.club the address was left (1.3.0): guide-<slug> for an
   * article, page-<path> for another page. Kept on the subscriber, first touch,
   * so an account opened later can be credited to the article that started it.
   *
   * Filtered, not rejected, like tags: a src that is not one of ours costs the
   * src, never the lead.
   */
  src: z.unknown().optional().transform((v) => parseAcquisitionSrc(v)),

  /**
   * Tags are *filtered*, not rejected.
   *
   * Validating them strictly would mean a sixth tag, one capital letter, or a
   * stray punctuation mark failing the whole payload — and since the forward is
   * fire-and-forget, nobody would see the 400s. A cosmetic mistake in a funnel's
   * tag list must cost a tag, never the lead.
   */
  tags: z
    .array(z.unknown())
    .optional()
    .transform((raw) =>
      (raw ?? [])
        .filter((t): t is string => typeof t === 'string' && TAG_PATTERN.test(t))
        // The route: prefix is reserved — origin is decided by the registry from
        // the authenticated call, never claimed by the payload.
        .filter((t) => !t.startsWith('route:'))
        .slice(0, 5),
    ),
});

export type LeadPayload = z.infer<typeof leadPayloadSchema>;

/** Canonical attribution, as stored on the subscriber. */
export interface NormalisedUtm {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

/**
 * Collapse either UTM spelling into the canonical field names.
 *
 * The prefixed form wins when both are present: a caller sending both is most
 * likely forwarding a raw query string alongside its own parsed copy, and the
 * raw one is the source of truth.
 *
 * Empty strings are dropped rather than stored. A form that renders five hidden
 * UTM inputs submits five empty strings when the visitor arrived directly, and
 * storing those would make "no attribution" indistinguishable from "attributed
 * to nothing" in every report that follows.
 */
export function normaliseUtm(
  utm: Record<string, unknown> | undefined,
): NormalisedUtm | undefined {
  if (!utm) return undefined;

  const pick = (prefixed: string, bare: string): string | undefined => {
    const value = utm[prefixed] ?? utm[bare];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length ? trimmed.slice(0, 200) : undefined;
  };

  // Keys with no value are omitted entirely, not set to undefined. The Admin
  // SDK is initialised without `ignoreUndefinedProperties`, so a single
  // undefined value makes the whole document write throw — and this object is
  // written inside captureLead, whose catch would then report the capture as a
  // 500 and skip event emission. A lead with one UTM (the common case) would
  // take down the welcome sequence for that person.
  const normalised: NormalisedUtm = {};
  const assign = (key: keyof NormalisedUtm, value: string | undefined) => {
    if (value !== undefined) normalised[key] = value;
  };

  assign('utmSource', pick('utm_source', 'source'));
  assign('utmMedium', pick('utm_medium', 'medium'));
  assign('utmCampaign', pick('utm_campaign', 'campaign'));
  assign('utmTerm', pick('utm_term', 'term'));
  assign('utmContent', pick('utm_content', 'content'));

  // All five absent means there was no attribution, which should read as
  // undefined rather than an empty object.
  return Object.keys(normalised).length ? normalised : undefined;
}

/**
 * Machine-readable description of the contract, served by the bridge endpoint.
 *
 * The point is that someone building a funnel next year can ask the system what
 * it accepts, rather than copying an existing caller and inheriting whatever
 * that one happens to get wrong.
 */
export function describeContract() {
  return {
    version: BRIDGE_CONTRACT_VERSION,
    endpoint: 'POST /api/marketing/leads',
    auth: 'Authorization: Bearer <LEAD_BRIDGE_SECRET>, or x-bridge-secret header',
    fields: {
      email: { type: 'string', required: true, note: 'Trimmed and lowercased on receipt.' },
      name: { type: 'string', required: false, note: 'Full name; split into first and last.' },
      source: {
        type: 'string',
        required: false,
        note:
          'Funnel identifier. A route id, a legacy source name, or a new slug ' +
          '([a-z0-9][a-z0-9_-]{1,48}) which is registered on first sight.',
      },
      consent: {
        type: 'boolean',
        required: false,
        note: 'Omit to let the route decide. Only send true with real evidence.',
      },
      consentMethod: { type: 'string', required: false },
      consentPolicy: {
        type: "'implied' | 'explicit' | 'confirmed' | 'none'",
        required: false,
        note:
          'How this funnel obtains consent, as opposed to what one submission ' +
          'answered. Send "confirmed" from a double opt-in funnel: without it a ' +
          'route auto-registers from its first (unconsented) lead as "none".',
      },
      utm: {
        type: 'object<string,string>',
        required: false,
        note: 'Accepts utm_source or source, utm_medium or medium, and so on.',
      },
      src: {
        type: 'string',
        required: false,
        note:
          'Where on hybridx.club the address was left: guide-<slug> or page-<path> ' +
          '(lowercase [a-z0-9] and single hyphens, at most 90). Kept first touch on ' +
          'the subscriber. Anything else is dropped, not rejected. Since 1.3.0.',
      },
      tags: {
        type: 'string[]',
        required: false,
        note:
          'Filtered, not rejected: entries that are not lowercase [a-z0-9:-] are ' +
          'dropped, the first 5 kept. The route: prefix is reserved.',
      },
    },
    responds: {
      success: 'boolean',
      created: 'boolean — false when the address was already known',
      route: 'string — the route this lead was filed under',
      suppressed: 'boolean — true when this address must not be mailed',
      status: 'active | unsubscribed | bounced | complained | unknown',
    },
  };
}
