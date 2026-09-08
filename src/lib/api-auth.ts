// src/lib/api-auth.ts
// Shared authentication + rate-limiting helper for API routes that are called
// directly from the client (web and Capacitor mobile).
//
// Clients authenticate by sending a Firebase ID token in the Authorization
// header: `Authorization: Bearer <idToken>`. This works across origins, so it
// is preferred over the `__session` cookie for app-initiated API calls
// (the cookie is reserved for server-rendered / middleware-gated navigation).

import { NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import { normaliseTimeZone } from '@/lib/program-day';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export interface AuthedRequest {
  uid: string;
  email?: string;
  /**
   * The athlete's IANA timezone, sent by `authedFetch` on every call. The
   * server runs in UTC and cannot otherwise tell which calendar day they are
   * on — see lib/program-day.ts. Undefined when the header is absent or is not
   * a zone Intl recognises.
   */
  timeZone?: string;
}

/**
 * Verify the caller's Firebase ID token and apply a per-user rate limit.
 *
 * On success returns `{ uid, email }`. On failure returns a ready-to-send
 * `NextResponse` (401 / 429) — callers should check with `'response' in result`.
 *
 * @param request   Incoming request (must carry `Authorization: Bearer <idToken>`)
 * @param opts.bucket   Rate-limit namespace, e.g. `"ai:race-plan"`
 * @param opts.windowMs Rolling window in ms (default 60s)
 * @param opts.max      Max requests per window per user (default 10)
 */
export async function requireUser(
  request: Request,
  opts: { bucket: string; windowMs?: number; max?: number },
): Promise<AuthedRequest | { response: NextResponse }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const token = authHeader.substring(7);
  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email;
  } catch (err) {
    logger.error(`[api-auth] Token verification failed (${opts.bucket}):`, err instanceof Error ? err.message : String(err));
    return { response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }

  const rl = checkRateLimit(`${opts.bucket}:${uid}`, opts.windowMs ?? 60_000, opts.max ?? 10);
  if (!rl.allowed) {
    return {
      response: NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      ),
    };
  }

  return { uid, email, timeZone: normaliseTimeZone(request.headers.get('x-time-zone')) };
}
