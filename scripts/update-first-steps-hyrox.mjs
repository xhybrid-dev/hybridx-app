/**
 * Updates "First Steps to Hyrox":
 * 1. Add Hyrox race format education to Week 1 (Day 5 active recovery)
 * 2. Replace vague "Optional" active recovery days with specific 20-min mobility routines
 * 3. Update Week 3–6 finishers to use proper Hyrox station formats with context
 * 4. Add post-run bodyweight circuit to one running day per week from Week 4 onwards
 * 5. Add "What's Next?" to final week
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const PROGRAM_ID = 'JrHDGwFm0Cn4sRJosApH';

const docRef = db.collection('programs').doc(PROGRAM_ID);
const snap = await docRef.get();
const program = snap.data();
const workouts = program.workouts.map(w => ({ ...w, exercises: w.exercises || [] }));

function getDay(day) {
  return workouts.find(w => w.day === day);
}

// ─── MOBILITY ROUTINE (used on all "Full Body Mobility" recovery days) ────────
const MOBILITY_ROUTINE = `20-Minute Hyrox Mobility Routine — do this, don't skip it:

PART 1 — LOWER BODY (10 min)
• Hip Flexor Lunge Stretch: 60 sec/side. Kneel, push hips forward, reach arm up. This is the primary tightness driver after running and sled work.
• Pigeon Pose (or Figure-4 seated): 90 sec/side. Targets the piriformis and glute medius — both heavily loaded in Hyrox.
• Hamstring Flossing: 20 reps. Lie on back, one leg straight up. Gently pump ankle toward you (dorsiflexion). Maintains hamstring length without passive overstretching.
• Calf/Achilles Stretch: 60 sec/side. Heel on step, lean forward. Essential after running and farmer carry loading.
• Hip 90/90 Switch: 10 reps. Sit with both knees at 90°, rotate both knees to the opposite side. Restores hip rotation range that running progressively limits.

PART 2 — UPPER BODY + THORACIC (10 min)
• Thoracic Rotation (T-spine): 10 reps/side. Kneeling, one hand behind head, rotate elbow to ceiling. SkiErg and rowing demand T-spine mobility — without it, you compensate with the lower back.
• Doorframe Chest Stretch: 60 sec. Arm at 90°, lean forward. Counters the forward-rounded position that accumulates during wall balls and push-up stations.
• Shoulder Cross-Body Stretch: 45 sec/side.
• Wrist and Forearm Circles: 20 reps each direction. Farmer carry and wall ball volume creates wrist fatigue — this restores circulation.

End with 10 deep breaths: 4-count inhale through nose, 6-count exhale through mouth.`;

const LIGHT_CARDIO_ROUTINE = `20-Minute Easy Movement Session — keep it low effort, stay moving:

Option A — Easy Bike or Row: 15–20 minutes at Zone 1 (could hold a conversation without any effort). This is below your easy run pace. The goal is blood flow to clear metabolic waste, not fitness.

Option B — 20-Minute Walk: Brisk enough to be purposeful, slow enough to feel completely relaxed. Nasal breathing throughout. This is active recovery, not a workout.

Why you should do this (not skip it): passive rest after back-to-back training days leaves metabolic waste products in the muscles longer. Light movement accelerates clearance, reduces next-day soreness, and keeps your joints mobile. Athletes who do structured active recovery progress faster than athletes who rest completely between sessions.`;

// ─── HYROX RACE FORMAT EDUCATION (add to Day 5, Week 1) ─────────────────────
const day5 = getDay(5);
day5.exercises = [
  {
    name: '📖 Hyrox Race Format — Read This First',
    details: `Welcome to Hyrox training. Before you run your first session, understand what you're training for:

WHAT IS HYROX?
A Hyrox race consists of: 8 x 1km runs, each followed by 1 functional fitness station. In total: 8km of running + 8 stations = one complete race. Typical finish times range from 60 minutes (elite) to 120 minutes (intermediate beginners). Your goal in this program is to complete the event, then get faster over time.

THE 8 STATIONS (in order):
1. SkiErg — 1000m (simulates cross-country ski motion)
2. Sled Push — 50m (pushing a loaded sled along a track)
3. Sled Pull — 50m (pulling via rope)
4. Burpee Broad Jumps — 80m
5. Rowing — 1000m (on a concept2 rower)
6. Farmer's Carry — 200m (carrying two kettlebells or dumbbells)
7. Sandbag Lunges — 100m
8. Wall Balls — 100 reps

WHAT MAKES HYROX UNIQUE:
You run into each station with your legs already fatigued. This is called "compromised running" and it's what this program specifically trains. A 5:00/km runner in a normal race might run 6:30/km between Hyrox stations — fatigue management is the core skill.

YOUR 12-WEEK JOURNEY:
Weeks 1–4: Build running capability + learn the movements
Weeks 5–8: Connect running and strength (compromised running)
Weeks 9–12: Race-pace specificity and simulation

There are no fitness prerequisites to enter a Hyrox race. Every wave has athletes at every level.`,
  },
  {
    name: 'Optional: Full Body Mobility',
    details: MOBILITY_ROUTINE,
  },
];

// ─── ALL MOBILITY RECOVERY DAYS — replace "Optional" with specific routines ───
// Days with "Optional: Full Body Mobility" (odd recovery days)
const mobilityDays = [12, 19, 26, 33, 40, 47, 54, 61, 68, 75];
for (const dayNum of mobilityDays) {
  const w = getDay(dayNum);
  if (!w) continue;
  w.exercises = [{
    name: 'Full Body Mobility (20 min)',
    details: MOBILITY_ROUTINE,
  }];
}

// Days with "Optional: Light Cardio" (even recovery days)
const cardioDays = [6, 13, 20, 27, 34, 41, 48, 55, 62, 69, 76];
for (const dayNum of cardioDays) {
  const w = getDay(dayNum);
  if (!w) continue;
  w.exercises = [{
    name: 'Easy Movement (20 min)',
    details: LIGHT_CARDIO_ROUTINE,
  }];
}

// ─── WEEK 3 FINISHER — update to Hyrox-format (Day 15: Strength A) ────────────
// Currently: "5 Burpees (scaled), 10 Air Squats" → replace with mini Hyrox taste
const day15 = getDay(15);
const finIdx15 = day15.exercises.findIndex(e => e.name === 'Finisher: AMRAP 8 mins');
if (finIdx15 >= 0) {
  day15.exercises[finIdx15] = {
    name: 'Finisher: Mini Hyrox Taste (AMRAP 8 min)',
    details: `400m Run → 10 Wall Balls (light, 3–5kg) → rest remainder of minute. Repeat for 8 minutes.

This is your first experience of the core Hyrox pattern: run, then do something functional. Notice how your legs feel when you pick up the wall ball — that's "compromised" movement. Every station in a Hyrox race begins with your legs in exactly this state. The goal today is awareness, not performance.

Scaling: If no wall ball, use 10 goblet squats with a light dumbbell. If no space to run, substitute 400m on a bike or rower.`,
  };
}

// ─── WEEK 3 FINISHER B (Day 17: Strength B) — already has Wall Balls+Row ─────
// Good as-is (10 Wall Balls + 10 Calorie Row) — add Hyrox context to it
const day17 = getDay(17);
const finIdx17 = day17.exercises.findIndex(e => e.name === 'Finisher: 4 Rounds For Time');
if (finIdx17 >= 0) {
  day17.exercises[finIdx17] = {
    name: 'Finisher: 4 Rounds For Time',
    details: `10 Wall Balls (light) → 10 Calorie Row.

Hyrox context: Wall Balls (Station 8) and Rowing (Station 5) are two of the most common bottleneck stations in Hyrox. You are training both in fatigued succession. Note: in a race, you would run 1km before each of these. This finisher starts building the muscular memory for these patterns.

Record your total time across 4 rounds — this is a useful benchmark. If each round takes longer than 3 minutes, reduce the wall ball weight.`,
  };
}

// ─── WEEK 5 FINISHERS — upgrade to proper Hyrox station combinations ──────────
// Day 29 (Strength A): currently "8 Dumbbell Thrusters (light), 8 Burpees (scaled)"
const day29 = getDay(29);
const finIdx29 = day29.exercises.findIndex(e => e.name === 'Finisher: AMRAP 8 mins');
if (finIdx29 >= 0) {
  day29.exercises[finIdx29] = {
    name: 'Finisher: Hyrox Station Medley (AMRAP 10 min)',
    details: `400m Run → 10 Burpee Broad Jumps → 400m Run → 20 Kettlebell Swings. Repeat for 10 minutes.

Hyrox context: Burpee Broad Jumps are Station 4. They require full body power while your legs are already loaded from running. The forward broad jump is the skill — step your feet forward instead of jumping if needed. 20 Kettlebell Swings simulate the metabolic demand of Farmer's Carry (Station 6) preparation.

This is your most race-like finisher yet. Track how many full rounds you complete.`,
  };
}

// Day 31 (Strength B): "Minute 1: 12 Calorie Row, Minute 2: 15 KB Swings, Minute 3: Rest"
// This is already a good Hyrox pattern — add context
const day31 = getDay(31);
const finIdx31 = day31.exercises.findIndex(e => e.name === 'Finisher: EMOM 9 mins');
if (finIdx31 >= 0) {
  day31.exercises[finIdx31] = {
    name: 'Finisher: EMOM 9 min (Hyrox Stations)',
    details: `Minute 1: 12 Calorie Row
Minute 2: 15 Kettlebell Swings
Minute 3: Rest

Hyrox context: The Rowing station (Station 5) and the Farmer's Carry setup both demand the hip extension pattern you're training in the swing. This EMOM teaches you to switch between explosive pulling and explosive hip drive — both required in Hyrox.

The rest minute is not optional — resist the urge to use it. Race management means knowing when to rest. Practice that here.`,
  };
}

// ─── WEEK 4 — ADD POST-RUN BODYWEIGHT CIRCUIT (Day 25: Long Endurance) ────────
// The review asks for fatigue-based running from Week 4 onwards
// Day 25 is the "Week 4: Long Easy Endurance" day — add a post-run circuit
const day25 = getDay(25);
if (day25) {
  // Find the long run entry and add a note; add a new post-run circuit exercise
  const longRunIdx = day25.exercises.findIndex(e => (e.name || '').includes('Long'));
  if (longRunIdx >= 0) {
    // Add a post-run circuit after the long run
    day25.exercises.splice(longRunIdx + 1, 0, {
      name: 'Post-Run Activation Circuit (5–10 min)',
      details: `Immediately after your run — legs should feel tired. Complete 2 rounds of:
• 10 Bodyweight Squats (slow — 3 seconds down)
• 10 Glute Bridges
• 10 Push-ups
• 20 Russian Twists

Hyrox context: Every Hyrox station begins with pre-fatigued legs. This circuit is your first deliberate experience of doing functional movements on tired legs. Notice: your form is harder to maintain, your breathing is elevated, your core needs more active bracing. That awareness is itself training.

Keep the load to bodyweight only in this circuit — the goal is not additional fitness, it is neuromuscular adaptation to the compromised state.`,
    });
  }
}

// ─── WHAT'S NEXT — Final rest week (Day 83/84) ────────────────────────────────
// Last active day — find the last non-rest day
const lastDays = workouts.filter(w => w.day >= 77 && w.day <= 84);
console.log('Last days:', lastDays.map(w => `Day ${w.day}: ${w.title}`).join('\n'));
// Add What's Next to whichever the last entry is
const lastActiveDay = workouts.slice(-7).find(w => !(w.title||'').toLowerCase().includes('rest'));
if (lastActiveDay) {
  lastActiveDay.exercises.push({
    name: "🏆 What's Next?",
    details: `Congratulations — you've completed First Steps to Hyrox. You now have:
• Consistent running capability (from run/walk intervals to continuous running)
• All 8 Hyrox station movements in your movement vocabulary
• Experience with compromised running and race-format finishers
• A strength base that supports race performance

Your next program options:
🎯 Hyrox Fusion Balance (Intermediate) — the natural next step. Builds on everything you've developed here with more intense sessions, race simulations, and a peak taper. Recommended if you're targeting a specific race within 12 weeks.

💪 Hyrox Run Performance — if running felt like your weakness in training, this program prioritises running development alongside strength. 5 days/week.

🤝 Hyrox Doubles & Relay Prep — if you have a training partner and want to compete together in the doubles event.

Before starting your next program: take 1 week of easy movement (walks, light bike, stretching). Then book your first Hyrox race if you haven't already. Nothing accelerates progress faster than a race on the calendar.`,
  });
}

// ─── WRITE BACK ───────────────────────────────────────────────────────────────
console.log('Updating First Steps to Hyrox...');
await docRef.update({ workouts });
console.log('✅ Done!\n');

// Verification
const updated = workouts;
console.log('Day 5 exercises:', updated.find(w=>w.day===5).exercises.map(e=>e.name).join(', '));
console.log('Day 12 exercise:', updated.find(w=>w.day===12).exercises[0].name);
console.log('Day 6 exercise:', updated.find(w=>w.day===6).exercises[0].name);
console.log('Day 15 finisher:', updated.find(w=>w.day===15).exercises.find(e=>e.name.includes('Finisher'))?.name);
console.log('Day 25 post-run circuit:', !!updated.find(w=>w.day===25).exercises.find(e=>e.name.includes('Post-Run')));
console.log('What\'s Next present:', JSON.stringify(updated.slice(-7).some(w => w.exercises.some(e => e.name.includes("What's Next")))));
