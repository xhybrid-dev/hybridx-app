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

## Checking it

```bash
npx vitest run src/lib/coach          # briefing, adherence, schedule logic
GEMINI_API_KEY=... npx tsx scripts/check-ai-flows.ts
```

The second one makes real model calls and includes a tool-calling check: if the
loop ever breaks, the coach would still answer — just without ever looking at
the athlete's data — and no error would say so.
