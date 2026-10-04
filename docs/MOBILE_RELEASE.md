# Releasing the Android and iOS apps

The store apps are Capacitor shells around the live site: `capacitor.config.ts`
points `server.url` at `https://app.hybridx.club`, so web changes reach app
users on every App Hosting deploy with no store release. A new store build is
only needed for native changes (plugins, permissions, SDK levels, icons,
`capacitor.config.ts`) or a store policy deadline.

Only `native-shell/` is bundled into the apps: `offline.html` is shown when the
site can't be reached, instead of a blank screen.

Builds run on Codemagic (`codemagic.yaml`).

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

- **Digital subscriptions.** The subscription page sells through Stripe.
  Apple (3.1.1) and Google Play billing policy generally require their own
  in-app purchase for digital subscriptions sold inside the app. Either hide
  purchasing in the native apps (users subscribe on the web) or add in-app
  purchases. Decide before submitting to Apple.
- **Apple 4.2 (minimum functionality).** Apps that only wrap a website get
  rejected. Point reviewers at the native features: push reminders, on-device
  workout reminders, voice notes to the coach.
- **Account deletion** is required by both stores; it exists in Profile →
  Account settings.
