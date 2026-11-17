# iOS launch plan: from web app to the App Store

Written for someone who has never shipped an iOS app, working from a **Windows PC
plus an iPhone**. It replaces `IOS_APP_STORE_SETUP.md` in the repo root, which
predates the current setup (it says the build runs `next build` and points at
line numbers that have moved).

---

## 1. The short version

- **You don't need a Mac.** Apple only lets Xcode build iOS apps, and Xcode only
  runs on macOS. `codemagic.yaml` already rents a cloud Mac (Codemagic) to do
  the build, code signing and upload for you. Your PC is for accounts, git and
  web changes; your iPhone is the test device.
- **The app is a thin native shell around the live site.** `capacitor.config.ts`
  loads `https://app.hybridx.club` inside a native WebView. Every normal web
  deploy reaches iOS users instantly with no App Store review. You only rebuild
  the iOS app for *native* changes (plugins, permissions, icons, Capacitor
  config).
- **What's left is mostly accounts, paperwork and testing, not coding.** The
  code groundwork is in place (see section 2). Expect roughly **1 to 2 weeks
  elapsed**, most of it waiting on Apple (enrolment, review), with about 6 to 10
  hours of your own work.
- **The biggest approval risk isn't technical.** It's Apple's rules on selling
  subscriptions (section 7, decision D2). Decide how to handle it *before* you
  submit.

---

## 2. Where you are today

**Already built and in the repo:**

| Area | State |
|---|---|
| Capacitor iOS project (`ios/App`), bundle ID `club.hybridx.app`, iOS 14+ | Done |
| Plugins: App, Browser, Filesystem, Local Notifications, Preferences, Push Notifications, Share, Status Bar | Done |
| App icons (all sizes) and splash screen | Done |
| `PrivacyInfo.xcprivacy` (Apple's privacy manifest), `ITSAppUsesNonExemptEncryption=false`, microphone usage text | Done |
| Push code: `AppDelegate.swift` swaps the APNs token for an FCM token; entitlement + background mode set | Done (needs Apple/Firebase accounts, section 5 phase 6) |
| Offline screen (`native-shell/offline.html`) | Done |
| In-app billing hidden: no prices or subscribe buttons in the app, marketing page skipped, via the `HYBRIDXApp/` user agent | Done |
| Account deletion (Profile → Account settings), privacy policy page (`/privacy-policy`) | Done |
| Codemagic workflow `ios-release-workflow`: builds, signs, uploads to TestFlight on a tag `ios-v*`; auto-sets build number and version | Written, never run |
| Store listing copy, privacy answers, review notes (`docs/APP_STORE_LISTING.md`) | Drafted |
| Login | Email and password only, so Apple's "Sign in with Apple" rule (4.8) doesn't apply. **If you ever add Google or Facebook login, you must add Sign in with Apple too.** |

**Not done (this is your to-do list):**
Apple Developer enrolment, App Store Connect app record, API key, Codemagic
setup, first build, TestFlight testing on your iPhone, push setup (APNs key and
Firebase iOS plist), screenshots, reviewer account, listing forms, submission.

---

## 3. Decisions to make first

### D1. Individual or organisation Apple account?
- **Individual**: instant-ish, but the App Store shows **your legal name** as the seller.
- **Organisation**: shows the company name (e.g. "Hybrid X Training Ltd"). Needs a
  legal entity and a **D-U-N-S number** (free, can take 1 to 2 weeks to get).
- Moving an app between the two later is possible but fiddly. If you have, or
  plan to have, a registered company, **start the D-U-N-S request now** and
  enrol as an organisation. If not, enrol as an individual.

### D2. How to handle paid memberships (the main review risk)
Apple guideline 3.1.1 says digital subscriptions sold in an app must use Apple's
In-App Purchase (IAP, Apple takes 15 to 30%). Your current approach: the app
never sells, memberships are bought on the website, and members just sign in.
That's a legitimate pattern (3.1.3(b), "multiplatform services"), but:

- Apple can still reject with "you let people sign up for a trial and then
  have no way to pay in the app". Today a user whose trial ends sees "Your
  free trial has ended." with no route forward.
- Rules differ by country. In the **US storefront**, Apple now allows apps to
  link out to an external purchase page, but that doesn't apply elsewhere.
  Check the current App Review Guidelines before relying on it.

Options, cheapest first:

| Option | Effort | Notes |
|---|---|---|
| **A. Ship as-is** (recommended for v1.0) | None | Submit, explain in the review notes. If rejected on 3.1.1, move to B. Costs one review cycle (1 to 3 days). |
| **B. Add IAP via RevenueCat** | Days of work | Add the RevenueCat Capacitor plugin, create subscription products in App Store Connect, have RevenueCat set the same entitlement Stripe sets. Native code, so needs a new build. `docs/MOBILE_RELEASE.md` already names this as the fix. |
| **C. Reader-style: remove in-app sign-up** | Small | The app only signs in existing members. Cleanest under the rules, but loses in-app acquisition. |

**Recommendation:** go with A, but make the reviewer experience airtight
(reviewer account with full access, clear notes). Plan for B as v1.1 if Apple
pushes back. I can build B when you want it.

### D3. iPhone only, or iPhone and iPad?
The project currently targets both (`TARGETED_DEVICE_FAMILY = "1,2"`). Apple then
**requires 13" iPad screenshots**, and you have no iPad to capture them on.
**Recommendation: iPhone only for v1.** It's a one-line change (set
`TARGETED_DEVICE_FAMILY = 1` in the Xcode project, plus drop the iPad
orientation key). The app still installs on iPads in compatibility mode. Add
proper iPad support later if people ask for it.

