// src/lib/marketing/types.ts
//
// Data model for the marketing system. Everything lives in top-level
// `marketing*` collections rather than under `users/{uid}` — `users` holds
// athlete records here, and grafting subscriber subcollections onto them would
// conflate two very different things.
//
// Every one of these collections is admin-read-only from the client and
// written exclusively through the Admin SDK (see `firestore.rules`).

import type { Timestamp, FieldValue } from 'firebase-admin/firestore';

/** A Firestore timestamp as it may appear mid-write or after a read. */
export type Stamp = Timestamp | FieldValue | Date | null;

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

/**
 * Why a subscriber is no longer mailable. Kept as distinct states rather than a
 * single boolean because they carry different obligations: `unsubscribed` is
 * the person's choice, `bounced` is a delivery fact, and `complained` (a spam
 * report) means we must never mail them again under any circumstance.
 */
export type SubscriberStatus = 'active' | 'unsubscribed' | 'bounced' | 'complained';

/** Statuses that permanently exclude someone from a send. */
export const UNMAILABLE_STATUSES: readonly SubscriberStatus[] = [
  'unsubscribed',
  'bounced',
  'complained',
];

/** How an address entered the list — used for attribution and for audit. */
export type SubscriberSource =
  | 'signup'          // created a HybridX account
  | 'landing'         // marketing site capture form
  | 'beta-request'    // Android beta tester form
  | 'admin'           // added by hand in the admin UI
  | 'import'          // CSV or source-project import
  | 'sync'            // back-filled from the users collection
  | 'migration';      // carried over from HXMailer

/**
 * Consent record. Stored as a nested object rather than a bare boolean so the
 * *evidence* travels with the flag — under GDPR you need to show when and how
 * consent was given, not merely that it was.
 */
export interface SubscriberConsent {
  marketing: boolean;
  at: Stamp;
  /** How consent was captured, e.g. 'signup-checkbox', 'landing-form', 'import'. */
  method: string;
  /** Truncated to /24 (IPv4) or /48 (IPv6) — enough to evidence consent, not to track. */
  ip?: string;
}

