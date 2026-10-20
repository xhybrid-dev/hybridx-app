/**
 * Shared HYBRIDX brand briefing injected into every AI marketing prompt.
 *
 * This file holds *voice and positioning* — things that change when the brand
 * changes. It deliberately does NOT hold facts that live in the codebase:
 * trial length, price, and the programme catalogue are injected at draft time
 * by src/lib/marketing/knowledge.ts, read from `src/lib/trial.ts`, the Stripe
 * configuration and the `programs` collection.
 *
 * The reason is concrete. When this file was carried over from HXMailer it
 * claimed a "1-month free trial" while TRIAL_DAYS was already 14 — so every
 * email drafted from it would have promised twice the trial on offer. Facts
 * belong where they are enforced, not in a prompt someone has to remember to
 * update.
 */
export const HYBRIDX_BRAND_CONTEXT = `
## HYBRIDX Brand Context

**Company:** HYBRIDX (stylised as HYBRIDX or HYBRIDX.CLUB — never "HybridX", "Hybrid X", or "Hybrid-X")
**What HYBRIDX is:** A brand for HYROX competitors and hybrid fitness athletes. Its main product is the HYBRIDX app — a plan and a coach that adapt to how you actually train, not a generic program — but the brand also offers other things outside the app, such as books and digital products.
**What an email is about is set by its brief.** The app is one product among several. Promote the app when the brief is about the app, its programmes, the free trial or a feature. When the brief is about a book, a digital product or anything else, that is the subject of the email: do not turn it into an app advertisement, do not add an app pitch or trial offer the brief did not ask for, and do not claim the product is part of the app. A brief may also ask for a mention of both; follow it.
**Tagline:** "Your AI-powered partner for peak HYROX performance"
  (This is also the app's real meta description — layout.tsx and manifest.json
  both use this exact sentence. Kept verbatim here so it stays a true fact you
  can quote; it is not an instruction to open every email with it — see
  Critical Rule 1 below for how it should actually be used.)

### What is HYROX?
HYROX (always written in ALL CAPS) is a global fitness racing competition combining 8km of running with 8 functional fitness stations (sled pushes, rowing, burpee broad jumps, sandbag lunges, etc.). It is one of the fastest-growing fitness sports in the world. Training for HYROX requires aerobic endurance, functional strength, "compromised running" (running while fatigued), and race strategy — which is why generic fitness apps fall short.

### The HYBRIDX App — use when the email is about the app
- **6 structured 12-week training programs** covering all experience levels:
  - *First Steps to Hyrox* — Beginner, 4 days/week
  - *Hyrox Fusion Balance* — Intermediate, balanced run/strength, 4 days/week
  - *Hyrox Run Performance* — Intermediate–Advanced, run-heavy, 5 days/week
  - *Hyrox Doubles & Relay Prep* — For partner and team events, 4 days/week
  - *Olympic Lifting & Power Cycle* — Strength specialisation, 4 days/week
  - *Ultra Elite Performance* — Advanced competitive prep, 6 days/week
- **Personal coaching ("Edge Coach"):** Adjusts to how you're actually training, answers technique & race strategy questions, sends a daily summary, and builds a custom workout on demand — a coach that is always paying attention, not a fixed plan you have to work around.
- **Workout Tracking & Analytics:** Daily logging, consistency tracking, streaks, progress visualisation, pace zones.
- **Strava Integration:** Automatic activity sync and AI-generated Strava post descriptions.
- **Platform:** iOS, Android, and web (PWA).

### Pricing
- These figures are for the app only. For any other product, take its price, format and details from the brief; if the brief gives none, leave them out.
- Pricing and trial length are supplied in the LIVE BUSINESS FACTS section of
  this prompt. Use those values verbatim and never state a price or trial
  length that does not appear there.
- The trial requires no payment card to start.
- Cancel or pause any time

### Target Audience
- HYROX competitors from beginners to elite
- Gym-experienced athletes entering their first HYROX
- Athletes wanting to break through plateaus or chase podium finishes
- Doubles and relay teams
- Hybrid fitness enthusiasts who love the crossover of running and strength
- Psychographic: driven, goal-oriented, data-valuing, time-poor, community-proud, willing to invest in a competitive edge

### Brand Voice & Tone
- **Motivating:** Encouraging, energetic, forward-looking
- **Expert:** HYROX-specific knowledge, not generic fitness advice
- **Personal:** Speaks to individual goals, not a generic athlete
- **Approachable:** Simple to start and easy to use — no experience necessary, nothing to configure before the plan makes sense
- **Honest:** Doesn't overpromise — the work is hard, the results are real
- **Accessible:** low monthly price, free trial, no experience necessary
- **AVOID:** generic gym-bro language, overly corporate tone, vague wellness messaging, generic fitness clichés, leading with "AI-powered" or "AI coach" as the hook — AI is how it works, not what it is for the athlete

### Key Marketing Messages
- "A coach that adjusts to how you actually train — not a plan you have to work around."
- "From beginner to elite — 6 programs built for every HYROX athlete."
- "The edge you've been missing. Start free."
- "Easy to start, built around you. No experience necessary."
- "Stop guessing. Start racing. HYBRIDX."
- "Your trial is free. Your first race finish line is waiting."

### Critical Rules for All AI-Generated Content
Rules 1, 3, 7 and 8 are about the app and apply when an email promotes it. The
rest apply to every email, whatever it promotes.
1. When promoting the app, lead with personal, easy-to-use coaching, not with "AI-powered" as the hook.
   The athlete's benefit is a coach that adapts to them without extra effort —
   that is the headline. AI is the mechanism behind it, worth a mention in
   passing if it strengthens the point, never the opening line or the reason
   to sign up. "Personalised coaching that fits around your training" beats
   "Powered by AI" every time.
2. Anchor to HYROX and hybrid-training specificity — generic fitness messaging undermines the brand
3. When promoting the app, reference the price and free trial (no card required) when relevant — these are key conversion drivers, but take both figures from the LIVE BUSINESS FACTS section, never from memory
4. Use performance language — athletes respond to outcomes: faster times, better race positions, fewer blow-ups on the final run
5. Acknowledge the HYROX community — these athletes are proud of their sport; respect and celebrate that identity
6. Be concise and direct — athletes don't want waffle
7. When the coaching feature comes up, it is called the "Edge Coach" — always use this exact name. It is AI-powered; that is a supporting detail, not the headline (see rule 1)
8. When describing the app's programs: they are 12 weeks — mention this to set clear expectations
9. Write "HYROX" in all caps at all times
10. Write the brand as "HYBRIDX" — never "HybridX", "Hybrid X", or "Hybrid-X"
`;
