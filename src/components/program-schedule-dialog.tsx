'use client';

import { useState } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { Calendar as CalendarIcon, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Program } from '@/models/types';
import { hasRuns, hasExercises } from '@/lib/type-guards';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';

interface ProgramScheduleDialogProps {
  program: Program | null;
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (programId: string, startDate: Date) => void;
  isScheduling: boolean;
}

function getCycleLength(program: Program): number {
  return Math.max(...program.workouts.map(w => w.day), 0);
}

export function ProgramScheduleDialog({
  program,
  isOpen,
  onClose,
  onSchedule,
  isScheduling,
}: ProgramScheduleDialogProps) {
  const [mode, setMode] = useState<'start' | 'end'>('start');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date | undefined>(new Date());

  const cycleLength = program ? getCycleLength(program) : 0;

  // Derive the start date from whichever mode is active
  const resolvedStartDate = (): Date | undefined => {
    if (!pickedDate) return undefined;
    if (mode === 'start') return pickedDate;
    // end date mode: startDate = endDate - (cycleLength - 1) days
    return cycleLength > 0 ? subDays(pickedDate, cycleLength - 1) : pickedDate;
  };

  // Derived display values
  const startDate = resolvedStartDate();
  const endDate = startDate && cycleLength > 0 ? addDays(startDate, cycleLength - 1) : startDate;

  const handleSchedule = () => {
    if (program && startDate) {
      onSchedule(program.id, startDate);
    }
  };

  const handleStartToday = () => {
    const today = new Date();
    if (program) {
      onSchedule(program.id, today);
    }
  };

  if (!program) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{program.name}</DialogTitle>
          <DialogDescription>{program.description}</DialogDescription>
        </DialogHeader>

        <div className="my-4">
          <h4 className="font-semibold mb-2">Weekly Workout Schedule</h4>
          <ScrollArea className="h-64 pr-4">
            <Accordion type="single" collapsible className="w-full">
              {program.workouts.map((workout) => (
                <AccordionItem value={`day-${workout.day}`} key={workout.day}>
                  <AccordionTrigger>Day {workout.day}: {workout.title}</AccordionTrigger>
                  <AccordionContent>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      {hasRuns(workout) && workout.runs.map((run, index) => (
                        <li key={`run-${index}`}>
                          <span className="font-medium text-foreground">{run.type} {run.distance}km:</span> {run.description}
                        </li>
                      ))}
                      {hasExercises(workout) && workout.exercises.map((exercise, index) => (
                        <li key={`ex-${index}`}>
                          <span className="font-medium text-foreground">{exercise.name}:</span> {exercise.details}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        </div>

        <div className="space-y-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'start' | 'end')}>
            <TabsList className="w-full">
              <TabsTrigger value="start" className="flex-1">Schedule by Start Date</TabsTrigger>
              <TabsTrigger value="end" className="flex-1">Schedule by End Date</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCalendarOpen((o) => !o)}
              className={cn(
                'w-[220px] justify-start text-left font-normal',
                !pickedDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {pickedDate ? format(pickedDate, 'PPP') : <span>Pick a date</span>}
            </Button>

            {pickedDate && cycleLength > 0 && (
              <p className="text-sm text-muted-foreground">
                {mode === 'start'
                  ? <>Ends <span className="font-medium text-foreground">{format(endDate!, 'PPP')}</span></>
                  : <>Starts <span className="font-medium text-foreground">{format(startDate!, 'PPP')}</span></>}
              </p>
            )}
          </div>

          {calendarOpen && (
            <div className="flex justify-center rounded-md border">
              <Calendar
                mode="single"
                selected={pickedDate}
                onSelect={(date) => {
                  setPickedDate(date);
                  if (date) setCalendarOpen(false);
                }}
                initialFocus
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button onClick={handleSchedule} disabled={isScheduling || !startDate}>
            {isScheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule
          </Button>
          <Button onClick={handleStartToday} disabled={isScheduling} variant="outline" className="sm:ml-auto">
            {isScheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start Today
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
