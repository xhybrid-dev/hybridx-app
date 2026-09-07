// scripts/check-ai-flows.ts
//
// Smoke-test the AI flows that cron jobs depend on, against the live API.
//
// Written after a schema problem took campaign drafting down for days while
// producing only a bare 400 that named no field. Three rounds of reasoning
// about the schema got it wrong; one measurement got it right. daily-coach's
// flow had never executed in production at all, so this exists to find that
// class of failure at a keyboard rather than at 3am in a job nobody watches.
//
//   GEMINI_API_KEY=... npx tsx scripts/check-ai-flows.ts
//
// Makes a small number of real API calls. Writes nothing.

import { z } from 'genkit';

import { ai } from '../src/ai/genkit';
import { analyzeAndAdjust } from '../src/ai/flows/analyze-and-adjust';
import { runCoachTurn } from '../src/ai/flows/coach-chat';
import { extractCoachNotes } from '../src/ai/flows/extract-coach-notes';

async function check(name: string, run: () => Promise<unknown>) {
  process.stdout.write(`  ${name} ... `);
  try {
    const out = await run();
    console.log('PASS');
    return { name, ok: true, out };
  } catch (err) {
    const e = err as { message?: string; detail?: unknown };
    console.log('FAIL');
    console.log(`      ${e?.message ?? String(err)}`);
    if (e?.detail) console.log(`      detail: ${JSON.stringify(e.detail)}`);
    return { name, ok: false };
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set — nothing can be checked.');
    process.exit(2);
  }

  console.log('Checking AI flows used by cron jobs:\n');

  const results = [];

  // Exactly the shape daily-coach sends: one skipped session, one upcoming
  // workout. If this fails, the nightly job fails for every athlete.
  results.push(
    await check('analyzeAndAdjust (daily-coach)', () =>
      analyzeAndAdjust({
        userName: 'there',
        userGoal: 'general fitness',
        recentHistory: [
          {
            date: new Date().toISOString().slice(0, 10),
            workoutTitle: 'Scheduled Workout',
            skipped: true,
            notes: 'System detected missed session.',
          },
        ],
        upcomingWorkouts: [
          {
            day: 8,
            title: 'Engine Room',
            programType: 'hyrox',
            exercises: [{ name: 'Wall balls', details: '4x15' }],
            runs: [],
          },
        ],
        customRequest: 'I missed yesterday. Should I adjust today?',
      }),
    ),
  );

  // The same flow with an athlete who set neither name nor goal — daily-coach
  // substitutes defaults for these, and this proves the substitution is enough
  // to satisfy the input schema.
  results.push(
    await check('analyzeAndAdjust (missing profile fields)', () =>
      analyzeAndAdjust({
        userName: 'there',
        userGoal: 'general fitness',
        recentHistory: [
          { date: '2026-08-24', workoutTitle: 'Scheduled Workout', skipped: true },
        ],
        upcomingWorkouts: [
          { day: 1, title: 'Foundation', programType: 'running', exercises: [], runs: [] },
        ],
      }),
    ),
  );

  // The Edge Coach answers over a tool loop, which is the part most exposed to
  // a model or SDK change: if tool calling silently stops working, the coach
  // still replies — it just replies without ever looking at the athlete's data,
  // which no error would reveal. This asks a question that can only be answered
  // from a tool and fails if the tool was never called.
  results.push(
    await check('coach chat (tool calling)', async () => {
      let toolCalled = false;

      const lastSledSession = ai.dynamicTool(
        {
          name: 'findMovementHistory',
          description:
            'Find every time the athlete has trained a specific movement, with dates and what was prescribed.',
          inputSchema: z.object({ movement: z.string() }),
          outputSchema: z.string(),
        },
        async () => {
          toolCalled = true;
          return '12 Aug 2026 | Engine Builder | completed | Sled Push — 4x20m @ 100kg | notes: "felt heavy"';
        },
      );

      const answer = await runCoachTurn({
        briefing: [
          '## Athlete',
          '- Name: Sam',
          '- Experience: intermediate | Goal: hybrid | Target frequency: 4 days/week',
          '',
          '## Program',
          '- Hyrox Fusion Balance (hyrox), currently day 17 of 28',
          '',
          '## Today and the week ahead',
          '- Today: Engine Builder [planned] — Sled Push — 4x20m @ 100kg',
        ].join('\n'),
        tools: [lastSledSession],
        message: 'When did I last do sled pushes and what did I do?',
      });

      if (!toolCalled) throw new Error('The model never called the tool it needed.');
      if (!answer.trim()) throw new Error('The model returned no reply.');
      return answer;
    }),
  );

  // The coach's memory. Two failure modes matter and neither raises an error on
  // its own: remembering nothing (the athlete repeats themselves forever) and
  // remembering everything (the coach quotes last Tuesday's sore legs back at
  // them in November). Check both directions.
  results.push(
    await check('extractCoachNotes (remembers what matters)', async () => {
      const writes = await extractCoachNotes({
        athleteMessage:
          "I'm in Spain from the 12th to the 19th so I'll only get one session in that week, and work is flat out until the end of the month.",
        coachReply: "Understood — I'll keep that week light.",
        existingNotes: [],
        now: new Date('2026-09-07T09:00:00Z'),
      });

      if (writes.length === 0) throw new Error('Remembered nothing from an away week.');
      const text = writes.map((w) => `${w.category}: ${w.content}`).join(' | ');
      if (!/spain|away|travel/i.test(text)) throw new Error(`Missed the trip: ${text}`);
      if (!writes.some((w) => w.expiresAt)) {
        throw new Error(`No expiry on a dated absence: ${text}`);
      }
      return text;
    }),
  );

  results.push(
    await check('extractCoachNotes (ignores the everyday)', async () => {
      const writes = await extractCoachNotes({
        athleteMessage: 'Legs felt heavy on the intervals today but I got through them.',
        coachReply: 'That is normal three days after a long run. Keep tomorrow easy.',
        existingNotes: [],
        now: new Date('2026-09-07T09:00:00Z'),
      });

      if (writes.length > 0) {
        throw new Error(
          `Stored a one-off feeling as a standing fact: ${writes.map((w) => w.content).join(' | ')}`,
        );
      }
      return 'nothing remembered, as intended';
    }),
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
