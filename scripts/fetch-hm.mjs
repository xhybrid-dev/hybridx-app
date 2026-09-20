import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const snap = await db.collection('programs').doc('5wjLfv0N4VWxxPT0ZxiO').get();
const { name, workouts } = snap.data();
console.log('Name:', name, '| Days:', workouts.length, '| Max day:', Math.max(...workouts.map(w=>w.day)));

// Summarise by week
for (let week = 1; week <= Math.ceil(workouts.length/7); week++) {
  const days = workouts.filter(w => w.day >= (week-1)*7+1 && w.day <= week*7);
  console.log(`\nWeek ${String(week).padStart(2)}  (days ${(week-1)*7+1}-${week*7}):`);
  days.forEach(w => {
    const runSummary = w.runs.map(r => `${r.type}/${r.distance}km@${r.paceZone}(e${r.effortLevel})`).join(' + ');
    const exCount = w.exercises?.length ? ` [${w.exercises.length}ex]` : '';
    console.log(`  Day ${String(w.day).padStart(2)}: ${w.title.padEnd(35)} ${runSummary}${exCount}`);
  });
}
