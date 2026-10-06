# Releasing the Android and iOS apps

The store apps are Capacitor shells around the live site: `capacitor.config.ts`
points `server.url` at `https://app.hybridx.club`, so web changes reach app
users on every App Hosting deploy with no store release. A new store build is
only needed for native changes (plugins, permissions, SDK levels, icons,
`capacitor.config.ts`) or a store policy deadline.

Only `native-shell/` is bundled into the apps: `offline.html` is shown when the
site can't be reached, instead of a blank screen.

Builds run on Codemagic (`codemagic.yaml`).

## iOS first-release checklist

Do these in order; the first block needs only an Apple Developer account.

1. Enrol in the Apple Developer Program (developer.apple.com/programs). An
   organisation enrolment needs a D-U-N-S number; an individual one doesn't.
   Approval can take a day or two.
2. Apple Developer -> Certificates, Identifiers & Profiles -> Identifiers ->
   `club.hybridx.app` (register it if missing) -> enable **Push Notifications**.
3. App Store Connect -> My Apps -> **+** -> New App: iOS, name `HYBRIDX.CLUB`,
   bundle ID `club.hybridx.app`, any SKU (e.g. `hybridx-club-001`).
4. App Store Connect -> Users and Access -> Integrations -> App Store Connect
   API -> generate a key (access: App Manager). Download the `.p8` once. In
   Codemagic -> Team settings -> Integrations -> Developer Portal, connect it
   under the name `hybridx_app_store_connect`.
5. TestFlight tab -> Internal Testing -> create the group **Internal Testers**
   and add yourself.
6. Push a tag `ios-v1.0.0`. Codemagic builds, signs (it creates the
   certificate and profile through the API key) and uploads to TestFlight.
7. Install TestFlight on your iPhone and test (see the list in this doc's
   "Native behaviour" section).
8. Push notifications: Apple Developer -> Keys -> new key with APNs enabled
   (`.p8`) -> upload in Firebase console -> Project settings -> Cloud
   Messaging; add `GoogleService-Info.plist` (see `docs/NATIVE_PUSH.md`); tag
   `ios-v1.0.1`.
9. Fill in the listing from `docs/APP_STORE_LISTING.md`, pick the build, create
   a reviewer account, **Submit for Review**. Review usually takes 1 to 2 days.

Build numbers and the app version are set automatically: the build number is
TestFlight's latest + 1 and the version comes from the tag (`ios-v1.0.0` ->
1.0.0).

## Native behaviour (what differs from the website)

- **Back button (Android):** closes an open dialog or menu first, then goes back
  a page, and exits only from the first page (`src/components/native-app-bridge.tsx`).
- **Status bar:** icon colour follows the app's light/dark theme.
- **iOS swipe back:** a swipe in from the left edge goes back a page (`MainViewController` in `AppDelegate.swift`).
- **Other websites:** Capacitor opens other domains in the phone's browser.
  Strava and Garmin sign-in are the exception (`allowNavigation` in
  `capacitor.config.ts`) so their OAuth redirect returns to the logged-in app.
  Links meant to leave the app should use `openExternal()` from
  `src/lib/native.ts` (in-app browser sheet).
- **Files and sharing:** web downloads don't work in the Android WebView. Use
  `saveFile()` / `shareContent()` from `src/lib/native.ts`, which open the
  native share sheet in the apps.
- **Plugins** are native code: adding or upgrading one needs `npx cap sync`
  and a new store build, not just a web deploy.

## Android (Google Play)

**Ship a release:** merge to `main`, then push a tag `v<version>` (e.g.
`v1.0.3`). The *Android Capacitor Build (Release)* workflow builds a signed
`.aab`. It sets `versionCode` to Play's latest + 1 and `versionName` from the
tag. Upload the `.aab` in Play Console → Test and release → (track) → Create new
release → **Upload**, never "Add from library" for an old bundle.

One-time setup:
- Codemagic → Team → Code signing → Android keystores: the upload keystore,
  reference name `hybridx_keystore`.
- Codemagic → environment group `google_play` with
  `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`: a Google Cloud service account JSON
  that has been invited in Play Console → Users and permissions (release
  permissions for this app). Without it the build still works, but falls back
  to the `versionCode` in `android/app/build.gradle`.
- Each Play track needs **Countries/regions** set before its first rollout.

Target API: Play requires a new target SDK every August. Currently 36
(`android/variables.gradle`).

## iOS (App Store)

**Ship a build:** push a tag `ios-v<version>`. The *iOS Capacitor Build
(Release)* workflow builds, signs and uploads to TestFlight (Internal
Testers). Submit for review from App Store Connect.

One-time setup:
- Apple Developer Program membership.
- App Store Connect → My Apps → **+** → New App, bundle ID `club.hybridx.app`.
  The workflow finds the app by bundle ID.
- App Store Connect → Users and Access → Integrations → App Store Connect API
  → create a key (App Manager), add it in Codemagic → Team → Integrations →
  Developer Portal under the name `hybridx_app_store_connect`.
- Apple Developer → Identifiers → `club.hybridx.app` → enable **Push
  Notifications** (the entitlement is in `ios/App/App/App.entitlements`).
- Push: see `docs/NATIVE_PUSH.md` (APNs key → Firebase, `GoogleService-Info.plist`).
- Create an "Internal Testers" group in TestFlight (the workflow uploads to it).
- App Store listing: screenshots (6.9" iPhone and 13" iPad, since the app
  supports iPad), description, keywords, support URL, privacy policy URL
  (`https://app.hybridx.club/privacy-policy`), App Privacy answers, age
  rating, and a reviewer demo account.

## Store policy watch-outs

- **Digital subscriptions.** Apple (3.1.1) and Google Play billing policy
  require their own in-app purchase for digital subscriptions sold in an app.
  The apps therefore never sell: no prices, no subscribe or resume buttons, and
  the marketing page is skipped (`useIsNativeApp`, and the `HYBRIDXApp/` user
  agent check in `src/app/page.tsx`). Members who subscribed on the website are
  recognised by their account; pause and cancel stay available. Apple can still
  ask for in-app purchase for a paid service with no way to buy in the app. If
  review insists, the fix is store billing (e.g. RevenueCat) granting the same
  entitlement Stripe sets.
- **Apple 4.2 (minimum functionality).** Apps that only wrap a website get
  rejected. Point reviewers at the native features: push reminders, on-device
  workout reminders, voice notes to the coach.
- **Account deletion** is required by both stores; it exists in Profile →
  Account settings.