---

## 4. What you need

**Accounts (all free except Apple):**
1. **Apple ID** with two-factor authentication on (your iPhone handles this).
2. **Apple Developer Program**: **US$99/year**.
3. **Codemagic** account (codemagic.io), sign in with GitHub. Free tier includes
   a monthly allowance of macOS build minutes (roughly 500 at the time of
   writing, so check). A build takes ~10 to 20 minutes, so that's plenty.
4. **Firebase console** access (already have: project `hyroxedgeai`).

**On your PC:** git, a browser, and that's it. Optional but handy: Canva (or any
editor) for dressing up screenshots.

**On your iPhone:** the free **TestFlight** app, signed in with your Apple ID.

---

## 5. Step by step

### Phase 0: Start the slow things (day 1)
- [ ] Decide D1. If organisation: request a D-U-N-S number at
      developer.apple.com/enroll/duns-lookup.
- [ ] Enrol in the Apple Developer Program: developer.apple.com/programs → Enrol.
      Easiest on your iPhone using the **Apple Developer** app, which handles
      identity verification. Individual approval is often hours to 2 days.
- [ ] Decide D2 and D3 (above).

### Phase 1: Apple setup (after enrolment is approved)
1. **Register the bundle ID.** developer.apple.com → Certificates, Identifiers
   & Profiles → Identifiers → **+** → App IDs → App. Description `HYBRIDX.CLUB`,
   Explicit Bundle ID **`club.hybridx.app`**. Tick the **Push Notifications**
   capability. (If Codemagic creates it for you later, still check the
   capability is on.)
2. **Create the app in App Store Connect.** appstoreconnect.apple.com → Apps →
   **+** → New App. Platform iOS, name `HYBRIDX.CLUB`, primary language English,
   bundle ID `club.hybridx.app`, SKU anything unique (e.g. `hybridx-club-001`),
   user access Full Access. If the name is taken Apple will say so and you'll
   need a variant; the name shown to users can differ from the home-screen name.
3. **Create an App Store Connect API key.** App Store Connect → Users and
   Access → Integrations → App Store Connect API → **+**, name it `codemagic`,
   access **App Manager**. **Download the `.p8` file immediately; Apple only lets
   you download it once.** Note the Key ID and the Issuer ID shown on that page.
   Keep the `.p8` safe (password manager), never commit it.
4. **Create the TestFlight group.** App Store Connect → your app → TestFlight →
   Internal Testing → **+** → name it exactly **`Internal Testers`** → add
   yourself. (Internal testers must be App Store Connect users; you already are.)

### Phase 2: Codemagic setup
1. codemagic.io → sign in with GitHub → **Add application** → pick
   `xhybrid-dev/hybridx-app` → choose the **codemagic.yaml** configuration
   (not the visual workflow editor).
