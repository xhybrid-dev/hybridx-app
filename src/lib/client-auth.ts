// src/lib/client-auth.ts
'use client';
// Client-side helper for calling our authenticated API routes.
// Attaches the current Firebase user's ID token as a Bearer header, which the
// server verifies via `requireUser` (works on web and in the Capacitor app,
// where the __session cookie is not reliably sent cross-origin).

import { getAuthInstance } from '@/lib/firebase';

/** Returns the current user's Firebase ID token, or null if signed out. */
export async function getIdToken(): Promise<string | null> {
  const auth = await getAuthInstance();
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/**
 * `fetch` wrapper that injects `Authorization: Bearer <idToken>`.
 * Throws if the user is not signed in.
 */
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getIdToken();
  if (!token) throw new Error('You must be signed in to do that.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  // The server runs in UTC and cannot otherwise tell which calendar day the
  // athlete is on, or which day a stored timestamp was meant to be. Sent on
  // every call so no individual caller has to remember to.
  const timeZone = resolveTimeZone();
  if (timeZone) headers.set('X-Time-Zone', timeZone);

  return fetch(input, { ...init, headers });
}

function resolveTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
