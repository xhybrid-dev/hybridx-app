// scripts/seed-demo-athlete.ts
//
// Creates (or resets) a demo athlete with a full, believable training history,
// for App Store screenshots and the App Review sign-in. Nothing in it belongs
// to a real person.
//
// What it writes, all keyed to the demo account only:
//   - Firebase Auth user (email verified)
//   - users/{uid}: profile, active membership, PRs, paces, race date
//   - customPrograms/demo-plan-{uid}: a 16-week plan assigned to that user
//   - workoutSessions: every planned session before today, completed
//   - coachConversations + coachNotes: a short coach exchange and its notes
//   - Strava: a sentinel token, so Training Load shows built-in history
//     (src/lib/demo-strava.ts) and never calls Strava. Skip with --no-strava.
//
// Re-running resets the account: its sessions, coach thread, notes and journal
// are deleted and rebuilt relative to today, so the plan is always mid-block.
//
// Usage, from the repo (after npm install), signed in to Google Cloud:
//   gcloud auth application-default login
//   npm run seed:demo -- --dry-run
//   npm run seed:demo -- --password 'choose-a-strong-one'
//
// Options:
//   --email <address>     default demo@hybridx.club
//   --password <value>    sets the password (required the first time)
//   --first <name>        default Alex
//   --last <name>         default Carter
//   --tz <IANA zone>      default Europe/London
//   --week <n>            which plan week today falls in, default 7
//   --no-strava           no built-in Strava history (use for the App Review
//                         account, so it never claims a Strava connection)
//   --dry-run             print what would be written; touch nothing
//
// Or with an explicit service-account key:
//   FIREBASE_SERVICE_ACCOUNT_KEY='<json>' npx tsx scripts/seed-demo-athlete.ts ...

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import {
  DEMO_PLAN_NAME,
  DEMO_PLAN_WEEKS,
  DEMO_RACE_NAME,
  buildDemoConversation,
  buildDemoNotes,
  buildDemoPlan,
  buildDemoSessions,
  demoPlanDescription,
  demoPlanStartDay,
  zonedDayNumber,
  zonedInstant,
} from '../src/lib/demo-athlete';
import { DEMO_STRAVA_ACCESS_TOKEN } from '../src/lib/demo-strava';

// A FIREBASE_SERVICE_ACCOUNT_KEY in .env.local is used when present.
dotenv.config({ path: '.env.local' });

const PROJECT_ID = 'hyroxedgeai';
const DAY_MS = 86_400_000;

// ─── Arguments ───────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const options = {
  email: (argValue('email') ?? 'demo@hybridx.club').toLowerCase(),
  password: argValue('password'),
  firstName: argValue('first') ?? 'Alex',
  lastName: argValue('last') ?? 'Carter',
  timeZone: argValue('tz') ?? 'Europe/London',
  week: Number(argValue('week') ?? 7),
  strava: !flag('no-strava'),
  dryRun: flag('dry-run'),
};

if (!Number.isInteger(options.week) || options.week < 2 || options.week > DEMO_PLAN_WEEKS - 1) {
  throw new Error(`--week must be between 2 and ${DEMO_PLAN_WEEKS - 1}`);
}
if (options.password !== undefined && options.password.length < 8) {
  throw new Error('--password must be at least 8 characters');
}
new Intl.DateTimeFormat('en-GB', { timeZone: options.timeZone }); // throws on a bad zone

// ─── Firebase ────────────────────────────────────────────────────────────────

function credential(): admin.credential.Credential {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return admin.credential.applicationDefault();
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return admin.credential.cert(serviceAccount);
}

function app(): admin.app.App {
  return admin.apps.find(a => a?.name === 'demo-seed')
    ?? admin.initializeApp({ credential: credential(), projectId: PROJECT_ID }, 'demo-seed');
}

const ts = (date: Date) => admin.firestore.Timestamp.fromDate(date);

