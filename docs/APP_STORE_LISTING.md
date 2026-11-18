# App Store submission content: paste-ready

Everything to enter in App Store Connect for v1.0. Limits are Apple's. Work down
the headings in the order App Store Connect shows them. Items marked **YOU** need
a decision or an asset from you.

---

## 1. App Information

| Field | Value |
|---|---|
| Name (30) | `HYBRIDX.CLUB` (App Store Connect currently shows `HybridX.club`; change it under App Information → Name if you want the capitals) |
| Subtitle (30) | `Hybrid & HYROX training plans` (29) |
| Primary category | Health & Fitness |
| Secondary category | Sports |
| Content rights | "Does not contain, show, or access third-party content" is **not** quite true: Strava and Garmin data is the athlete's own and imported at their request. Answer **No** to "contains third-party content", unless App Store Connect's wording says otherwise. |
| Age rating | See section 5 |
| Copyright | `2026 Hybrid X Training` |

## 2. Version 1.0 page

**Promotional text** (170, editable any time without review) (168 now)
```
Train for HYROX and hybrid racing with plans that adapt to your week. Tell your
coach about sore legs or a busy schedule and it reworks what's ahead.
```

**Description** (4000)
```
HYBRIDX.CLUB is your training partner for HYROX and hybrid racing: running,
strength and the stations in between, in one plan that fits your week.

TRAINING PLANS THAT ADAPT
- Pick a program built for your goal and experience, or let the AI build a
  session for today.
- Busy week, sore legs, holiday coming? Tell your coach and it reworks the
  sessions ahead. You approve every change.
- Training for a race? Set the date and your plan finishes on race day.

TRACK EVERYTHING
- Log workouts, personal records and running paces.
- Weekly streaks that count weeks, so rest days never break them.
- Progress charts and training load at a glance.

TALK TO YOUR COACH
- Send a quick voice note or message after a session and get feedback that
  knows your plan.

STAY ON TRACK
- Workout reminders at the time you choose.
- Connect Strava and Garmin to bring in your activities.

Sign in with your HYBRIDX.CLUB account to train in the app.

HYBRIDX.CLUB is an independent training app. It is not affiliated with,
sponsored by or endorsed by HYROX, Strava or Garmin.
```
Notes:
- The old closing line "Membership is managed on the HYBRIDX.CLUB website" is
  removed on purpose: Apple (3.1.1) can treat any pointer to buying outside the
  app as steering. Keep the app's listing, screenshots and text free of prices
  and "subscribe on our website".
- The disclaimer matters: "HYROX" is someone else's trademark. Apple can reject
  metadata that implies affiliation (guideline 5.2). Keeping "HYROX" in the
  subtitle and keywords is a judgement call; if Apple objects, drop it from the
  name/subtitle first and keep it only in the description.

**Keywords** (100, comma-separated, no spaces) (88 now, room for more)
```
hyrox,hybrid,training,workout,running,fitness,strength,race,coach,plan,crossfit,marathon
```
Don't repeat words from the name or subtitle (Apple already indexes them).
Optional extras if you want to use the spare 12 characters: `engine,pacing`.

**What's New** (4000)
```
First release of the HYBRIDX.CLUB app.
```

**Support URL:** a page with a contact email. **YOU**: confirm which page; the
site root `https://hybridx.club` is fine if it shows a contact email.
**Marketing URL (optional):** `https://hybridx.club`
**Privacy Policy URL:** `https://hybridx.club/privacy-policy`

## 3. Screenshots

Take them from the TestFlight build on your iPhone, using a demo account with a
full plan (not your personal data). Size: **6.9" iPhone, 1320 x 2868**. Apple
scales them down for smaller phones, so this one set is enough. The app is
iPhone-only, so there are no iPad screenshots.

| # | Screen | Suggested caption |
|---|---|---|
| 1 | Today's workout on the dashboard | "Your session for today, ready to go" |
| 2 | The plan / calendar view | "A plan that finishes on race day" |
| 3 | Workout in progress with the timer | "Log every set, run and station" |
| 4 | Coach chat or voice note | "Tell your coach, your plan adapts" |
| 5 | Progress: streak, PRs, training load | "See your consistency build" |
| 6 | Strava / Garmin connection (optional) | "Bring in your watch data" |

Rules to keep review smooth: no prices, no "free trial" or "subscribe" text, no
other platforms' logos or devices, no status bar clutter (Simulator or a clean
phone: full battery, a normal time).

## 4. App Privacy (the "nutrition label")

App Store Connect → App Privacy → **Get Started**. These answers describe what
the app and its servers collect, and they match `ios/App/App/PrivacyInfo.xcprivacy`.

**Do you or your third-party partners collect data from this app?** Yes.

All of it is **linked to the user**. **Used for tracking: No** for every item
(no ads, no data brokers, no cross-app tracking).

