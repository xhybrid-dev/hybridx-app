// src/app/api/admin/ai-health/route.ts
//
// "Is the coach actually able to answer?" — for admins, from a browser.
//
// Open /api/admin/ai-health while signed in as an admin. It checks, one at a
// time and without stopping at the first failure, everything a coach message
// depends on: the Gemini key being configured, each Gemini model answering a
// one-word prompt, and the Firestore queries the coach runs. Each check reports
// ok/failed with the error message, which is otherwise only in Cloud Logging.
//
// The API key itself is never returned, only whether one is set.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { z } from 'genkit';
import { ai, MODELS, STRUCTURED_CONFIG } from '@/ai/genkit';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { getUser } from '@/services/user-service';
import { COACH_CONVERSATIONS_COLLECTION } from '@/services/coach-conversation';
import { COACH_NOTES_COLLECTION } from '@/services/coach-notes';

export const dynamic = 'force-dynamic';

type Check = { ok: boolean; ms: number; detail?: string };

async function check(run: () => Promise<string | void>): Promise<Check> {
  const started = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 800),
    };
  }
}

async function adminUid(request: Request): Promise<string | null> {
  try {
    let uid: string | null = null;
    const bearer = request.headers.get('authorization');
    if (bearer?.startsWith('Bearer ')) {
      uid = (await getAdminAuth().verifyIdToken(bearer.slice(7))).uid;
    } else {
      const session = (await cookies()).get('__session')?.value;
      if (session) uid = (await getAdminAuth().verifySessionCookie(session, true)).uid;
    }
    if (!uid) return null;
    return (await getUser(uid))?.isAdmin ? uid : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const uid = await adminUid(request);
  if (!uid) return NextResponse.json({ error: 'Admins only. Sign in as an admin and reload.' }, { status: 403 });

  const db = getAdminDb();
  const ping = (model: string) => async () => {
    const { text } = await ai.generate({ model, prompt: 'Reply with the single word OK.', config: { temperature: 0 } });
    return `replied: ${(text ?? '').trim().slice(0, 40) || '(empty)'}`;
  };

  const checks: Record<string, Check> = {
    geminiKeyConfigured: await check(async () => {
      if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server.');
    }),
    [`model:${MODELS.fast}`]: await check(ping(MODELS.fast)),
    [`model:${MODELS.reasoning}`]: await check(ping(MODELS.reasoning)),
    // Same shape of request the campaign studio makes: schema-constrained JSON
    // from the reasoning model. Distinguishes "model is down" from "structured
    // output stalls".
    [`structured:${MODELS.reasoning}`]: await check(async () => {
      const { output } = await Promise.race([
        ai.generate({
          model: MODELS.reasoning,
          config: STRUCTURED_CONFIG,
          output: { schema: z.object({ subject: z.string(), steps: z.array(z.string()).max(3) }) },
          prompt: 'Plan a 3-step welcome email series for a HYROX training app. Subject line plus three step titles.',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('structured call did not finish within 40s')), 40_000),
        ),
      ]);
      return `returned: ${JSON.stringify(output).slice(0, 80)}`;
    }),
    conversationsOrderedQuery: await check(async () => {
      const snapshot = await db
        .collection(COACH_CONVERSATIONS_COLLECTION)
        .where('userId', '==', uid)
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get();
      return `${snapshot.size} thread(s) found`;
    }),
    coachNotesQuery: await check(async () => {
      const snapshot = await db
        .collection(COACH_NOTES_COLLECTION)
        .where('userId', '==', uid)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      return `${snapshot.size} note(s) found`;
    }),
  };

  const ok = Object.values(checks).every(result => result.ok);
  return NextResponse.json({ ok, checkedAt: new Date().toISOString(), checks }, { status: ok ? 200 : 503 });
}