2. Team settings → **Integrations** → **Developer Portal** (App Store Connect) →
   connect using the Issuer ID, Key ID and `.p8`. **Name it exactly
   `hybridx_app_store_connect`**; `codemagic.yaml` refers to that name.
3. Check that `codemagic.yaml` is on `main`, because a tag build uses the file
   from the tagged commit.
4. Android secrets (`hybridx_keystore`, `google_play`) are irrelevant to the iOS
   workflow. Ignore them.

### Phase 3: Small pre-flight fixes (I can do these)
- [ ] Apply D3 (iPhone-only) if you agreed.
- [ ] Delete the stale `IOS_APP_STORE_SETUP.md` (this plan replaces it) and
      fix `docs/MOBILE_RELEASE.md` where it mentions iPad screenshots.
- [ ] Make sure the privacy policy URL is the same everywhere:
      `https://app.hybridx.club/privacy-policy` (the old guide says `/privacy`).
- [ ] Confirm the production push entitlement (see Phase 6). The checked-in
      `App.entitlements` says `aps-environment = development`; App Store
      signing normally rewrites that to `production` from the provisioning
      profile, but verify rather than assume.
- [ ] Add a support page or email on the site (Apple requires a working
      **Support URL**); `docs/APP_STORE_LISTING.md` already notes this.

### Phase 4: First build (the moment of truth)
```bash
git checkout main && git pull
git tag ios-v1.0.0
git push origin ios-v1.0.0
```
Watch it in the Codemagic dashboard. What it does: `npm ci` → `cap sync ios`
(installs CocoaPods) → sets build number from TestFlight → fetches/creates the
signing certificate and profile via your API key → builds the `.ipa` → uploads to
TestFlight. Emails go to `training@hybridx.club`.

**Expect the first run to fail once or twice.** Typical causes and fixes:

| Symptom | Cause | Fix |
|---|---|---|
| "No app found for bundle ID" at the version step | Phase 1 step 2 skipped, or the bundle ID differs | Create the app record; match `club.hybridx.app` exactly |
| Signing/profile error mentioning push | Push capability not ticked on the App ID | Phase 1 step 1, then re-run |
| "Integration hybridx_app_store_connect not found" | Integration named differently or at the wrong level | Rename it, or edit the name in the YAML |
| Pod install / Swift compile error | Dependency drift | Paste the log to me and I'll fix it |
| Build succeeds, nothing in TestFlight for ~20 min | Apple is processing | Wait; you get an email |
| "Missing Compliance" in TestFlight | Export-compliance key missing | Already set (`ITSAppUsesNonExemptEncryption=false`) |

To retry after a fix: tags are immutable in spirit, so use `ios-v1.0.1`, or
use Codemagic's **Start new build** button on the fixed branch.

### Phase 5: Test on your iPhone
1. Install **TestFlight** from the App Store, signed in with the same Apple ID.
2. Open the build invite email (or the TestFlight app) → **Install**.
3. Work through this checklist on the real device:
   - [ ] Launches to the login screen (not the marketing page); splash looks right
   - [ ] Sign in, sign out, sign in again; stay signed in after force-quitting
   - [ ] Status bar and safe areas: nothing hidden under the notch or home bar, in light and dark mode
   - [ ] Today's workout, start it, run the timer, **screen stays awake**, complete it
   - [ ] **Voice note to the coach**: microphone permission prompt appears with your wording, recording and upload work
   - [ ] Strava and Garmin connect flow returns to the app, still logged in
   - [ ] Share/export from a workout opens the native share sheet
   - [ ] Links to other sites open in the in-app browser sheet or Safari, and you can get back
   - [ ] Swipe from the left edge goes back a page
   - [ ] Airplane mode: friendly offline screen, recovers when back online
   - [ ] **No prices, subscribe buttons or trial upsells anywhere**, including as a trial user and after a trial has expired
   - [ ] Delete a throwaway account end to end
   - [ ] No pinch-zoom oddities, keyboard doesn't cover inputs, rotation behaves
