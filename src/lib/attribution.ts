// First-touch marketing attribution: captures UTM params, and the marketing
// site's `src`, from the URL on a visitor's first load of the app and persists
// them so they can be attached to the user record at signup. Lets
// trial-to-paid conversions be traced back to the campaign, article, tool or
// page that drove them.
//
// Two kinds of origin, kept apart on purpose:
//
//   - utm_* are campaigns: an email (`utm_campaign=<campaignId>`, see
//     withCampaignAttribution in marketing/personalise.ts), an ad, a social
//     post. getCampaignConversions reports on them.
//   - src is where on hybridx.club the visitor clicked through from:
//     `guide-<slug>` for an article, `page-<path>` for any other page
//     (src/lib/acquisition-src.ts). hybridx.club adds it to every link into
//     the app. UTM tags on links between our own two domains would start a new
//     GA4 session (the two are already joined by GA4's linker) and would be
//     counted as campaigns.

import { parseAcquisitionSrc, SRC_PARAM } from './acquisition-src';

const STORAGE_KEY = 'hx_attribution';

export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  /** Where on hybridx.club the visitor came from, e.g. guide-sled-push-technique. */
  src?: string;
  landingPage?: string;
  referrer?: string;
  capturedAt: string;
}

const UTM_KEYS: Array<[string, keyof Omit<Attribution, 'capturedAt' | 'landingPage' | 'referrer' | 'src'>]> = [
  ['utm_source', 'utmSource'],
  ['utm_medium', 'utmMedium'],
  ['utm_campaign', 'utmCampaign'],
  ['utm_term', 'utmTerm'],
  ['utm_content', 'utmContent'],
];

/**
 * The attribution a landing URL carries, or null when it carries none.
 * Pure, so the rules can be tested without a browser.
 */
export function attributionFromUrl(
  search: string,
  landingPage: string,
  referrer: string,
  now: Date,
): Attribution | null {
  const params = new URLSearchParams(search);
  const src = parseAcquisitionSrc(params.get(SRC_PARAM));
  const hasUtm = UTM_KEYS.some(([param]) => !!params.get(param));
  if (!hasUtm && !src) return null;

  const attribution: Attribution = { capturedAt: now.toISOString() };
  for (const [param, key] of UTM_KEYS) {
    const value = params.get(param);
    if (value) attribution[key] = value.slice(0, 200);
  }
  if (src) attribution.src = src;
  attribution.landingPage = landingPage;
  if (referrer) attribution.referrer = referrer;
  return attribution;
}

/**
 * Captures attribution on the visitor's first load. No-ops if attribution is
 * already stored (first-touch, not last-touch) or if the current URL carries
 * no UTM params and no valid src.
 *
 * First-touch means a campaign or page gets credit only where it was the
 * visitor's first contact with the app: it under-counts rather than
 * over-claims, the same rule getCampaignConversions follows.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;

    const attribution = attributionFromUrl(
      window.location.search,
      window.location.pathname,
      document.referrer,
      new Date(),
    );
    if (!attribution) return;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // localStorage unavailable (private mode, etc.) — attribution is
    // best-effort and should never block the app.
  }
}

/** Reads the stored first-touch attribution, if any was captured. */
export function getAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