| Data type | Collected for | What it is |
|---|---|---|
| Contact Info → **Email Address** | App Functionality; Developer's Advertising or Marketing | Sign-in, account emails, and the trial and training emails you send |
| Contact Info → **Name** | App Functionality | First and last name |
| Health & Fitness → **Health** | App Functionality; Product Personalization | Body weight and injury history, entered by the athlete |
| Health & Fitness → **Fitness** | App Functionality; Product Personalization | Workouts, paces, records, Strava and Garmin activities |
| User Content → **Audio Data** | App Functionality | Voice notes sent to the coach |
| User Content → **Other User Content** | App Functionality | Coach messages and journal entries |
| Identifiers → **User ID** | App Functionality; Analytics | Account ID |
| Identifiers → **Device ID** | App Functionality | The push notification token |
| Usage Data → **Product Interaction** | Analytics; App Functionality | First-party events such as workout started or completed |
| Purchases → **Purchase History** | App Functionality | Membership status and dates, recorded from payments made on the website |

Not collected: location, contacts, photos or videos, browsing history, search
history, financial info (payments are handled by Stripe on the website),
diagnostics, advertising data.

**Check before you submit (YOU):** these answers are only as true as the code.
- Marketing emails: the answer above assumes athletes receive journey and
  campaign emails. If you stop sending them, remove "Developer's Advertising or
  Marketing".
- Your website privacy policy says "we do not use traditional analytics". The
  app does record first-party events (`analyticsEvents` in Firestore), which
  Apple counts as Analytics even when no third party is involved. Either
  reword that sentence ("we record our own usage events, never shared with
  advertisers") or accept the small mismatch; Apple reviews the label, not the
  policy wording, but they should not contradict each other.
- The policy names Google Gemini as a processor of workout data, and the coach
  sends that data to it. Keep that disclosure, and mention it in the review
  notes (below).

## 5. Age rating

Answer the questionnaire honestly. Expected answers for this app:
- Violence, sexual content, profanity, horror, drugs, alcohol, gambling,
  contests: **None**.
- Medical or wellness topics: the app gives training advice and records body
  weight and injuries. Answer the wellness question truthfully (training advice
  is typically **Infrequent/Mild**, not medical treatment).
- Unrestricted web access: **No**. User-generated content or messaging between
  users: **No** (the coach is an AI that replies to one athlete; there is no
  chat between members).
- AI features: answer yes if asked about generative AI or chatbots, and say the
  coach produces training text for the athlete only.
- Expect **4+** or **9+**. Whatever Apple computes is fine; don't answer
  untruthfully to move it.

## 6. App Review Information

**Sign-in required:** yes. **YOU:** create the reviewer account on the website
(full access, with a program assigned and a plan so the dashboard isn't empty;
the trial or membership must not expire during review, so set it to an active
membership or admin-granted access). Enter its email and password in the
sign-in fields. Never use a personal account.

**Contact:** your name, a phone number Apple can call, and
`training@hybridx.club`.

**Notes** (paste):
```
HYBRIDX.CLUB is a training app for HYROX and hybrid athletes.

How to review:
1. Sign in with the demo account provided. It has full access and an active
   training plan.
2. Today: the dashboard shows today's workout. Tap it to start the workout
   timer, log it, and complete it.
3. Coach: open Coach and send a text message or a voice note (the microphone
   permission prompt appears the first time). The coach is an AI and replies to
   the signed-in athlete only.
4. Reminders: Profile -> turn on workout reminders to see the iOS notification
   permission prompt. Push notifications are sent from our server through
   Firebase Cloud Messaging.
5. Account deletion: Profile -> Account -> Delete account.

Native features: push and on-device workout reminders, microphone for voice
notes, the share sheet for exporting workouts, and an offline screen when the
site can't be reached. Strava and Garmin connection needs the reviewer's own
Strava or Garmin account, so it can't be tested with the demo login.

Payments: memberships are bought on our website, not in the app. The demo
account already has full access, and the app shows no prices or purchase
buttons.

AI: the coach and plan adjustments use Google Gemini. Workout and preference
data sent for this is described in our privacy policy
(https://hybridx.club/privacy-policy).
```

## 7. Version release
Choose **Manually release this version** so you control launch day.

## 8. Before you press Submit
- [ ] Build selected: the latest TestFlight build made after the iPhone-only and
      iOS 15 changes (and with push working).
- [ ] 6.9" screenshots uploaded (3 to 10).
- [ ] Privacy Policy URL and Support URL filled in; both load without logging in.
- [ ] App Privacy published; answers match section 4.
- [ ] Age rating complete; pricing set to Free; availability set (all countries,
      or just the ones you support).
- [ ] Reviewer account works from a clean install: sign in, plan visible, no
      "trial ended" screen.
- [ ] Export compliance: nothing to do (declared in the build).
