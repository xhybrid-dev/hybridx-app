
import { differenceInWeeks, addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import type { Program, Workout, RunningWorkout } from '@/models/types';

export interface TrainingPhase {
  name: 'Base' | 'Build' | 'Peak' | 'Taper' | 'Race Week';
  color: string;
  weeks: number;
  description: string;
}

export interface RacePlan {
  totalWeeks: number;
  phases: TrainingPhase[];
  status: 'optimal' | 'aggressive' | 'compressed' | 'long-term';
  message: string;
}

/**
 * Calculates the training phases based on the time until race day.
 * This drives the visual timeline.
 */
export function calculateTrainingPhases(raceDate: Date): RacePlan {
  const today = new Date();
  const weeksUntilRace = differenceInWeeks(raceDate, today);

  if (weeksUntilRace < 4) {
    return {
      totalWeeks: weeksUntilRace,
      phases: [
        { name: 'Taper', color: 'bg-emerald-500', weeks: Math.max(1, weeksUntilRace - 1), description: 'Rest & Recovery' },
        { name: 'Race Week', color: 'bg-yellow-500', weeks: 1, description: 'Go Time' }
      ],
      status: 'compressed',
      message: "It's crunch time. We'll focus strictly on tapering and freshness."
    };
  }

  // Standard Taper is always the last 2 weeks (1 week taper + 1 race week)
  const taperWeeks = 2;
  const availableTrainingWeeks = weeksUntilRace - taperWeeks;

  let phases: TrainingPhase[] = [];
  let status: RacePlan['status'] = 'optimal';
  let message = "";

  if (weeksUntilRace >= 16) {
    // LONG TERM: Full Base + Full Build
    const peakWeeks = 4;
    const buildWeeks = 8;
    const baseWeeks = availableTrainingWeeks - peakWeeks - buildWeeks;

    phases = [
      { name: 'Base', color: 'bg-blue-500', weeks: baseWeeks, description: 'Building Aerobic Capacity' },
      { name: 'Build', color: 'bg-indigo-500', weeks: buildWeeks, description: 'Increasing Intensity' },
      { name: 'Peak', color: 'bg-purple-500', weeks: peakWeeks, description: 'Max Effort Simulation' },
      { name: 'Taper', color: 'bg-emerald-500', weeks: 1, description: 'Rest & Recovery' },
      { name: 'Race Week', color: 'bg-yellow-500', weeks: 1, description: 'Event Day' }
    ];
    status = 'long-term';
    message = "Perfect timeline. We have plenty of time to build a massive aerobic base.";

  } else if (weeksUntilRace >= 12) {
    // OPTIMAL: Minimal Base + Full Build
    const peakWeeks = 4;
    const buildWeeks = availableTrainingWeeks - peakWeeks;

    phases = [
      { name: 'Build', color: 'bg-indigo-500', weeks: buildWeeks, description: 'Increasing Intensity' },
      { name: 'Peak', color: 'bg-purple-500', weeks: peakWeeks, description: 'Max Effort Simulation' },
      { name: 'Taper', color: 'bg-emerald-500', weeks: 1, description: 'Rest & Recovery' },
      { name: 'Race Week', color: 'bg-yellow-500', weeks: 1, description: 'Event Day' }
    ];
    status = 'optimal';
    message = "Great timing. We can jump straight into a solid build block.";

  } else {
    // AGGRESSIVE: Compressed Build
    // We prioritize the Peak phase, and whatever is left is "Build"
    const peakWeeks = Math.min(4, Math.floor(availableTrainingWeeks / 2));
    const buildWeeks = availableTrainingWeeks - peakWeeks;

    phases = [];
    if (buildWeeks > 0) {
        phases.push({ name: 'Build', color: 'bg-indigo-500', weeks: buildWeeks, description: 'Intensity' });
    }
    phases.push({ name: 'Peak', color: 'bg-purple-500', weeks: peakWeeks, description: 'Max Effort' });
    phases.push({ name: 'Taper', color: 'bg-emerald-500', weeks: 1, description: 'Rest' });
    phases.push({ name: 'Race Week', color: 'bg-yellow-500', weeks: 1, description: 'Race' });
    
    status = 'aggressive';
    message = "Aggressive timeline. We're skipping the base phase to focus on race specificity.";
  }

  return {
    totalWeeks: weeksUntilRace,
    phases,
    status,
    message
  };
}

/**
 * Generates the actual workout schedule by slicing/extending a template.
 */
export function generateRaceProgram(template: Program, raceDate: Date): (Workout | RunningWorkout)[] {
  const plan = calculateTrainingPhases(raceDate);
  const totalWeeks = plan.totalWeeks;
  
  // This is a simplified logic. In a real app, you'd have specific "Base" workouts vs "Build" workouts.
  // For this MVP, we will slice the template from the END (to keep the taper aligned).
  
  const templateLength = template.workouts.reduce((max, w) => Math.ceil(w.day / 7), 0);
  const templateWorkouts = [...template.workouts].sort((a, b) => a.day - b.day);

  let finalWorkouts: (Workout | RunningWorkout)[] = [];

  if (totalWeeks <= templateLength) {
    // Scenario: Race is sooner than the template duration (e.g. 8 weeks away, template is 12)
    // We slice the LAST 'totalWeeks' from the template
    // Effectively starting at week (12 - 8) = Week 4 of the template.
    const startWeek = templateLength - totalWeeks + 1;
    const startDay = (startWeek - 1) * 7 + 1;
    
    finalWorkouts = templateWorkouts
      .filter(w => w.day >= startDay)
      .map(w => ({
        ...w,
        day: w.day - startDay + 1 // Reset days to start at 1
      }));
  } else {
    // Scenario: Race is further away (e.g. 16 weeks away, template is 12)
    // We need to add "Base" weeks at the start.
    // For MVP, we will repeat the first 4 weeks of the template as "Base"
    const extraWeeks = totalWeeks - templateLength;
    
    // 1. Generate Base Weeks (Repeat Week 1-4 cyclically)
    for (let w = 1; w <= extraWeeks; w++) {
      const templateWeekToCopy = ((w - 1) % 4) + 1; // 1, 2, 3, 4, 1, 2...
      const startDayOfTemplate = (templateWeekToCopy - 1) * 7 + 1;
      const endDayOfTemplate = startDayOfTemplate + 6;

      const weeksWorkouts = templateWorkouts
        .filter(workout => workout.day >= startDayOfTemplate && workout.day <= endDayOfTemplate)
        .map(workout => ({
          ...workout,
          day: (w - 1) * 7 + (workout.day - startDayOfTemplate + 1), // Remap day
          title: `Base Building: ${workout.title}` // Tag it
        }));
      
      finalWorkouts.push(...weeksWorkouts);
    }

    // 2. Append the full template after the base weeks
    const shiftedTemplate = templateWorkouts.map(w => ({
      ...w,
      day: w.day + (extraWeeks * 7)
    }));
    
    finalWorkouts.push(...shiftedTemplate);
  }

  return finalWorkouts;
}

/**
 * Lines a race plan up so its last day is race day.
 *
 * Plans are built in whole weeks from today, so one could finish up to six
 * days before the race and leave race week blank. A plan shorter than the
 * time available starts later (so the taper lands on race day); one longer
 * than the time available loses its opening days instead.
 */
export function alignPlanToRace<T extends { day: number }>(
  workouts: T[],
  raceDate: Date,
  today: Date = new Date(),
): { workouts: T[]; startDate: Date } {
  const start = startOfDay(today);
  const lastDay = Math.max(0, ...workouts.map(w => w.day));
  const raceProgramDay = differenceInCalendarDays(startOfDay(raceDate), start) + 1;
  if (lastDay === 0 || raceProgramDay < 1) return { workouts, startDate: start };

  if (lastDay <= raceProgramDay) {
    return { workouts, startDate: addDays(start, raceProgramDay - lastDay) };
  }

  const overshoot = lastDay - raceProgramDay;
  return {
    workouts: workouts.filter(w => w.day > overshoot).map(w => ({ ...w, day: w.day - overshoot })),
    startDate: start,
  };
}
