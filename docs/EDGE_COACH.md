# Edge Coach (AI chat)

The coaching conversation at `/assistant`. This describes what it can see, how
it answers, and what has to be deployed alongside it.

## Why it was rebuilt

The original assistant fetched the athlete's entire session list *in the
browser*, stringified it, and posted it to a one-shot flow with the question.
That meant:

- **No memory.** Every message started from nothing, so nothing could be
  discussed — only asked.
- **Data without meaning.** The model got raw session documents. It could not
  tell a completed session from a missed one, did not know what was scheduled
  next, and had no notion of consistency, patterns or trend.
- **No reach.** Anything outside the blob was unavailable, and the blob grew
  with every workout the athlete ever did.
- **No consequence.** The coach could describe a change to the plan but never
  make one.

## How it works now

```
/assistant (assistant-chat.tsx)
  │  GET  /api/ai/coach-chat        → last thread + training snapshot
  │  POST /api/ai/coach-chat        → one turn
  ▼
src/ai/flows/coach-chat.ts
  ├── src/services/coach-context.ts → the briefing (Admin SDK reads)
  ├── src/ai/coach-tools.ts         → the lookups it can make mid-answer
  └── src/services/coach-conversation.ts → thread persistence
```

### Models and pace

Everything the athlete waits on runs on **`googleai/gemini-3.5-flash-lite`**
(`MODELS.fast` in `src/ai/genkit.ts`, and the Genkit default) — the coach
conversation, its tool calls, note extraction, the dashboard greeting, the daily
tip, the journal response, the nightly adjustments. `MODELS.reasoning`
(`gemini-3.7-flash`) is kept for the marketing flows, where nobody is watching a
spinner.

The coach used to run on the reasoning model. It didn't need to: the hard part
of a coach reply is knowing the athlete, and that work happens in
`coach-context.ts` before the model is called at all. A reply that arrives in a
second is worth more in a conversation than a better-argued one that takes five.

Three things keep a turn quick:

1. **Short replies by design.** The system prompt's default is one to three
   sentences; longer answers are an explicit exception for when the athlete asks
   to be walked through something, asks for a plan or a session, asks "why", or
   raises something serious. `scripts/check-ai-flows.ts` fails if a casual
   question comes back over 600 characters.
2. **Tools only when needed.** The briefing answers most questions outright, and
   the prompt says so — every lookup is time the athlete spends waiting.
3. **A cached briefing.** Rebuilding it per message meant re-reading sessions,
   journal and notes seconds apart. It is now held for 60 seconds per athlete,
   and dropped immediately by `invalidateCoachContext` when a plan adjustment is
   applied, a note is written, or a note is dismissed.

### Which day it is

The coach runs on the server, which runs in UTC. The athlete does not. Two
kinds of date are stored and they are not the same kind of thing:

| Field | Written as | Example (UK, September) |
| --- | --- | --- |
| `workoutDate` | the athlete's **local midnight** — a day marker | Tue 8 Sept → `2026-09-07T23:00Z` |
| `startDate` | `new Date()` — the **instant** they picked the program | 14:37 BST → `2026-06-02T13:37Z` |

Read in UTC, the marker falls back a day and the instant does not. That is why
no offset-guessing rule fixes both: rounding to the nearest midnight repairs the
marker and pushes the start a day forward, starting the program late.

Knowing the athlete's timezone collapses both to one question — *what date was
it, where they are* — so `authedFetch` sends `X-Time-Zone` on every
authenticated call, `requireUser` validates it against `Intl` and puts it on
`auth.timeZone`, and it is stored on the user document for the jobs that run
with no browser behind them. Without one, everything falls back to the runtime's
zone, which is what the code did before.

`src/lib/program-day.ts` is the only place this math lives. Its one sharp edge,
which has its own test: `programDayFor` applies the zone to `startDate` **only**.
The target is the calendar day being asked about and the caller resolves it
first (`toCalendarDay(instant, zone)`); zoning both double-converts and lands a
day out whenever the runtime and the athlete are in different zones.

Stored day markers are re-pinned once, on read (`sessionFromFirestore`,
journal entries, race and start dates), to midnight of the day they belong to in
the *runtime's* zone — so every `format`, `differenceInCalendarDays` and
`startOfWeek` downstream is correct without each call site knowing about any of
this.

