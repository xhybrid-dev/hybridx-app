// src/lib/api-auth.ts
// Shared authentication + rate-limiting helpers for the two ways an athlete's
// own client reaches server code.
//
// `requireUser` guards API routes called directly from the client (web and
// Capacitor mobile). Those send a Firebase ID token in the Authorization
// header: `Authorization: Bearer <idToken>`. This works across origins, so it
// is preferred over the `__session` cookie for app-initiated API calls
// (the cookie is reserved for server-rendered / middleware-gated navigation).
//
// `assertUser` guards Server Actions, which are equally public endpoints but
// cannot carry a custom header — see its own comment for why the cookie is the
// right mechanism there.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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

/**
 * Server-action guard for athlete-owned work.
 *
 * Every export of a `'use server'` module that reaches the client graph becomes
 * a public HTTP endpoint — the action id ships in the browser bundle — so an
 * action is exactly as exposed as a route handler and needs the same check.
 * `src/middleware.ts` is not that check: it only tests that a `__session`
 * cookie is *present*, so any string satisfies it.
 *
 * Actions authenticate by cookie rather than by the bearer token `requireUser`
 * above expects: a server action is invoked by React's own POST, so callers
 * cannot attach an Authorization header. That is safe on every platform here
 * because Capacitor loads the deployed origin directly (`capacitor.config.ts`),
 * so `__session` is same-site for native as well as web, and `AuthProvider`
 * re-establishes it on every auth state change.
 *
 * Throws rather than returning a response, since actions have no
 * `NextResponse` to hand back — the throw surfaces to the client as a failed
 * action. Mirrors `assertAdmin` in `src/lib/admin-auth.ts`.
 *
 * Callers must take the uid from the return value and never from an argument:
 * a `userId` parameter on an action is a request to act on anyone.
 */
export async function assertUser(
  bucket: string,
  opts: { windowMs?: number; max?: number } = {},
): Promise<{ uid: string; email?: string }> {
  const sessionCookie = (await cookies()).get('__session')?.value;
  if (!sessionCookie) throw new Error('Unauthorized: please sign in again.');

  let uid: string;
  let email: string | undefined;
  try {
    // checkRevoked: true — a revoked session loses access immediately rather
    // than at natural cookie expiry, matching getAdminUser().
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    uid = decoded.uid;
    email = decoded.email;
  } catch (err) {
    logger.error(
      `[api-auth] Session cookie verification failed (${bucket}):`,
      err instanceof Error ? err.message : String(err),
    );
    throw new Error('Unauthorized: please sign in again.');
  }

  const rl = checkRateLimit(`${bucket}:${uid}`, opts.windowMs ?? 60_000, opts.max ?? 30);
  if (!rl.allowed) throw new Error('Too many requests. Please wait before trying again.');

  return { uid, email };
}