4. Any web-side bug: fix, deploy to App Hosting, relaunch the app. No rebuild
   needed. Only native/config changes need a new tag.

### Phase 6: Push notifications
Do this before submitting. Push reminders are one of your best answers to
Apple's "is this just a website?" check (guideline 4.2).
1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → **+** →
   enable **Apple Push Notifications service (APNs)** → download the `.p8`
   (once only) and note the Key ID and your Team ID.
2. Firebase console (project `hyroxedgeai`) → Project settings → **Cloud
   Messaging** → Apple app configuration → upload the APNs key.
3. Firebase → Project settings → General → add an **iOS app** with bundle ID
   `club.hybridx.app` → download **`GoogleService-Info.plist`**. Either commit it
   as `ios/App/App/GoogleService-Info.plist` or add it to Codemagic as a base64
   variable `GOOGLE_SERVICE_INFO_PLIST` (the workflow already decodes it).
4. Tag `ios-v1.0.1`, install the new TestFlight build, allow notifications, then
   send a test from the Firebase console (Messaging → New campaign → test
   message) to confirm a real device receives it. Then confirm the app's own
   reminder job reaches the device too (`docs/NATIVE_PUSH.md`).
5. Re-run `scripts/setup-scheduler-jobs.sh` if you haven't already, so the
   reminder job runs every 15 minutes.

### Phase 7: Store listing assets
**Screenshots** (required): take them from the TestFlight build on your iPhone.
Apple accepts exact pixel sizes only. The current required set is **6.9"
(1320 × 2868)**; if you upload that, Apple scales it for smaller phones.
- If your iPhone is a Pro Max model its native screenshots match or are very
  close. Otherwise, take the screenshots and resize/frame them in Canva or
  similar to the exact size.
- 3 to 10 images. Suggested set from the listing doc: **Today, Plan, Coach,
  Progress, a workout in progress.** Use a clean demo account with a nicely
  populated plan, not your personal data.
- Optional: add short captions and device frames; it lifts conversion.
- iPad screenshots are only needed if you keep iPad support (D3).

