'use client';
// src/lib/native-push.ts
//
// Push for the iOS/Android app builds, through Firebase Cloud Messaging. The
// web push the app used everywhere does not exist inside the native WebView,
// so app-store users never received a server reminder.
//
// iOS note: the plugin hands back an FCM token only once the Firebase
// Messaging bridge is added to the Xcode project (see docs/NATIVE_PUSH.md).
// Until then it returns a raw APNs token, which FCM can't use; that is
// detected and not registered, and iOS keeps its on-device reminder.

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { authedFetch } from '@/lib/client-auth';
import { logger } from '@/lib/logger';

const REGISTERED_KEY = 'native-push-registered';

/** True once this device has a working server push token. */
export function isNativePushRegistered(): boolean {
  try {
    return localStorage.getItem(REGISTERED_KEY) === '1';
  } catch {
    return false;
  }
}

function setRegistered(value: boolean) {
  try {
    if (value) localStorage.setItem(REGISTERED_KEY, '1');
    else localStorage.removeItem(REGISTERED_KEY);
  } catch {
    /* ignore */
  }
}

const looksLikeRawApnsToken = (token: string) => /^[0-9a-f]{64}$/i.test(token);

let listenersAdded = false;

function addListeners(onOpen: (url: string) => void) {
  if (listenersAdded) return;
  listenersAdded = true;

  void PushNotifications.addListener('registration', async ({ value: token }) => {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios' && looksLikeRawApnsToken(token)) {
      logger.log('[native-push] iOS returned an APNs token; FCM bridge not installed yet — using device reminders.');
      setRegistered(false);
      return;
    }
    try {
      const response = await authedFetch('/api/notifications/register-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, platform }),
      });
      setRegistered(response.ok);
    } catch (error) {
      logger.error('[native-push] could not register device:', error);
    }
  });

  void PushNotifications.addListener('registrationError', error => {
    logger.error('[native-push] registration failed:', error);
    setRegistered(false);
  });

  void PushNotifications.addListener('pushNotificationActionPerformed', action => {
    const url = action.notification.data?.url;
    onOpen(typeof url === 'string' && url.startsWith('/') ? url : '/dashboard');
  });
}

/** Ask for permission and register. Returns whether notifications are allowed. */
export async function enableNativePush(onOpen: (url: string) => void = () => {}): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    addListeners(onOpen);
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return false;
    await PushNotifications.register();
    return true;
  } catch (error) {
    // The plugin isn't in this native build yet (needs `npx cap sync`).
    logger.error('[native-push] unavailable:', error);
    return false;
  }
}

/** On app start: refresh the token if permission was already given (tokens rotate), and handle taps. */
export async function resumeNativePush(onOpen: (url: string) => void): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    addListeners(onOpen);
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'granted') await PushNotifications.register();
  } catch (error) {
    logger.error('[native-push] unavailable:', error);
  }
}
