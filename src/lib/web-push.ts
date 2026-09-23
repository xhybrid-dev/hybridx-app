// Server-side web push sender — never import from client code
import webpush from 'web-push';
import { getAdminDb, getAdminMessaging } from '@/lib/firebase-admin';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:training@hybridx.club';

let initialized = false;
function ensureInit() {
  if (initialized) return;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  initialized = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
  createdAt: Date;
  platform?: string;
}

/**
 * Send a push notification to a single subscription. 'gone' means the
 * browser has dropped it (404/410) and it should be deleted; any other failure
 * is reported as 'error' and the subscription is kept for next time.
 */
export async function sendPushToSubscription(
  subscription: webpush.PushSubscription,
  payload: PushPayload
): Promise<'ok' | 'gone' | 'error'> {
  ensureInit();
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url ?? '/dashboard',
        icon: payload.icon ?? '/icon-maskable-192.png',
        badge: payload.badge ?? '/icon-maskable-192.png',
      })
    );
    return 'ok';
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 410 || status === 404) return 'gone';
    console.error('Push send error:', status, (err as { body?: unknown })?.body);
    return 'error';
  }
}

/** FCM error codes meaning the device token is gone for good. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Native app devices (iOS/Android) via Firebase Cloud Messaging. */
async function sendNativePush(userId: string, payload: PushPayload): Promise<{ sent: number; cleaned: number }> {
  const db = getAdminDb();
  const snap = await db.collection('pushTokens').where('userId', '==', userId).get();
  if (snap.empty) return { sent: 0, cleaned: 0 };

  const docs = snap.docs;
  const response = await getAdminMessaging().sendEachForMulticast({
    tokens: docs.map(d => d.get('token') as string),
    notification: { title: payload.title, body: payload.body },
    data: { url: payload.url ?? '/dashboard' },
    apns: { payload: { aps: { sound: 'default' } } },
  });

  const batch = db.batch();
  let cleaned = 0;
  response.responses.forEach((result, index) => {
    if (!result.success && result.error && DEAD_TOKEN_CODES.has(result.error.code)) {
      batch.delete(docs[index].ref);
      cleaned++;
    }
  });
  if (cleaned > 0) await batch.commit();
  return { sent: response.successCount, cleaned };
}

/** Send to every device a user has: web push subscriptions and native app tokens. Cleans up dead ones. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; cleaned: number }> {
  const db = getAdminDb();
  let sent = 0;
  let cleaned = 0;

  try {
    const native = await sendNativePush(userId, payload);
    sent += native.sent;
    cleaned += native.cleaned;
  } catch (err) {
    console.error('Native push send error:', err instanceof Error ? err.message : err);
  }

  const snap = await db
    .collection('pushSubscriptions')
    .where('userId', '==', userId)
    .get();

  if (snap.empty) return { sent, cleaned };
  ensureInit();

  const cleanupBatch = db.batch();
  let needsCleanup = false;

  for (const doc of snap.docs) {
    const sub = doc.data() as PushSubscriptionRecord;
    const result = await sendPushToSubscription(
      { endpoint: sub.endpoint, keys: sub.keys },
      payload
    );
    if (result === 'ok') {
      sent++;
    } else if (result === 'gone') {
      cleanupBatch.delete(doc.ref);
      needsCleanup = true;
      cleaned++;
    }
  }

  if (needsCleanup) await cleanupBatch.commit();
  return { sent, cleaned };
}
