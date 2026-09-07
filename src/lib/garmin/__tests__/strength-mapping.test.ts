import { describe, expect, it } from 'vitest';

import { mapWorkoutDay, parseSetsReps, parseTimedSets } from '../workout-mapper';
import type { WorkoutDay } from '../workout-mapper';

function flatten(workout: ReturnType<typeof mapWorkoutDay>) {
  const out: string[] = [];
  for (const seg of workout!.segments) {
    for (const st of seg.steps) {
      if (st.type === 'WorkoutRepeatStep') {
        for (const inner of st.steps) out.push(inner.description ?? '');
      } else {
        out.push(st.description ?? '');
      }
    }
  }
  return out;
}

describe('parseSetsReps', () => {
  it('still reads the plain ASCII "x" shape', () => {
    expect(parseSetsReps('4x5 | RPE 8')).toEqual({ sets: 4, reps: 5, isAmrap: false });
    expect(parseSetsReps('3x8-10')).toEqual({ sets: 3, reps: 8, repsMax: 10, isAmrap: false });
  });

  it('reads the Unicode multiplication sign, with or without the word "sets"', () => {
    expect(parseSetsReps('3 sets × 20 reps. Upper back on floor or bench.'))
      .toEqual({ sets: 3, reps: 20, isAmrap: false });
    expect(parseSetsReps('3 × 20 reps')).toEqual({ sets: 3, reps: 20, isAmrap: false });
  });

  it('reads "N sets of M"', () => {
    expect(parseSetsReps('Work up to 2 sets of 3 at 85% of your 1RM.'))
      .toEqual({ sets: 2, reps: 3, isAmrap: false });
  });

  it('still excludes a distance or timed shape, leaving those to their own parsers', () => {
    expect(parseSetsReps('5x800m')).toBeNull();
    expect(parseSetsReps('3x90 seconds')).toBeNull();
    expect(parseSetsReps('3 sets × 25 seconds per side')).toBeNull();
    expect(parseSetsReps('3 × 20m at a challenging but controlled weight')).toBeNull();
  });

  it('still handles AMRAP', () => {
    expect(parseSetsReps('4x AMRAP')).toEqual({ sets: 4, reps: 0, isAmrap: true });
  });

  it('returns null for a set count with no rep count anywhere in the text', () => {
    // "3 sets | RPE 7" — a genuine content gap, not a parsing failure.
    expect(parseSetsReps('3 sets | RPE 7')).toBeNull();
  });
});

describe('parseTimedSets', () => {
  it('still reads the plain ASCII "x" shape', () => {
    expect(parseTimedSets('3x90 seconds')).toEqual({ sets: 3, timeS: 90 });
    expect(parseTimedSets('4x60sec per side')).toEqual({ sets: 4, timeS: 60 });
  });

  it('reads the Unicode multiplication sign, with or without the word "sets"', () => {
    expect(parseTimedSets('3 sets × 25 seconds per side. Side plank with top foot on a bench.'))
      .toEqual({ sets: 3, timeS: 25 });
  });

  it('reads "N sets of M seconds"', () => {
    expect(parseTimedSets('2 sets of 30 seconds')).toEqual({ sets: 2, timeS: 30 });
  });

  it('does not match a rep count, leaving that to parseSetsReps', () => {
    expect(parseTimedSets('3 sets × 20 reps')).toBeNull();
  });
});

