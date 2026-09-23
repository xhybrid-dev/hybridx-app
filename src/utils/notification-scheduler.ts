'use client';

/**
 * Utility for scheduling daily workout notifications
 * Hybrid implementation: Support both Web (PWA) and Native (Capacitor)
 */

import { getAuthInstance } from '@/lib/firebase';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativePushRegistered } from '@/lib/native-push';

export interface WorkoutNotificationData {
  workoutTitle: string;
  exercises: string;
}

/**
 * Schedules a daily notification for tomorrow's workout
 */
export async function scheduleDailyNotification(
  workoutData: WorkoutNotificationData,
  preferredTime: { hour: number; minute: number } = { hour: 8, minute: 0 }
): Promise<boolean> {
  try {
    // 1. Generate the AI Message first
    const auth = await getAuthInstance();
    const user = auth.currentUser;
    if (!user) {
      console.error('User not authenticated');
      return false;
    }

    const token = await user.getIdToken();
    let message = `Time for ${workoutData.workoutTitle}!`;

    try {
        const response = await fetch('/api/notifications/generate-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(workoutData),
        });

        if (response.ok) {
            const data = await response.json();
            message = data.message;
        }
    } catch (e) {
        console.warn("AI Message generation failed, using fallback.");
    }

    // Calculate time for tomorrow
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setDate(now.getDate() + 1);
    scheduledTime.setHours(preferredTime.hour, preferredTime.minute, 0, 0);

    // If preferred time is already passed for tomorrow (edge case), add another day? No, tomorrow is fine.
    // If user sets time to 7am and it's currently 8am, tomorrow 7am is correct.

    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
        // === NATIVE IMPLEMENTATION (Capacitor) ===
        // Request permissions first
        const permStatus = await LocalNotifications.requestPermissions();
        if (permStatus.display === 'granted') {
            await LocalNotifications.schedule({
                notifications: [{
                    title: "HYBRIDX Training",
                    body: message,
                    id: 1, // Constant ID to replace previous daily notification
                    schedule: { at: scheduledTime },
                    sound: undefined,
                    attachments: undefined,
                    actionTypeId: "",
                    extra: {
                        url: '/workout/active'
                    }
                }]
            });
            console.log("Native notification scheduled for", scheduledTime);
            return true;
        }
        return false;

    }

    // Web: the server sends the reminder (api/cron/push-notifications). A
    // setTimeout here only fired if the tab stayed open for a day.
    return false;

  } catch (error) {
    console.error('Error scheduling notification:', error);
    return false;
  }
}

/**
 * Checks if a notification should be scheduled and schedules it
 */
export async function checkAndScheduleNotification(
  workoutData: WorkoutNotificationData,
  userPreferredTime?: { hour: number; minute: number }
): Promise<void> {
  
  if (!Capacitor.isNativePlatform()) return;
  // The server reminder reaches this device already; a local one would double up.
  if (isNativePushRegistered()) {
    await cancelScheduledReminder();
    return;
  }

  const stored = localStorage.getItem('workout_notification_schedule');
  const preferredTime = userPreferredTime || { hour: 8, minute: 0 };

  if (!stored) {
    // First time
    const success = await scheduleDailyNotification(workoutData, preferredTime);
    if (success) markAsScheduled(workoutData, preferredTime);
    return;
  }

  try {
    const { lastScheduled } = JSON.parse(stored);
    const lastScheduledDate = new Date(lastScheduled);
    const now = new Date();

    // Reset check time to start of day
    lastScheduledDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);

    // If we haven't scheduled one TODAY (for tomorrow), do it.
    if (lastScheduledDate < now) {
      const success = await scheduleDailyNotification(workoutData, preferredTime);
      if (success) markAsScheduled(workoutData, preferredTime);
    }
  } catch (error) {
    console.error('Error checking notification schedule:', error);
  }
}

function markAsScheduled(data: WorkoutNotificationData, time: any) {
    const notificationData = {
      workoutData: data,
      preferredTime: time,
      lastScheduled: new Date().toISOString(),
    };
    localStorage.setItem('workout_notification_schedule', JSON.stringify(notificationData));
}

/**
 * Shows an immediate test notification
 */
export async function sendTestNotification(message: string): Promise<void> {
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
      await LocalNotifications.requestPermissions();
      await LocalNotifications.schedule({
          notifications: [{
              title: "HYBRIDX Test",
              body: message,
              id: 99,
              schedule: { at: new Date(Date.now() + 1000) }, // 1 second later
          }]
      });
  } else {
      if (Notification.permission !== 'granted') {
        throw new Error('Notification permission not granted');
      }
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification('HYBRIDX Workout', {
        body: message,
        icon: '/icon-maskable-192.png'
      });
  }
}

/** Removes tomorrow's device reminder, e.g. when tomorrow is a rest day. */
export async function cancelScheduledReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
  } catch (error) {
    console.error('Error cancelling reminder:', error);
  }
}