export interface Subscriber {
  /** Document id is sha256(lowercased email) — dedupe is structural, not a query. */
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tags: string[];
  status: SubscriberStatus;
  source: SubscriberSource;
  /**
   * The intake route this address arrived by — see lib/marketing/sources.ts.
   * Finer-grained than `source`, which only says "a landing page" where this
   * says which one. Mirrored as a `route:<id>` tag so segments can filter on it
   * without a separate index. Absent on records predating the registry.
   */
  route?: string;
  /**
   * Where on hybridx.club this address was first left: guide-<slug> for an
   * article, page-<path> for another page (src/lib/acquisition-src.ts).
   * Sent by the site from contract 1.3.0. Filled in once and never replaced,
   * so it stays first touch. srcAt is when, so a sign-up is credited to it
   * only if the account came after.
   */
  src?: string;
  srcAt?: Timestamp | FieldValue;
  consent: SubscriberConsent;
  /** Set when this address belongs to a HybridX athlete, enabling rich segmentation. */
  userId?: string;
  /**
   * Mirror of the athlete's `programId` as of the last sync, used to detect a
   * programme change and raise `programStarted`. Programmes are assigned by the
   * client writing straight to the user document, so there is no server handler
   * to emit from and a diff is the only reliable signal.
   *
   * `undefined` means never mirrored; `null` means mirrored as having no
   * programme. The distinction matters — it is what stops the first sync after
   * deploy treating every athlete as having just started one.
   */
  lastKnownProgramId?: string | null;
  /**
   * Saved segments this subscriber currently matches, maintained by the
   * `segmentEntered` sweep. Membership is mirrored so that *entry* can be
   * detected as a diff — without it, someone who matches "churn risk" would be
   * re-enrolled every night for as long as they kept matching.
   */
  matchedSegments?: string[];
  // Denormalised lifetime engagement counters, incremented by the tracking routes.
  totalSent?: number;
  openCount?: number;
  clickCount?: number;
  lastSentAt?: Stamp;
  createdAt: Stamp;
  updatedAt?: Stamp;
  /** Why the subscriber became unmailable, when the status is not 'active'. */
  statusReason?: string;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'   // queued; the cron drain is working through it
  | 'sent'
  | 'paused'
  | 'failed';

/**
 * Progress of a queued send. `total` is fixed at enqueue time; the rest advance
 * as the drain runs, so a partially-sent campaign is always inspectable rather
 * than being an opaque in-flight state.
 */
export interface CampaignSendState {
  total: number;
  sent: number;
  failed: number;
  startedAt: Stamp;
  finishedAt: Stamp;
}

export interface Campaign {
  id: string;
  subject: string;
  previewText: string;
  /** Rendered HTML. Derived from `blocks` when present — see lib/marketing/render.ts. */
  htmlBody: string;
  /** Structured content. Absent on campaigns migrated from HXMailer, which are HTML-only. */
  blocks?: unknown[];
  status: CampaignStatus;
  campaignGoal?: string;
  targetAudience?: string;
  targetTags?: string[];
  /** Saved segment this campaign targets, if any. */
  segmentId?: string;
  /** Inline audience definition. What the send flow, the pre-send checklist and
   *  the enqueue all resolve, so the count shown cannot drift from who is mailed. */
  segment?: unknown;
  /** Plain-text alternative, derived from `blocks` alongside `htmlBody`. */
  plainBody?: string;
  /** Subject-line A/B configuration. Absent means a single subject. */
  abTest?: unknown;
  scheduledAt: Stamp;
  sentAt: Stamp;
  recipientCount: number;
  openCount: number;
  clickCount: number;
  unsubscribeCount?: number;
  failedCount?: number;
  sendState?: CampaignSendState;
  /** Set when this campaign is a step inside a journey rather than a one-off broadcast. */
  journeyId?: string;
  journeyStepId?: string;
  folder?: string;
  archived?: boolean;
  ctaUrl?: string;
  ctaLabel?: string;
  createdAt?: Stamp;
  updatedAt?: Stamp;
}

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

/**
 * `sending` is the claimed-but-not-yet-delivered state. A drain moves a row
 * into it transactionally *before* touching SMTP, which is what stops two
 * overlapping cron invocations from both mailing the same person. It also means
 * a row found in `sending` long after the fact was definitely never handed to
 * the mail server, so it is safe to requeue — see recoverStalledSends().
 */
export type SendStatus = 'pending' | 'sending' | 'sent' | 'failed';

/**
 * One row per recipient per campaign. The document id is
 * `${campaignId}_${subscriberId}`, which is what makes the queue idempotent:
 * a retried or double-fired drain cannot create a second send for the same
 * person.
 */
export interface Send {
  id: string;
  campaignId: string;
  subscriberId: string;
  email: string;
  status: SendStatus;
  attempts: number;
  lastError?: string;
  queuedAt: Stamp;
  /**
   * When a drain claimed this row. Stall recovery keys on this, not on
   * `queuedAt` — enqueue time says nothing about whether the drain that
   * claimed the row is still alive.
   */
  claimedAt?: Stamp;
  sentAt: Stamp;
  /** First genuine open. Bot and prefetch opens are counted in `openRaw` only. */
  opened: boolean;
  openedAt: Stamp;
  /** Every recorded open including scanners and Apple Mail Privacy Protection prefetch. */
  openRaw?: number;
  /** A/B variant this send carried; -1 means held back for the winner. */
  variant?: number;
  clicked: boolean;
  clickedAt: Stamp;
  unsubscribed?: boolean;
  unsubscribedAt?: Stamp;
}

export interface LinkClick {
  id: string;
  url: string;
  clickCount: number;
  lastClickedAt: Stamp;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Singleton at `marketingSettings/config`. Note there is no OAuth refresh
 * token: sending goes through Brevo, whose credentials are environment
 * secrets, not user-granted per-mailbox grants.
 */
export interface MarketingSettings {
  senderName: string;
  senderEmail: string;
  replyTo: string;
  /** Messages per drain invocation. Tune against the Brevo plan's rate limit. */
  batchSize: number;
  /** Global cap: max marketing emails one person may receive per rolling week. */
  frequencyCapPerWeek: number;
  /** Master switch — pauses every journey and queued send without losing state. */
  sendingPaused: boolean;
  /**
   * How late a scheduled campaign may be and still send automatically.
   *
   * A campaign whose moment passed longer ago than this is paused for review
   * instead of being sent. Without this, any outage of the send cron turns
   * into a burst: every campaign that came due while it was down goes out at
   * once the moment it recovers, to an audience expecting them spread over
   * days. Nobody wants a Tuesday winback arriving on Friday alongside four
   * others.
   */
  staleScheduleHours: number;
  updatedAt?: Stamp;
}

export const DEFAULT_MARKETING_SETTINGS: MarketingSettings = {
  senderName: 'HYBRIDX',
  senderEmail: '',
  replyTo: '',
  batchSize: 100,
  frequencyCapPerWeek: 3,
  sendingPaused: false,
  staleScheduleHours: 24,
};
