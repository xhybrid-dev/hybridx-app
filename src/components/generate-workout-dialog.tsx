'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_WORKOUT_PREFERENCES,
  EQUIPMENT_LABELS,
  FOCUS_LABELS,
  INTENSITY_LABELS,
  NOTES_MAX_LENGTH,
  WORKOUT_DURATIONS,
  WORKOUT_EQUIPMENT,
  WORKOUT_FOCUSES,
  WORKOUT_INTENSITIES,
  type WorkoutPreferences,
} from '@/lib/workout-preferences';

// Last answers, so someone who always trains in the same gym for 45 minutes
// isn't re-answering every time. Notes are deliberately not remembered: they
// are usually about today ("sore calves").
const PREFS_KEY = 'hybridx:generate-workout-prefs';

function loadSavedPreferences(): WorkoutPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_WORKOUT_PREFERENCES;
    const saved = JSON.parse(raw) as Partial<WorkoutPreferences>;
    return {
      focus: WORKOUT_FOCUSES.includes(saved.focus as never) ? saved.focus! : DEFAULT_WORKOUT_PREFERENCES.focus,
      durationMinutes: WORKOUT_DURATIONS.includes(saved.durationMinutes as never) ? saved.durationMinutes! : DEFAULT_WORKOUT_PREFERENCES.durationMinutes,
      equipment: WORKOUT_EQUIPMENT.includes(saved.equipment as never) ? saved.equipment! : DEFAULT_WORKOUT_PREFERENCES.equipment,
      intensity: WORKOUT_INTENSITIES.includes(saved.intensity as never) ? saved.intensity! : DEFAULT_WORKOUT_PREFERENCES.intensity,
    };
  } catch {
    return DEFAULT_WORKOUT_PREFERENCES;
  }
}

function savePreferences({ notes: _notes, ...prefs }: WorkoutPreferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private mode): the dialog just starts from defaults next time.
  }
}

interface ChoiceGroupProps<T extends string | number> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (value: T) => React.ReactNode;
  columns?: string;
}

function ChoiceGroup<T extends string | number>({ label, options, value, onChange, render, columns = 'grid-cols-3' }: ChoiceGroupProps<T>) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{label}</Label>
      <div role="radiogroup" aria-label={label} className={cn('grid gap-2', columns)}>
        {options.map(option => {
          const selected = option === value;
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={cn(
                'rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/50'
              )}
            >
              {render(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface GenerateWorkoutDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isGenerating: boolean;
  onGenerate: (preferences: WorkoutPreferences) => void;
}

export function GenerateWorkoutDialog({ isOpen, setIsOpen, isGenerating, onGenerate }: GenerateWorkoutDialogProps) {
  const [prefs, setPrefs] = useState<WorkoutPreferences>(DEFAULT_WORKOUT_PREFERENCES);

  useEffect(() => {
    if (isOpen) setPrefs({ ...loadSavedPreferences(), notes: '' });
  }, [isOpen]);

  const update = <K extends keyof WorkoutPreferences>(key: K, value: WorkoutPreferences[K]) =>
    setPrefs(prev => ({ ...prev, [key]: value }));

  const handleGenerate = () => {
    savePreferences(prefs);
    onGenerate({ ...prefs, notes: prefs.notes?.trim() || undefined });
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !isGenerating && setIsOpen(open)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build today&apos;s workout</DialogTitle>
          <DialogDescription>A few quick answers and the AI will shape the session around you.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <ChoiceGroup
            label="What do you want to work on?"
            options={WORKOUT_FOCUSES}
            value={prefs.focus}
            onChange={v => update('focus', v)}
            columns="grid-cols-2 sm:grid-cols-3"
            render={v => (
              <>
                <span className="block">{FOCUS_LABELS[v].label}</span>
                <span className="block text-xs text-muted-foreground font-normal">{FOCUS_LABELS[v].hint}</span>
              </>
            )}
          />

          <ChoiceGroup
            label="How long have you got?"
            options={WORKOUT_DURATIONS}
            value={prefs.durationMinutes as (typeof WORKOUT_DURATIONS)[number]}
            onChange={v => update('durationMinutes', v)}
            columns="grid-cols-5"
            render={v => <span className="block text-center">{v}m</span>}
          />

          <ChoiceGroup
            label="What equipment do you have?"
            options={WORKOUT_EQUIPMENT}
            value={prefs.equipment}
            onChange={v => update('equipment', v)}
            columns="grid-cols-2"
            render={v => EQUIPMENT_LABELS[v]}
          />

          <ChoiceGroup
            label="How hard do you want to go?"
            options={WORKOUT_INTENSITIES}
            value={prefs.intensity}
            onChange={v => update('intensity', v)}
            render={v => <span className="block text-center">{INTENSITY_LABELS[v]}</span>}
          />

          <div className="space-y-2">
            <Label htmlFor="generate-workout-notes" className="text-sm font-semibold">
              Anything else? <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="generate-workout-notes"
              placeholder="e.g. sore calves, focus on upper body, no burpees"
              value={prefs.notes ?? ''}
              maxLength={NOTES_MAX_LENGTH}
              rows={2}
              onChange={e => update('notes', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button type="button" variant="accent" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            {isGenerating ? 'Generating...' : 'Generate workout'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