**Text:** paste from `docs/APP_STORE_LISTING.md` (name, subtitle, promo text,
description, keywords, what's new). Tweak freely, mind the character limits.

**Other:** App icon (1024px) is already in the build. Support URL, Marketing URL
(hybridx.club), privacy policy URL, copyright line.

### Phase 8: App Store Connect forms
In your app's page:
- **App Privacy**: answer from `docs/APP_STORE_LISTING.md` ("nutrition label"
  section); it must match `PrivacyInfo.xcprivacy`. Data collected: email, name,
  fitness data, user ID, product interaction, audio. **Tracking: No.**
  One inconsistency to resolve: the privacy manifest lists *Analytics* as a
  purpose for User ID and Product Interaction, while the privacy policy says
  "no traditional analytics". Make the three agree.
- **AI disclosure**: your coach sends personal fitness data to Google Gemini.
  Apple's guidelines (5.1.2) now expect clear disclosure of data shared with
  third-party AI and the user's permission. The privacy policy already names
  Gemini; consider also adding a one-line notice at first use of the coach and
  mention it in the review notes.
- **Age rating** questionnaire: should come out 4+.
- **Pricing**: Free. **Availability**: choose countries.
- **Category**: Health & Fitness (secondary Sports).
- **Content rights**: you hold the rights to everything shown.
- **Export compliance**: already declared in the build.
- **App Review Information**:
  - Create a **dedicated reviewer account** on the website with full access
    (active or trial membership *and* a program assigned). Put its email and
    password in the sign-in fields. **A broken or expired demo account is the
    most common avoidable rejection.** Make sure it can't expire during review.
  - Paste the review notes from `docs/APP_STORE_LISTING.md`. Add: where to find
    the native features (voice notes, reminders), and a sentence that memberships
    are managed on the website and the reviewer account already has full access.
  - Your contact phone and email (Apple may call).
- **Version release**: choose *Manually release* for v1.0 so you control launch day.

### Phase 9: Submit
1. App Store Connect → your app → the 1.0 version → under **Build**, pick the
   latest processed TestFlight build (use the push-enabled one).
2. Check every red/yellow warning is cleared → **Add for Review** → **Submit**.
3. Review usually takes **24 to 48 hours** (the first submission can take longer).
   Status: Waiting for Review → In Review → Pending Developer Release (or
   Rejected).
4. If **rejected**, it isn't final. Read the message in **Resolution Center**,
   fix or reply with an explanation, and resubmit. Likely candidates for this
   app, in order of probability:
   - **3.1.1 / 3.1.3** billing: see D2, move to option B if they insist.
   - **4.2** minimum functionality: reply pointing to push reminders, voice
     notes, native share, offline screen, Strava/Garmin connect.
   - **2.1** can't log in / broken demo account / crash: fix and resubmit.
   - **5.1.1(v)** account deletion: already in the app; tell them the path.
   - **5.1.2** AI data sharing: add the disclosure above.
   - Metadata: screenshots that show prices or other platforms, or a name/subtitle
     mismatch.

### Phase 10: Launch and after
- [ ] Release it manually from App Store Connect once approved.
- [ ] Update the website and `hybridx.club` with the App Store badge/link
      (and remove any "coming soon" text). Note: the marketing site must
      not imply that subscriptions can be bought in the app.
- [ ] Optionally use **Phased Release** for updates (7-day staged rollout).
- [ ] Watch **App Store Connect → App Analytics** and **TestFlight/Crashes**
      for the first week; reply to reviews.

**Ongoing:**
- Web changes: deploy as usual, nothing to do for iOS.
- Native changes (new plugin, permission, icon, `capacitor.config.ts`): merge →
  tag `ios-vX.Y.Z` → TestFlight → submit. Each App Store version needs a new
  review.
- Apple raises the minimum Xcode/SDK every spring. `codemagic.yaml` uses
  `xcode: latest`, so builds stay current, but watch emails from Apple about
  deprecations and fix compile warnings when asked.
- The Apple Developer membership renews yearly. If it lapses the app is removed.
- Keep `PrivacyInfo.xcprivacy` and the App Privacy answers in step whenever you
  add a new SDK or data collection.

---

## 6. Suggested timeline

| When | What | Who |
|---|---|---|
| Day 1 | Apple enrolment (+ D-U-N-S if organisation), decide D1 to D3 | You |
| Day 1 to 3 (wait) | Apple approves | Apple |
| Day 3 | Phases 1 and 2: App ID, app record, API key, Codemagic | You |
| Day 3 | Phase 3 code tweaks | Me |
| Day 3 to 4 | Phase 4: first build and fixes | You + me |
| Day 4 to 5 | Phase 5: test on iPhone; Phase 6: push setup, `ios-v1.0.1` | You |
| Day 5 to 6 | Phases 7 and 8: screenshots, forms, reviewer account | You (I draft text) |
| Day 6 | Phase 9: submit | You |
| Day 7 to 10 | Review (and a possible fix-and-resubmit round) | Apple |

If something is sitting in Apple's queue, work on the screenshots and reviewer
account in parallel.

---

## 7. Cost summary

- Apple Developer Program: **US$99/year** (required).
- Codemagic: free tier should cover this; paid usage is metered per minute if you exceed it.
- RevenueCat (only if you go with D2 option B): free until a revenue threshold, then a % of tracked revenue; Apple's 15 to 30% commission applies to in-app sales.
- Everything else (Firebase push, TestFlight, App Store Connect) is free.

---

## 8. Things worth knowing as a first-timer

- **Bundle ID** (`club.hybridx.app`) is permanent once the app is created; never change it.
- **Version vs build number**: version (1.0.0) is what users see; build number
  must go up on every upload. Codemagic sets both automatically from the tag and
  TestFlight.
- **TestFlight builds expire after 90 days**; the App Store version doesn't.
- **Certificates and profiles** are managed for you by Codemagic through the API
  key; you will not need to touch Keychain or a CSR on a Mac.
- **Your `.p8` keys** (App Store Connect API, APNs) are shown once. Losing one
  isn't fatal; you can revoke and make a new one, but store them properly.
- **Apple's first-time review is the slowest.** Don't schedule a launch event
  until you're approved.
- If you get stuck, paste the Codemagic log or Apple's rejection text to me;
  most problems here are quick fixes.
