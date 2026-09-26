// The answers the "Generate AI Workout" dialog collects. Shared by the dialog and
// the generate-workout flow; kept out of the flow because a 'use server' module
// may only export async functions.

export const WORKOUT_FOCUSES = ['hyrox', 'strength', 'conditioning', 'running', 'hybrid', 'mobility'] as const;
export const WORKOUT_DURATIONS = [20, 30, 45, 60, 75] as const;
export const WORKOUT_EQUIPMENT = ['full-gym', 'dumbbells-kettlebells', 'bodyweight', 'run-only'] as const;
export const WORKOUT_INTENSITIES = ['easy', 'moderate', 'hard'] as const;

export type WorkoutFocus = (typeof WORKOUT_FOCUSES)[number];
export type WorkoutEquipment = (typeof WORKOUT_EQUIPMENT)[number];
export type WorkoutIntensity = (typeof WORKOUT_INTENSITIES)[number];

export interface WorkoutPreferences {
  focus: WorkoutFocus;
  durationMinutes: number;
  equipment: WorkoutEquipment;
  intensity: WorkoutIntensity;
  notes?: string;
}

export const DEFAULT_WORKOUT_PREFERENCES: WorkoutPreferences = {
  focus: 'hyrox',
  durationMinutes: 45,
  equipment: 'full-gym',
  intensity: 'moderate',
};

export const FOCUS_LABELS: Record<WorkoutFocus, { label: string; hint: string }> = {
  hyrox: { label: 'HYROX', hint: 'Stations + compromised running' },
  strength: { label: 'Strength', hint: 'Heavy lifts, full rest' },
  conditioning: { label: 'Conditioning', hint: 'Metcon, EMOMs, AMRAPs' },
  running: { label: 'Running', hint: 'A pure run session' },
  hybrid: { label: 'Hybrid', hint: 'Runs + gym work' },
  mobility: { label: 'Mobility', hint: 'Easy recovery work' },
};

export const EQUIPMENT_LABELS: Record<WorkoutEquipment, string> = {
  'full-gym': 'Full gym',
  'dumbbells-kettlebells': 'Dumbbells / KBs',
  bodyweight: 'Bodyweight',
  'run-only': 'Just running',
};

export const INTENSITY_LABELS: Record<WorkoutIntensity, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
};

export const NOTES_MAX_LENGTH = 300;
