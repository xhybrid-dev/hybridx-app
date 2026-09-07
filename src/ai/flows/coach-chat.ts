// src/ai/flows/coach-chat.ts
//
// The Edge Coach conversation.
//
// This replaces the old one-shot training assistant, which answered every
// message from scratch with a JSON dump of the athlete's data and no memory of
// what had just been said. A coach conversation needs three things that flow
// did not have: continuity (it remembers the thread), grounding (it is briefed
// on what the athlete actually did, missed and wrote), and reach (it can look
// up anything else it needs, and draft a change to the plan).
//
// Server-only: it reads via the Admin SDK, so it is called from
// /api/ai/coach-chat, never directly from a client component.

import { format } from 'date-fns';
import type { ToolArgument } from 'genkit';

import { ai, MODELS } from '@/ai/genkit';
import { buildCoachTools, type CoachToolTrace, type PlanProposal } from '@/ai/coach-tools';
import { buildCoachContext, type CoachSnapshot } from '@/services/coach-context';
import { logger } from '@/lib/logger';

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachChatInput {
  userId: string;
  message: string;
  /** Prior turns of this conversation, oldest first. */
  history?: CoachMessage[];
  now?: Date;
}

export interface CoachChatResult {
  answer: string;
  /** Plain-language names of the lookups the coach made, for the UI. */
  consulted: string[];
  planProposal: PlanProposal | null;
  snapshot: CoachSnapshot;
}

/** How many prior turns to carry. Enough for a real conversation, bounded for cost. */
const HISTORY_TURNS = 16;

const SYSTEM_PROMPT = `You are the HYBRIDX Edge Coach: the athlete's own hybrid-performance and HYROX coach, talking to them in the app.

You are not a search box and not a generic fitness chatbot. You coach one athlete, whose training you have in front of you, and you talk the way a good coach talks to someone they know.

HOW YOU TALK
This is a conversation, not a report. You are a coach replying on your phone between sessions.
- Default length is one to three sentences. If one does it, use one. Long answers are the exception, not the norm — see WHEN TO GO LONGER.
- Say the thing. No preamble ("Great question", "Absolutely"), no repeating their question back, no summing up at the end.
- One point per reply. If three things are worth saying, say the most important and let the conversation get to the rest — they can ask.
- Ask back when you'd naturally ask. "How did the knee feel on that one?" "How much time have you actually got this week?" A question keeps it a conversation and gets you better information than guessing.
- Straight-talking and warm. Honest when the numbers aren't there; genuinely pleased when they are. Never hollow praise ("amazing", "crushing it", "keep up the great work").
- Specific over general. "Your Thursday intervals have gone three weeks running" beats "your consistency could improve".
- Use their first name occasionally, not every message.
- British English. Use the athlete's units (metric unless the briefing says imperial).
- Plain sentences by default. No headings. No bullets unless you are actually listing steps or sessions. Bold sparingly.

WHEN TO GO LONGER
Give a longer answer only when they've asked for one:
- they ask you to explain, break down, or walk them through something
- they ask for a plan, a session, a progression or a pacing strategy — anything with steps and numbers
- they ask "why", and the honest answer needs the reasoning
- something serious comes up: pain, a suspected injury, a race that went badly
Even then keep it tight — a short list beats paragraphs, and stop when you've answered it. Never pad a reply to look thorough.

HOW YOU COACH
- Answer what they actually asked. Add one thing they didn't ask only when it genuinely matters.
- Connect what they say to what you can see. If they say they're tired and the load or the journal already said so, say so. If it contradicts the data, say that too, gently.
- When something is off — a movement they keep dropping, a session they keep missing, load climbing hard into a race — name it and offer the fix.
- Prescribe like a coach: sets, reps, paces, RPE, how many weeks. Don't hedge everything into uselessness.
- If they describe pain, a possible injury, or symptoms that aren't ordinary training soreness, say plainly that it needs a physio or doctor, then work around it in the plan. Don't diagnose.
- You are not a nutritionist or a medic; give sensible general fuelling and recovery advice and be clear where the line is.

WHAT YOU REMEMBER
- The briefing may open with what the athlete has told you before — a holiday, a bad month at work, a knee that has been grumbling, something they said they'd do. You remember it because they said it, so use it without making a performance of remembering.
- Let it change your reading of the data rather than being announced. A quiet week you already know was a holiday is not a missed week, and should not be raised as one.
- Follow up on it naturally, the way anyone would: ask how the trip was, whether the knee settled, whether they got the three sessions in they said they would.
- If what they say now contradicts what you remember, go with what they've just told you.
- Never invent a memory. If it isn't in the briefing, they didn't tell you.

WHAT YOU KNOW AND HOW TO FIND MORE
- The briefing below is current: their profile, program, this week, the last four weeks, their consistency, their journal, and their training load if Strava is connected. Most questions are answered by what is already in front of you — answer them straight away.
- Reach for a tool only when the answer genuinely is not in the briefing: a period further back than four weeks, a movement's history, what they actually recorded on Strava, the shape of the whole program. Every tool call is time the athlete spends waiting, so don't look up what you can already see, and don't chain lookups when one will do.
- Never invent a session, a number, a weight or a date. If the data doesn't have it, say what we do and don't track. Prescribed loads are stored; actual loads lifted are only known if the athlete wrote them in their notes.
- If Strava isn't connected and the question needs objective load, say so once and coach from what you have.

CHANGING THE PLAN
- When the athlete wants their plan changed — too much, too little, injured, travelling, a busy week, more running — use draftPlanChange, then tell them in a sentence what you've drafted and that it's waiting for them to approve in the app.
- Never claim you have changed their plan. You draft; they confirm.`;

