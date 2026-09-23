// Client-side analytics service — fire-and-forget, never throws
'use client';

import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Capacitor } from '@capacitor/core';

export type AnalyticsEventName =
  | 'signup_page_viewed'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'login'
  | 'logout'
  | 'session_start'
  | 'session_end'
  | 'page_view'
  | 'pwa_prompt_shown'
  | 'pwa_install_accepted'
  | 'pwa_install_dismissed'
  | 'workout_started'
  | 'workout_completed'
  | 'workout_skipped'
  | 'strava_connected'
  | 'garmin_connected'
  | 'notifications_enabled'
  | 'workout_postponed';

export function getPlatform(): string {
  if (typeof window === 'undefined') return 'server';
  const native = Capacitor.getPlatform();
  if (native === 'ios') return 'ios';
  if (native === 'android') return 'android';
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;
  return isStandalone ? 'pwa' : 'web';
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') return 'ssr';
  let sid = sessionStorage.getItem('_axSid');
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem('_axSid', sid);
  }
  return sid;
}

export function trackEvent(
  userId: string | null,
  event: AnalyticsEventName,
  properties?: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      await addDoc(collection(db, 'analyticsEvents'), {
        userId: userId ?? 'anonymous',
        event,
        properties: properties ?? {},
        platform: getPlatform(),
        sessionId: getSessionId(),
        timestamp: serverTimestamp(),
      });
    } catch {
      // analytics must never crash the app
    }
  })();
}

export function updateUserMeta(
  userId: string,
  data: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        ...data,
        lastSeenAt: serverTimestamp(),
      });
    } catch {
      // silent
    }
  })();
}
