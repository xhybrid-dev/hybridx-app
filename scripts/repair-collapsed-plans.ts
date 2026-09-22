// scripts/repair-collapsed-plans.ts
//
// Restores athletes' plans that two bugs cut short. The app reads a user's
// `customProgram` as their WHOLE plan, and both of these wrote a fragment there:
//
//  1. The old nightly job (api/cron/daily-coach) wrote `[one adjusted
//     workout]` for athletes with no customisation, so from the next day they
//     had no workouts. Each such write left an 'ai-adjustment' notification
//     without the `original` field the fixed job adds — that is how they are
//     found. Repaired as: base plan with the adjusted days kept.
//
//  2. The old AI resize at signup / program start was a one-week prompt fed a
//     whole program, so athletes who train 3–4 days a week were left with a
//     single week. Found as: a customProgram that ends within the first week of
//     a base plan that runs much longer. Repaired as: the base plan resized
//     week by week with lib/plan-condense.
//
// Usage, with gcloud signed in:
//   gcloud auth application-default login
//   npx tsx scripts/repair-collapsed-plans.ts           # dry run: report only
//   npx tsx scripts/repair-collapsed-plans.ts --apply   # write the repairs

import * as admin from 'firebase-admin';
import { fitToSchedule } from '../src/lib/plan-condense';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'hyroxedgeai';
const APPLY = process.argv.includes('--apply');

interface WorkoutLike {
  day: number;
  title: string;
  [key: string]: unknown;
}

function credential(): admin.credential.Credential {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return admin.credential.applicationDefault();
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return admin.credential.cert(serviceAccount);
}

const app =
  admin.apps.find((a) => a?.name === 'repair-plans') ??
  admin.initializeApp({ credential: credential(), projectId: PROJECT_ID }, 'repair-plans');
const db = app.firestore();

const baseCache = new Map<string, WorkoutLike[] | null>();

async function loadBaseProgram(programId: string): Promise<WorkoutLike[] | null> {
  if (baseCache.has(programId)) return baseCache.get(programId)!;
  let workouts: WorkoutLike[] | null = null;
  for (const collection of ['programs', 'customPrograms']) {
    const snap = await db.collection(collection).doc(programId).get();
    if (snap.exists) {
      workouts = (snap.data()?.workouts ?? []) as WorkoutLike[];
      break;
    }
  }
  baseCache.set(programId, workouts);
  return workouts;
}

const lastDay = (workouts: WorkoutLike[]) => Math.max(0, ...workouts.map((w) => w.day));

/** Base plan, with each adjusted day swapped in for the first workout on that day. */
function overlay(base: WorkoutLike[], adjusted: WorkoutLike[]): WorkoutLike[] {
  const result = [...base];
  for (const workout of adjusted) {
    const index = result.findIndex((w) => w.day === workout.day);
    if (index === -1) result.push(workout);
    else result[index] = workout;
  }
  return result.sort((a, b) => a.day - b.day);
}

async function main() {
  console.log(`\n=== Repair collapsed plans — ${PROJECT_ID} — ${APPLY ? 'APPLY' : 'dry run'} ===\n`);

  const notices = await db.collection('notifications').where('type', '==', 'ai-adjustment').get();
  const oldJobWrites = new Map<string, number>();
  for (const doc of notices.docs) {
    const data = doc.data();
    if ('original' in data) continue; // written by the fixed job, which never collapses a plan
    oldJobWrites.set(data.userId, (oldJobWrites.get(data.userId) ?? 0) + 1);
  }

  const users = await db.collection('users').where('programId', '!=', null).get();
  const counts = { nightlyJob: 0, oneWeekResize: 0, unresolved: 0, checked: 0 };

  for (const userSnap of users.docs) {
    const user = userSnap.data();
    const custom = (user.customProgram ?? []) as WorkoutLike[];
    const programId = user.programId as string;
    if (custom.length === 0) continue;
    counts.checked++;

    const writes = oldJobWrites.get(userSnap.id) ?? 0;
    const nightlyVictim = writes > 0 && custom.length <= writes;

    const base = await loadBaseProgram(programId);
    // Personal and race plans are not in these collections; their customProgram
    // is the whole generated plan, so there is nothing to compare against.
    if (!base) {
      if (nightlyVictim) {
        counts.unresolved++;
        console.log(`  ? ${userSnap.id}  program ${programId}: collapsed by the nightly job, base plan not found — check by hand`);
      }
      continue;
    }

    let restored: WorkoutLike[] | null = null;
    let reason = '';
    if (nightlyVictim && base.length > custom.length) {
      restored = overlay(base, custom);
      reason = 'nightly job';
      counts.nightlyJob++;
    } else if (lastDay(custom) <= 7 && lastDay(base) > 14) {
      restored = fitToSchedule(base, user.frequency) ?? base;
      reason = 'one-week resize';
      counts.oneWeekResize++;
    }
    if (!restored) continue;

    console.log(
      `  ${APPLY ? '✔' : '→'} ${userSnap.id}  ${user.email ?? ''}  [${reason}] ${programId}: ` +
        `${custom.length} workouts / ${lastDay(custom)} days → ${restored.length} workouts / ${lastDay(restored)} days`,
    );
    if (APPLY) await userSnap.ref.update({ customProgram: restored });
  }

  const total = counts.nightlyJob + counts.oneWeekResize;
  console.log(`\nChecked ${counts.checked} athletes with a customised plan.`);
  console.log(`${APPLY ? 'Repaired' : 'Would repair'}: ${total} (nightly job ${counts.nightlyJob}, one-week resize ${counts.oneWeekResize})`);
  console.log(`Need a manual look: ${counts.unresolved}`);
  if (!APPLY && total > 0) console.log('\nRe-run with --apply to write these.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