/** Deletes every doc in `collection` owned by `uid`, in batches. */
async function deleteOwned(db: admin.firestore.Firestore, collection: string, uid: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snapshot = await db.collection(collection).where('userId', '==', uid).limit(400).get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const todayDay = zonedDayNumber(now, options.timeZone);
  const startDay = demoPlanStartDay(todayDay, options.week);
  const raceDay = startDay + (DEMO_PLAN_WEEKS - 1) * 7 + 5; // last Saturday
  const raceDate = zonedInstant(raceDay, options.timeZone, 9);
  const plan = buildDemoPlan();

  console.log(`Demo athlete: ${options.firstName} ${options.lastName} <${options.email}>`);
  console.log(`Plan: ${DEMO_PLAN_NAME}, started ${new Date(startDay * DAY_MS).toDateString()}, today is week ${options.week}`);
  console.log(`Race day: ${new Date(raceDay * DAY_MS).toDateString()}`);
  console.log(`Built-in Strava history: ${options.strava ? 'yes' : 'no'}`);

  if (options.dryRun) {
    const sessions = buildDemoSessions(plan, 'demo-plan-<uid>', startDay, todayDay, options.timeZone);
    const today = plan.find(w => startDay + w.day - 1 === todayDay);
    console.log(`\n[dry run] ${plan.length} planned workouts, ${sessions.length} completed sessions`);
    console.log(`[dry run] today's workout: ${today ? today.title : 'rest day'}`);
    console.log(`[dry run] coach thread: ${buildDemoConversation(options.firstName, raceDate, now).length} messages, ` +
      `${buildDemoNotes(options.firstName, raceDate).length} notes`);
    console.log('[dry run] nothing written.');
    return;
  }

  const firebase = app();
  const auth = firebase.auth();
  const db = firebase.firestore();

  // 1. Auth user
  let user: admin.auth.UserRecord;
  try {
    user = await auth.getUserByEmail(options.email);
    await auth.updateUser(user.uid, {
      displayName: `${options.firstName} ${options.lastName}`,
      emailVerified: true,
      ...(options.password ? { password: options.password } : {}),
    });
    console.log(`\nUsing existing account ${user.uid}${options.password ? ' (password updated)' : ''}`);
  } catch (error: any) {
    if (error?.code !== 'auth/user-not-found') throw error;
    if (!options.password) throw new Error('First run: pass --password to set the account password.');
    user = await auth.createUser({
      email: options.email,
      password: options.password,
      displayName: `${options.firstName} ${options.lastName}`,
      emailVerified: true,
    });
    console.log(`\nCreated account ${user.uid}`);
  }
  const uid = user.uid;
  const programId = `demo-plan-${uid}`;

  // 2. Clear what an earlier run (or someone using the account) left behind.
  for (const collection of ['workoutSessions', 'coachConversations', 'coachNotes', 'journalEntries']) {
    const count = await deleteOwned(db, collection, uid);
    if (count) console.log(`Cleared ${count} ${collection}`);
  }

  // 3. The plan, visible to this athlete only.
  await db.collection('customPrograms').doc(programId).set({
    name: DEMO_PLAN_NAME,
    description: demoPlanDescription(),
    programType: 'hybrid',
    visibility: 'custom',
    assignedUserIds: [uid],
    workouts: plan,
    isDemo: true,
    createdAt: ts(now),
  });

  // 4. The profile. Overwritten so nothing from earlier use survives.
  const sessions = buildDemoSessions(plan, programId, startDay, todayDay, options.timeZone);
  const lastSession = sessions[sessions.length - 1];
  await db.collection('users').doc(uid).set({
    email: options.email,
    firstName: options.firstName,
    lastName: options.lastName,
    experience: 'intermediate',
    frequency: '5+',
    goal: 'hybrid',
    unitSystem: 'metric',
    programId,
    startDate: ts(zonedInstant(startDay, options.timeZone, 9)),
    customProgram: null,
    raceDate: ts(raceDate),
    raceName: DEMO_RACE_NAME,
    timeZone: options.timeZone,
    personalRecords: {
      backSquat: '120 kg',
      deadlift: '165 kg',
      benchPress: '92.5 kg',
      run1k: '3:38',
      run5k: '20:45',
      run10k: '43:30',
    },
    runningProfile: { benchmarkPaces: { fiveK: 20 * 60 + 45, tenK: 43 * 60 + 30 } },
    strava: options.strava
      ? {
          accessToken: DEMO_STRAVA_ACCESS_TOKEN,
          refreshToken: DEMO_STRAVA_ACCESS_TOKEN,
          expiresAt: ts(new Date('2099-01-01T00:00:00Z')),
          scope: 'read,activity:read_all',
          athleteId: 48151623,
        }
      : null,
    lastStravaSync: options.strava ? ts(now) : null,
    notificationTime: { hour: 7, minute: 0 },
    isAdmin: false,
    subscriptionStatus: 'active',
    stripeCustomerId: null,
    subscriptionId: null,
    trialStartDate: ts(zonedInstant(startDay - 14, options.timeZone, 9)),
    onboardingSkipped: false,
    onboardingCompletedStep: 6,
    completedWorkouts: sessions.length,
    lastWorkoutAt: lastSession ? ts(lastSession.finishedAt) : null,
    marketingConsent: false,
    isTestAccount: true,
    demoAccount: true,
  });

  // 5. Completed sessions.
  for (let i = 0; i < sessions.length; i += 400) {
    const batch = db.batch();
    for (const session of sessions.slice(i, i + 400)) {
      batch.set(db.collection('workoutSessions').doc(), {
        ...session,
        userId: uid,
        workoutDate: ts(session.workoutDate),
        startedAt: ts(session.startedAt),
        finishedAt: ts(session.finishedAt),
      });
    }
    await batch.commit();
  }

  // 6. Coach thread and notes.
  const messages = buildDemoConversation(options.firstName, raceDate, now);
  await db.collection('coachConversations').add({
    userId: uid,
    title: messages[0].content.slice(0, 57) + '…',
    messages,
    createdAt: ts(new Date(messages[0].createdAt)),
    updatedAt: ts(new Date(messages[messages.length - 1].createdAt)),
  });
  for (const note of buildDemoNotes(options.firstName, raceDate)) {
    await db.collection('coachNotes').add({
      userId: uid,
      category: note.category,
      content: note.content,
      source: 'chat',
      status: 'active',
      createdAt: ts(now),
      updatedAt: ts(now),
      expiresAt: note.expiresInDays === null ? null : ts(new Date(now.getTime() + note.expiresInDays * DAY_MS)),
      pausesTraining: false,
    });
  }

  console.log(`\nDone: ${plan.length} planned workouts, ${sessions.length} completed sessions, coach thread and notes.`);
  console.log(`Sign in on the app as ${options.email}.`);
  console.log('Re-run this script any time to reset the account to the same state, relative to today.');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\nSeeding failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
