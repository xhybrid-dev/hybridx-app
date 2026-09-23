// src/app/api/auth/reset-password/route.ts
//
// Emails a password-reset link through our own transport (Brevo/Gmail), for
// the same inbox-placement reason as send-verification. Unauthenticated by
// nature, so it is rate-limited per IP and per address, and it answers the
// same way whether or not the address has an account.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminAuth } from '@/lib/firebase-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendPasswordResetEmail } from '@/lib/email-service';
import { getUser } from '@/services/user-service';
import { logger } from '@/lib/logger';

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`reset-password:ip:${ip}`, 15 * 60_000, 10).allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  const { email } = parsed.data;

  // Quietly cap repeats to one address, without telling the caller anything new.
  if (!checkRateLimit(`reset-password:email:${email}`, 60 * 60_000, 3).allowed) {
    return NextResponse.json({ success: true });
  }

  let link: string;
  let firstName: string | undefined;
  try {
    link = await getAdminAuth().generatePasswordResetLink(email);
    try {
      const record = await getAdminAuth().getUserByEmail(email);
      firstName = (await getUser(record.uid))?.firstName || undefined;
    } catch {
      /* personalisation is best-effort */
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/user-not-found' || code === 'auth/email-not-found') {
      return NextResponse.json({ success: true });
    }
    logger.error('[reset-password] link generation failed:', code ?? (err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ success: true, fallback: true });
  }

  const result = await sendPasswordResetEmail(email, link, firstName);
  // Our transport failed; the client falls back to Firebase's own sender.
  return NextResponse.json(result.success ? { success: true } : { success: true, fallback: true });
}
