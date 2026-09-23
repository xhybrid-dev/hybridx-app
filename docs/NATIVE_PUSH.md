# Native push (iOS & Android app builds)

Workout reminders reach the app-store builds through Firebase Cloud Messaging.
The server side is done: `/api/notifications/register-device` stores each
device's token in `pushTokens`, and `sendPushToUser` (`src/lib/web-push.ts`)
delivers to those tokens alongside web push. Until a device has a working
token, the app keeps scheduling an on-device reminder for tomorrow's session
instead (`src/utils/notification-scheduler.ts`).

Three native steps are needed before tokens arrive.

## 1. Sync the plugin into both native projects

```bash
npm install
npx cap sync
```

Then rebuild both apps. Until this ships, the plugin call fails quietly and the
on-device reminder continues as before.

## 2. Android

`android/app/google-services.json` is already present and the Google
Services plugin is applied, so Android returns FCM tokens as soon as the build
includes the plugin. Nothing else to do.

## 3. iOS

- Firebase console → Project settings → Cloud Messaging → upload an APNs
  authentication key (.p8) for the `club.hybridx.app` bundle.
- Xcode → App target → Signing & Capabilities → add **Push Notifications** and
  **Background Modes → Remote notifications**.
- Add `GoogleService-Info.plist` to `ios/App/App` and the `FirebaseMessaging`
  pod, then forward the FCM token instead of the raw APNs token, following
  Capacitor's "Using Push Notifications with Firebase" guide (the
  `AppDelegate.swift` changes in its iOS section).

Without the last step, iOS hands the app a raw 64-character APNs token. The
client detects that (`src/lib/native-push.ts`) and doesn't register it, so iOS
users keep the on-device reminder rather than getting a broken token.

## Scheduler

The reminder job now runs every 15 minutes and sends at each athlete's chosen
time in their own timezone. Re-run `scripts/setup-scheduler-jobs.sh` once to
update the existing `push-notifications` Cloud Scheduler job from `0 7 * * *`.