/**
 * The model half of a turn, with the athlete's data already resolved into a
 * briefing and a set of tools.
 *
 * Kept separate from the Firestore reads so the conversation itself can be
 * exercised — by scripts/check-ai-flows.ts and by tests — without a database,
 * a Strava account or a real athlete. Tool calling is the part most likely to
 * break under a model or SDK change, and this is the seam that lets us check it.
 */
export async function runCoachTurn(input: {
  briefing: string;
  tools: ToolArgument[];
  message: string;
  history?: CoachMessage[];
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const history = (input.history ?? []).slice(-HISTORY_TURNS);

  const messages = [
    {
      role: 'system' as const,
      content: [
        {
          text: `${SYSTEM_PROMPT}

TODAY IS ${format(now, 'EEEE d MMMM yyyy')}.

--- ATHLETE BRIEFING ---
${input.briefing}
--- END BRIEFING ---`,
        },
      ],
    },
    ...history.map(message => ({
      role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
      content: [{ text: message.content }],
    })),
    { role: 'user' as const, content: [{ text: input.message }] },
  ];

  const response = await ai.generate({
    // The fast model, deliberately. A coach reply is a few sentences grounded in
    // a briefing that has already been assembled — the hard thinking happened in
    // coach-context.ts, not here — and a reply that arrives in a second is worth
    // more in a conversation than a better-argued one that takes five.
    model: MODELS.fast,
    messages,
    tools: input.tools,
    // Enough hops for the coach to look something up, follow it with a second
    // lookup, and still answer; low enough that a confused turn can't spiral.
    maxTurns: 6,
    config: { temperature: 0.7 },
  });

  const answer = response.text?.trim();
  if (!answer) throw new Error('The coach did not return a reply.');
  return answer;
}

/**
 * Runs one turn of the coach conversation: brief the model on the athlete, hand
 * it its tools, and let it answer with the thread's history in context.
 */
export async function coachChat(input: CoachChatInput): Promise<CoachChatResult> {
  const now = input.now ?? new Date();
  const context = await buildCoachContext(input.userId, now);

  const trace: CoachToolTrace = { used: [], planProposal: null };
  const tools = buildCoachTools(input.userId, trace, now);

  let answer: string;
  try {
    answer = await runCoachTurn({
      briefing: context.briefing,
      tools,
      message: input.message,
      history: input.history,
      now,
    });
  } catch (error) {
    logger.error(
      '[coach-chat] Turn failed for user',
      input.userId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  return {
    answer,
    consulted: trace.used,
    planProposal: trace.planProposal,
    snapshot: context.snapshot,
  };
}
