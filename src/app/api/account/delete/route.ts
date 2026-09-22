// src/app/api/account/delete/route.ts
//
// Self-serve account deletion. App Store guideline 5.1.1(v) requires apps that
// create accounts to let people delete them in-app, and until now only an
// admin could. Order matters: stop billing first, then personal data, then the
// sign-in itself, so a failure part-way never leaves a paying account with no
// way to sign in and cancel.
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireUser } from '@/lib/api-auth';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { subscriberId, SUBSCRIBERS } from '@/lib/marketing/subscribers';
import { logger } from '@/lib/logger';

/** Every collection holding an athlete's own documents, keyed by a userId field. */
const PER_USER_COLLECTIONS = [
  'workoutSessions',
  'journalEntries',
  'coachNotes',
  'coachConversations',
  'notifications',
  'pushSubscriptions',
  'pushTokens',
  'analyticsEvents',
  'garminActivities',
];

const bodySchema = z.object({ confirm: z.literal('DELETE') });

async function deleteWhereUser(db: FirebaseFirestore.Firestore, collection: string, uid: string) {
  for (;;) {
    const page = await db.collection(collection).where('userId', '==', uid).limit(400).get();
    if (page.empty) return;
    const batch = db.batch();
    page.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (page.size < 400) return;
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request, { bucket: 'account:delete', windowMs: 60 * 60_000, max: 3 });
  if ('response' in auth) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 });

  const db = getAdminDb();
  const uid = auth.uid;
  const userRef = db.collection('users').doc(uid);

  try {
    const user = (await userRef.get()).data();

    if (user?.subscriptionId && process.env.STRIPE_SECRET_KEY) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
      try {
        await stripe.subscriptions.cancel(user.subscriptionId);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        // Already gone is fine; anything else must stop us deleting a paying account.
        if (code !== 'resource_missing') throw err;
      }
    }

    for (const collection of PER_USER_COLLECTIONS) {
      await deleteWhereUser(db, collection, uid);
    }

    const email = user?.email ?? auth.email;
    if (email) await db.collection(SUBSCRIBERS).doc(subscriberId(email)).delete().catch(() => {});

    // The user document and its subcollections (personal plans).
    await db.recursiveDelete(userRef);
    await getAdminAuth().deleteUser(uid);

    const response = NextResponse.json({ success: true });
    response.cookies.set('__session', '', { maxAge: 0, path: '/' });
    return response;
  } catch (err) {
    logger.error('[account/delete] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: 'Could not finish deleting your account. Please try again, or contact training@hybridx.club.' },
      { status: 500 },
    );
  }
}
