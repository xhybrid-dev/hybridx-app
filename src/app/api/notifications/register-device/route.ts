// src/app/api/notifications/register-device/route.ts
//
// Stores a native app's push token (iOS/Android, via Firebase Cloud
// Messaging) so reminders reach athletes using the app store builds. Until
// this existed, push was web-only, which the native WebView doesn't support,
// so native users got no server reminders at all.
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { requireUser } from '@/lib/api-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['ios', 'android']),
});

export async function POST(request: Request) {
  const auth = await requireUser(request, { bucket: 'notifications:register-device', windowMs: 60_000, max: 10 });
  if ('response' in auth) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });

  try {
    const db = getAdminDb();
    const id = createHash('sha256').update(parsed.data.token).digest('hex');
    await db.collection('pushTokens').doc(id).set({
      userId: auth.uid,
      token: parsed.data.token,
      platform: parsed.data.platform,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection('users').doc(auth.uid).update({
      pushEnabled: true,
      pushEnabledAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('[register-device] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not register device' }, { status: 500 });
  }
}