describe('coaching-prose rows are not sent as steps', () => {
  it('drops a Notes row from a strength session but keeps its text in the description', () => {
    const day: WorkoutDay = {
      day: 1,
      title: 'Lower Body Strength',
      sessionType: 'strength',
      exercises: [
        { name: 'Back Squat', details: '4x5 | RPE 8' },
        { name: 'Notes', details: 'Focus on bar speed today, we are peaking next week.' },
      ],
    };

    const w = mapWorkoutDay(day);
    const steps = flatten(w);
    expect(steps.some((d) => d.startsWith('Back Squat'))).toBe(true);
    expect(steps.some((d) => d.startsWith('Notes'))).toBe(false);
    expect(w!.description).toContain('Focus on bar speed today');
  });

  it('drops an emoji-prefixed Session Notes row', () => {
    const day: WorkoutDay = {
      day: 33,
      title: 'Strength Peaking',
      sessionType: 'strength',
      exercises: [
        { name: '📋 Session Notes', details: '5×5 at 75% is the classic strength-building protocol.' },
        { name: 'Bench Press', details: '5x5 @ 75%' },
      ],
    };

    const steps = flatten(mapWorkoutDay(day));
    expect(steps.some((d) => d.includes('Session Notes'))).toBe(false);
    expect(steps.some((d) => d.startsWith('Bench Press'))).toBe(true);
  });

  it('keeps Format and Work rows in a circuit session — they carry the prescribed work', () => {
    const day: WorkoutDay = {
      day: 2,
      title: 'CrossFit Conditioning',
      sessionType: 'cardio',
      garminSport: 'CARDIO_TRAINING',
      exercises: [
        { name: 'Format', details: 'CrossFit engine builder. 4 rounds for time' },
        { name: 'Work 1', details: '500m row · 15 burpees over rower · 20 wall balls (9kg)' },
        { name: 'Work 2', details: '400m run · rest 90s between rounds' },
        { name: 'Notes', details: 'Effort RPE 8. Builds the aerobic-power overlap.' },
      ],
    };

    const steps = flatten(mapWorkoutDay(day));
    expect(steps.some((d) => d.startsWith('Format'))).toBe(true);
    expect(steps.some((d) => d.startsWith('Work 1'))).toBe(true);
    expect(steps.some((d) => d.startsWith('Work 2'))).toBe(true);
    expect(steps.some((d) => d.startsWith('Notes'))).toBe(false);
  });

  it('does not collapse a session to just warm-up and cool-down when every row is a note', () => {
    // Pathological input, but the mapper should not silently push an empty
    // workout — this documents current behavior rather than asserting an
    // opinion about what should happen instead.
    const day: WorkoutDay = {
      day: 1,
      title: 'Rest',
      sessionType: 'strength',
      exercises: [{ name: 'Coaching Note', details: 'Take the day fully off.' }],
    };

    const steps = flatten(mapWorkoutDay(day));
    expect(steps).toEqual(['Warm up — press lap when ready', 'Cool down — press lap when done']);
  });
});

