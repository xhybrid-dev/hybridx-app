'use client';
import { trackEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Calendar as CalendarIcon, Plus, Trash2, Route, Dumbbell } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logManualWorkoutSession } from '@/services/session-service-client';
import type { PlannedRun } from '@/models/types';
import { cn } from '@/lib/utils';

const RUN_TYPES = ['easy', 'tempo', 'intervals', 'long', 'recovery'] as const;
const PACE_ZONES = ['recovery', 'easy', 'marathon', 'threshold', 'interval', 'repetition'] as const;

/** Sensible pace-zone default per run type, so the run displays correctly
 *  everywhere without the user having to think about zones at all. */
const DEFAULT_PACE_ZONE: Record<(typeof RUN_TYPES)[number], (typeof PACE_ZONES)[number]> = {
  easy: 'easy',
  tempo: 'threshold',
  intervals: 'interval',
  long: 'marathon',
  recovery: 'recovery',
};

const runSchema = z.object({
  type: z.enum(RUN_TYPES),
  paceZone: z.enum(PACE_ZONES),
  distance: z.coerce.number().positive('Enter a distance greater than 0.'),
  effortLevel: z.coerce.number().int().min(1).max(10),
  description: z.string().optional(),
});

const exerciseSchema = z.object({
  name: z.string(),
  details: z.string().optional(),
});

const logWorkoutSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  type: z.enum(['running', 'hyrox']),
  date: z.date(),
  duration: z.string().optional(),
  notes: z.string().optional(),
  run: runSchema,
  exercises: z.array(exerciseSchema),
});

type LogWorkoutFormData = z.infer<typeof logWorkoutSchema>;

interface CustomWorkoutDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  userId: string;
  /** Called after a successful log so the caller can refresh its session list. */
  onLogged?: () => void;
}

export function CustomWorkoutDialog({ isOpen, setIsOpen, userId, onLogged }: CustomWorkoutDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LogWorkoutFormData>({
    resolver: zodResolver(logWorkoutSchema),
    defaultValues: {
      title: '',
      type: 'running',
      date: new Date(),
      duration: '',
      notes: '',
      run: { type: 'easy', paceZone: 'easy', distance: 5, effortLevel: 5, description: '' },
      exercises: [{ name: '', details: '' }],
    },
  });

  const type = useWatch({ control: form.control, name: 'type' });
  const runType = useWatch({ control: form.control, name: 'run.type' });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'exercises' });

  const onSubmit = async (data: LogWorkoutFormData) => {
    if (data.type === 'hyrox' && !data.exercises.some((e) => e.name.trim())) {
      form.setError('exercises', { message: 'Add at least one exercise.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await logManualWorkoutSession(userId, {
        date: data.date,
        title: data.title,
        type: data.type,
        duration: data.duration?.trim() || undefined,
        notes: data.notes?.trim() || undefined,
        run: data.type === 'running'
          ? {
              type: data.run.type,
              paceZone: data.run.paceZone,
              distance: data.run.distance,
              effortLevel: data.run.effortLevel as PlannedRun['effortLevel'],
              description: data.run.description?.trim() || `${data.run.distance}km ${data.run.type} run`,
            }
          : undefined,
        exercises: data.type === 'hyrox'
          ? data.exercises
              .filter((e) => e.name.trim())
              .map((e) => ({ name: e.name.trim(), details: e.details?.trim() || '' }))
          : undefined,
      });
      trackEvent(userId, 'workout_completed', { source: 'manual_log', title: data.title });
      toast({ title: 'Workout Logged', description: `"${data.title}" has been added to your log.` });
      setIsOpen(false);
      form.reset();
      onLogged?.();
    } catch (error) {
      logger.error('Failed to log manual workout:', error);
      toast({
        title: 'Error',
        description: 'Could not log your workout. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) form.reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log New Workout</DialogTitle>
          <DialogDescription>
            Record an activity that's not part of your program — it's added to your log as completed.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ScrollArea className="max-h-[60vh] -mx-1 px-1">
              <div className="space-y-4 pb-1">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Workout Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="running">
                              <span className="flex items-center gap-2"><Route className="h-3.5 w-3.5" /> Running</span>
                            </SelectItem>
                            <SelectItem value="hyrox">
                              <span className="flex items-center gap-2"><Dumbbell className="h-3.5 w-3.5" /> Strength / Hybrid</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant="outline" className={cn('font-normal justify-start', !field.value && 'text-muted-foreground')}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, 'MMM d, yyyy') : 'Pick a date'}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={(d) => d && field.onChange(d)}
                              disabled={(d) => d > new Date()}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workout Title</FormLabel>
                      <FormControl>
                        <Input placeholder={type === 'running' ? 'e.g., Evening Run' : 'e.g., Full Body Gym Session'} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {type === 'running' ? (
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="run.type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Run Type</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={(v) => {
                                field.onChange(v);
                                form.setValue('run.paceZone', DEFAULT_PACE_ZONE[v as (typeof RUN_TYPES)[number]]);
                              }}
                            >
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {RUN_TYPES.map((t) => (
                                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="run.distance"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Distance (km)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.1" min="0.1" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="run.paceZone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Pace Zone</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {PACE_ZONES.map((z) => (
                                  <SelectItem key={z} value={z} className="capitalize">{z}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="run.effortLevel"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Effort (RPE 1–10)</FormLabel>
                            <FormControl>
                              <Input type="number" min="1" max="10" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="run.description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Description (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder={`e.g., ${form.getValues('run.distance') || 5}km ${runType} run`} {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border p-3">
                    <FormLabel className="text-xs">Exercises</FormLabel>
                    {fields.map((f, index) => (
                      <div key={f.id} className="flex items-start gap-2">
                        <FormField
                          control={form.control}
                          name={`exercises.${index}.name`}
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormControl>
                                <Input placeholder="e.g., Back Squat" {...field} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`exercises.${index}.details`}
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormControl>
                                <Input placeholder="e.g., 5x5 @ 80kg" {...field} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => remove(index)}
                          disabled={fields.length <= 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                    {form.formState.errors.exercises?.message && (
                      <p className="text-sm font-medium text-destructive">{form.formState.errors.exercises.message}</p>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={() => append({ name: '', details: '' })}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Exercise
                    </Button>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration in minutes (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 45" inputMode="numeric" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Anything else worth remembering — splits, how it felt, conditions..."
                          className="resize-none"
                          rows={2}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </ScrollArea>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Log Workout
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