The day-math tests run green in six timezones spanning UTC-7 to UTC+13.

### The briefing

`buildCoachContext(userId)` assembles a page of prose, not a JSON dump:

- profile, units, PRs, benchmark paces, injury history, target race
- active program (with the athlete's own applied adjustments), and where they
  are in it
- today and the next 10 days, and the last 28 days — each day marked
  completed / skipped / **missed** / planned, with the athlete's notes
- four-week adherence, completion rate, active weeks, and which weekday and
  which session they most often drop
- recent sessions in detail: duration, timer results, linked Strava activity
- ATL / CTL / TSB and the modality breakdown, when Strava is connected
- the last 8 journal entries, verbatim, with mood and tags

Saved session documents always win over the program's default schedule, which
is how completions, drag-and-drop rearrangements and applied AI adjustments all
reach the coach (`buildSchedule`).

The reasoning that turns sessions into coaching facts — status, adherence,
streaks, skip patterns — lives in `src/lib/coach/insights.ts` and is unit
tested without Firestore.

### What the coach remembers

The briefing above is assembled from data. What the athlete *says* is a
different thing, and it used to evaporate the moment the message was sent — so
an athlete who explained they were away for a week got asked about the gap by
the dashboard the following Monday.

`coachNotes` holds those standing facts, one per document:

| Category | For | Default expiry |
| --- | --- | --- |
| `availability` | travel, holidays, a work crunch | 30 days |
| `constraint` | injuries, niggles, illness, missing kit | 45 days |
| `context` | work, sleep, family, stress | 45 days |
| `commitment` | something they said they'd do | 21 days |
| `goal` | a race, a target | never |
| `preference` | how they want to be coached | never |

Notes are written by `extract-coach-notes.ts`, which runs on the fast model
after each chat turn (in `after()`, so the athlete never waits for it) and after
a journal analysis. It is given everything already remembered and returns
*changes* — so "the knee's fine now" resolves the old note instead of sitting
next to it, and a changed return date edits the holiday rather than adding a
second one. Most exchanges correctly produce nothing.

**Expiry is applied on read**, not by a sweeper, so a note can never be quoted
back at an athlete the day after it stopped being true. Dates the athlete gives
are pinned absolutely at write time ("away next week" becomes 12–19 September),
because a relative date read three weeks later is a lie.

The athlete can see every note in the dashboard panel and dismiss any of them —
memory you cannot correct is memory you stop trusting.

### Where the memory shows up

Not just the chat. `GET /api/ai/coach-notes` is a plain Firestore read (no model
call) that returns the notes plus `promptText`, the exact rendering the coach's
own prompts use, so no two surfaces can drift:

- **Coach chat** — opens the briefing, above the training data, so it colours
  how everything else is read.
- **Dashboard greeting** (`dashboardSummary`) — a quiet fortnight it already
  knows was a holiday is not reported as a lapse.
- **Daily workout tip** (`workoutSummary`) — short on time this week, sore knee,
  no sled where they are: the tip is the one that gets the session done anyway.
- **Journal response** (`journalInsight`) — same memory the conversation has.
- **Nightly adjustment job** (`cron/daily-coach`) — the athlete who said they'd
  be away gets "I know you've got a lot on" instead of "since you missed
  yesterday". Same adjustment, different sentence.

### The tools

Anything outside the briefing's window is a tool call away, so the prompt stays
a page rather than a database:

| Tool | What it answers |
| --- | --- |
| `getWorkoutDetail` | every movement prescribed on a given date |
| `getUpcomingPlan` | the next N days in full |
| `getTrainingHistory` | any date range, with notes and status |
| `findMovementHistory` | every time they've trained a movement |
| `getStravaActivities` | what they actually recorded — pace, HR, effort |
| `getTrainingLoadDetail` | the day-by-day CTL/ATL/TSB curve |
| `getJournalEntries` | their own words |
| `getProgramOutline` | the shape of the whole block |
| `draftPlanChange` | drafts changes to the upcoming plan |

Tools are built per request with `ai.dynamicTool` and close over the
authenticated athlete's id — the model never names whose data it reads.

### Changing the plan

`draftPlanChange` runs the existing `analyzeAndAdjust` flow, so plan edits have
one code path shared with **Analyze My Week**. The draft is returned to the
client as `planProposal` and rendered as a card with an *Apply to my plan*
button that posts to `/api/ai/apply-adjustments`. **Nothing is written until the
athlete accepts** — the system prompt tells the coach to say so.

### Rendering what the coach says

Everything the coach writes goes through one component,
`src/components/coach-markdown.tsx`, in three variants: `block` (the chat
thread), `compact` (the dashboard panel), `inline` (one-line summaries, where
blocks are flattened so a stray list can't blow out the layout).

It had been three partial component maps, which is how a reply ends up with
literal asterisks in it. The trap is that Tailwind's preflight strips headings
and list markers back to plain text, so any element the map doesn't name renders
*invisibly* rather than merely unstyled — an unmapped `<h3>` is indistinguishable
from body text, and an unmapped `<ul>` has no bullets. Every element the model
can emit is therefore named explicitly.

Two remark plugins matter:

- **`remark-gfm`** — tables, strikethrough, task lists, autolinks. Without it a
  week laid out as a table arrives as a block of pipe characters.
- **`remark-breaks`** — a single newline becomes a line break, because that is
  what someone typing a message means by it. Verified not to interfere with list
  or paragraph parsing.

`rehype-raw` is deliberately **not** enabled. Model output is untrusted text and
react-markdown escapes HTML by default; that is the behaviour we want. Links
render with `target="_blank"` and `rel="noopener noreferrer nofollow"`.

The system prompt names exactly this set, so the coach doesn't reach for
formatting the app won't draw.

Long-form content — generated articles — uses
`src/components/markdown-renderer.tsx` instead, which is now just `prose` plus a
safe-link override. `@tailwindcss/typography` is installed and configured
against the design tokens in `tailwind.config.ts`, so article element styling
lives there rather than in a hand-written component map.

There is deliberately no `dark:prose-invert`: those tokens already flip with the
theme, and prose-invert would swap in a separate, unconfigured palette on top.

The two renderers stay separate on purpose. Chat bubbles need their own spacing
and an inline variant, and putting the coach on article typography would mean a
restyle of articles silently restyles the coach.

### Reaching the coach

The chat page is where a conversation happens; it is not the only place the
coach exists.

- The **dashboard panel** (`coach-panel.tsx`) shows the coach's line for the
  day, the notes it is holding, and a one-line reply box. A reply there goes
  into the same thread as the chat page — one conversation, two doors.
- **"Ask your coach about this"** on today's session deep-links to
  `/assistant?q=…`, which sends the question on arrival, so the athlete lands in
  an answer rather than an empty box.

### Threads

Conversations live in `coachConversations`, one document per thread, capped at
60 messages. History is read back from the stored thread on the server rather
than trusted from the request body, so a client cannot fabricate prior turns and
put words in the coach's mouth. The client only ever sends the new message and a
conversation id.

## Deploying

`firestore.rules` and `firestore.indexes.json` both changed for this feature and
are **not** part of the App Hosting deploy. `.github/workflows/firestore-config.yml`
applies them on push to `main`; if you deploy by hand:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project hyroxedgeai
```

New index: `coachConversations` (userId ASC, updatedAt DESC) for reading the
latest thread, and `journalEntries` (userId ASC, date DESC) so the newest
entries are the ones the coach reads. The journal query falls back to an
unordered read if the index is missing, so the coach degrades rather than fails.
`coachNotes` needs no composite index — it is queried on equality only
(userId + status), which Firestore serves from single-field indexes.

Both `coachNotes` and `coachConversations` are client-read, server-write only.
A note the client could forge is a note every coaching surface would then act
on.

## Checking it

```bash
npx vitest run src/lib/coach          # briefing, adherence, schedule logic
GEMINI_API_KEY=... npx tsx scripts/check-ai-flows.ts
```

The second one makes real model calls and covers the three behaviours that fail
silently rather than loudly:

- **tool calling** — if the loop breaks, the coach still answers, just without
  ever looking at the athlete's data.
- **remembering what matters** — an away week with dates must produce a note
  with an expiry.
- **ignoring the everyday** — "legs felt heavy today" must produce nothing, or
  the memory fills with noise and the coach starts quoting last Tuesday back at
  them in November.
