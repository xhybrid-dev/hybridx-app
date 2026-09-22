// scripts/repair-daily-coach-plans.ts
//
// Restores plans collapsed by the old nightly adjustment job.
//
// Before the fix, api/cron/daily-coach wrote `customProgram = [adjusted
// workout]` for athletes who had no customisation. The app reads
// customProgram as the WHOLE plan, so from the next day those athletes saw
// "No workout scheduled". Every such write also left a `notifications` row of
// type 'ai-adjustment' — without the `original` field the fixed job now adds —
// which is how affected athletes are found.
//
// An athlete is repaired when their customProgram holds no more entries than
// the old job wrote for them: the plan is nothing but adjustments. Their base
// program is restored with the adjusted days kept in place.
//
// Usage, with gcloud signed in:
//   gcloud auth application-default login
//   npx tsx scripts/repair-daily-coach-plans.ts           # dry run: report only
//   npx tsx scripts/repair-daily-coach-plans.ts --apply   # write the repairs

import * as admin from 'firebase-admin';

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
  admin.apps.find((a) => a?.name === 'repair') ??
  admin.initializeApp({ credential: credential(), projectId: PROJECT_ID }, 'repair');
const db = app.firestore();

async function loadBaseProgram(programId: string): Promise<WorkoutLike[] | null> {
  for (const collection of ['programs', 'customPrograms']) {
    const snap = await db.collection(collection).doc(programId).get();
    if (snap.exists) return (snap.data()?.workouts ?? []) as WorkoutLike[];
  }
  return null;
}

/** Base plan, with each adjusted day swapped in for the first workout on that day. */
function restore(base: WorkoutLike[], adjusted: WorkoutLike[]): WorkoutLike[] {
  const result = [...base];
  for (const workout of adjusted) {
    const index = result.findIndex((w) => w.day === workout.day);
    if (index === -1) result.push(workout);
    else result[index] = workout;
  }
  return result.sort((a, b) => a.day - b.day);
}

async function main() {
  console.log(`\n=== Repair daily-coach plans — ${PROJECT_ID} — ${APPLY ? 'APPLY' : 'dry run'} ===\n`);

  const notices = await db.collection('notifications').where('type', '==', 'ai-adjustment').get();
  const oldJobWrites = new Map<string, number>();
  for (const doc of notices.docs) {
    const data = doc.data();
    if ('original' in data) continue; // written by the fixed job, which never collapses a plan
    oldJobWrites.set(data.userId, (oldJobWrites.get(data.userId) ?? 0) + 1);
  }
  console.log(`Athletes the old job adjusted: ${oldJobWrites.size}\n`);

  let repaired = 0;
  let healthy = 0;
  let unresolved = 0;

  for (const [userId, writes] of oldJobWrites) {
    const userSnap = await db.collection('users').doc(userId).get();
    const user = userSnap.data();
    const custom = (user?.customProgram ?? []) as WorkoutLike[];
    const programId = user?.programId as string | undefined;

    if (!user || !programId || custom.length === 0 || custom.length > writes) {
      healthy++;
      continue;
    }

    const base = await loadBaseProgram(programId);
    if (!base || base.length <= custom.length) {
      unresolved++;
      console.log(`  ? ${userId}  program ${programId}: base plan not found or not longer — check by hand`);
      continue;
    }

    const restored = restore(base, custom);
    console.log(
      `  ${APPLY ? '✔' : '→'} ${userId}  ${user.email ?? ''}  program ${programId}: ${custom.length} → ${restored.length} workouts`,
    );
    if (APPLY) {
      await userSnap.ref.update({ customProgram: restored });
    }
    repaired++;
  }

  console.log(`\n${APPLY ? 'Repaired' : 'Would repair'}: ${repaired}`);
  console.log(`Already whole: ${healthy}`);
  console.log(`Need a manual look: ${unresolved}`);
  if (!APPLY && repaired > 0) console.log('\nRe-run with --apply to write these.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