describe('max-effort sets without a fixed target', () => {
  function repeatSteps(w: ReturnType<typeof mapWorkoutDay>) {
    const seg = w!.segments[0];
    const repeat = seg.steps.find((s) => s.type === 'WorkoutRepeatStep');
    return repeat as Extract<typeof repeat, { type: 'WorkoutRepeatStep' }>;
  }

  it('reads the set count and labels an unbounded-reps set, even with no digit after "of"', () => {
    // The real Dual Peak row this was written for: no rep count anywhere,
    // so parseSetsReps() correctly returns null and the mapper needs
    // another way to find "3".
    const day: WorkoutDay = {
      day: 12, title: 'Strength Maintenance B', sessionType: 'strength',
      exercises: [{
        name: 'Max Chin-ups (Strict)',
        details: '3 sets of max unbroken reps. Dead hang start, chin over bar, full extension '
          + 'at the bottom. Rest exactly 3 minutes between sets. Record total reps per set — '
          + 'this is your pulling baseline for Phase 2 progression. Add weight if you can do 15+ unbroken.',
      }],
    };

    const w = mapWorkoutDay(day);
    const repeat = repeatSteps(w);
    expect(repeat.repeatValue).toBe(3);
    const work = repeat.steps.find((s) => s.intensity === 'ACTIVE')!;
    expect(work.description).toContain('max reps');
    expect(work.durationType).toBe('OPEN');
  });

  it('still recognises a held effort as before ("max hold" / "dead hang")', () => {
    const day: WorkoutDay = {
      day: 1, title: 'Grip', sessionType: 'strength',
      exercises: [{ name: 'Dead Hang', details: '3 sets, max hold' }],
    };
    const work = repeatSteps(mapWorkoutDay(day)).steps.find((s) => s.intensity === 'ACTIVE')!;
    expect(work.description).toContain('max hold');
  });

  it('does not touch a bare "AMRAP" row — that is parseSetsReps()\'s job', () => {
    // "3xAMRAP" already parses as a real AMRAP set via parseSetsReps(); this
    // must keep going through that path, not the new max-reps special case.
    const day: WorkoutDay = {
      day: 1, title: 'Finisher', sessionType: 'strength',
      exercises: [{ name: 'Push-ups', details: '3xAMRAP' }],
    };
    const w = mapWorkoutDay(day);
    const repeat = repeatSteps(w);
    expect(repeat.repeatValue).toBe(3);
    const work = repeat.steps.find((s) => s.intensity === 'ACTIVE')!;
    // The isAmrap path's own label, not "max reps" / "max hold".
    expect(work.description).not.toContain('max reps');
    expect(work.description).not.toContain('max hold');
  });

  it('leaves a top-set-then-drop-set row on the numeric path, not the max-reps special case', () => {
    // Real row from HybridX Master 12-Week Integrated Schedule: the leading
    // "1x5" is the actual prescribed top set and must keep winning, even
    // though "max reps" appears later in the same string.
    const day: WorkoutDay = {
      day: 5, title: 'Strength', sessionType: 'strength',
      exercises: [{
        name: 'Back Squat',
        details: 'Top set: 1x5 @ 135kg. Immediately drop to 60kg, max reps to failure. 3 min rest.',
      }],
    };
    const w = mapWorkoutDay(day);
    const repeat = repeatSteps(w);
    expect(repeat.repeatValue).toBe(1); // the "1x5" top set, not the hardcoded max-reps default of 3
    const work = repeat.steps.find((s) => s.intensity === 'ACTIVE')!;
    expect(work.durationType).toBe('REPS');
    expect(work.durationValue).toBe(5);
  });

  it('does not mistake "dead hang start" — a rep cue — for a hold prescription', () => {
    // Real second Dual Peak row (day 46) using this exact phrasing.
    const day: WorkoutDay = {
      day: 46, title: 'Strength Maintenance C', sessionType: 'strength',
      exercises: [{
        name: 'Max Unbroken Chin-ups (Strict)',
        details: 'One all-out set of max unbroken strict chin-ups. Dead hang start, chin over '
          + 'bar on every rep. Record total — this is your competition baseline.',
      }],
    };
    const steps = flatten(mapWorkoutDay(day));
    expect(steps.some((d) => d.includes('max hold'))).toBe(false);
  });

  it('still recognises a genuine dead-hang hold exercise by name', () => {
    const day: WorkoutDay = {
      day: 1, title: 'Grip', sessionType: 'strength',
      exercises: [{
        name: 'Grip Strength - Dead Hangs',
        details: 'Pull-up Bar Dead Hangs: 3-4 Sets x 30-45 sec. Overhand grip, shoulders engaged.',
      }],
    };
    const steps = flatten(mapWorkoutDay(day));
    expect(steps.some((d) => d.includes('max hold'))).toBe(true);
  });

  it('reads the set count from "Nx Max Reps", not just "N sets of max reps"', () => {
    // Real row: "Core: Strict Toes-to-Bar" | "4x Max Reps" — no digit after
    // "x" since the target is "max", not a number, so parseSetsReps() can't
    // read the 4 either; this must not fall back to the hardcoded default.
    const day: WorkoutDay = {
      day: 37, title: 'Strength', sessionType: 'strength',
      exercises: [{ name: 'Core: Strict Toes-to-Bar', details: '4x Max Reps' }],
    };
    const repeat = repeatSteps(mapWorkoutDay(day));
    expect(repeat.repeatValue).toBe(4);
  });
});
