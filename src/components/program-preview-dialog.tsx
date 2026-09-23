
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Calendar } from 'lucide-react';
import { getProgramClient } from '@/services/program-service-client';
import type { Program, WorkoutDay } from '@/models/types';
import { hasRuns, hasExercises } from '@/lib/type-guards';

interface ProgramPreviewDialogProps {
  programId: string;
  programName?: string;
}

export function ProgramPreviewDialog({ programId, programName }: ProgramPreviewDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [program, setProgram] = useState<Program | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && !program) {
      const fetchProgram = async () => {
        setIsLoading(true);
        try {
          const data = await getProgramClient(programId);
          setProgram(data);
        } catch (error) {
          console.error('Failed to fetch program preview:', error);
        } finally {
          setIsLoading(false);
        }
      };
      fetchProgram();
    }
  }, [isOpen, programId, program]);

  // Group workouts by week (assuming 7 days per week)
  const workoutsByWeek = program?.workouts.reduce((acc, workout) => {
    const weekNum = Math.ceil(workout.day / 7);
    if (!acc[weekNum]) {
      acc[weekNum] = [];
    }
    acc[weekNum].push(workout);
    return acc;
  }, {} as Record<number, WorkoutDay[]>) || {};

  // Sort weeks and workouts
  const sortedWeeks = Object.keys(workoutsByWeek).map(Number).sort((a, b) => a - b);
  
  // Only show first 2 weeks for preview
  const previewWeeks = sortedWeeks.slice(0, 2);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full mt-2">
          <EyeIcon className="mr-2 h-3 w-3" />
          Preview Schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{program?.name || programName || 'Program Preview'}</DialogTitle>
          <DialogDescription>
             A sneak peek at the first 2 weeks of training.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : program ? (
          <ScrollArea className="h-[50vh] pr-4">
            <div className="space-y-6">
               <p className="text-sm text-muted-foreground italic">
                  Note: This schedule will adapt to your start date.
               </p>

              {previewWeeks.map((week) => (
                <div key={week} className="space-y-3">
                  <h3 className="font-headline text-lg font-bold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Week {week}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {workoutsByWeek[week]
                      .sort((a, b) => a.day - b.day)
                      .map((workout, wi) => (
                      <div key={`${workout.day}-${wi}`} className="bg-muted/50 p-3 rounded-lg border text-sm">
                        <div className="font-semibold mb-1 flex justify-between">
                            <span>Day {workout.day}</span>
                            <span className="text-xs text-muted-foreground uppercase tracking-wider">
                                {hasRuns(workout) && hasExercises(workout) ? 'Hybrid' : hasRuns(workout) ? 'Running' : 'Strength/Hyrox'}
                            </span>
                        </div>
                        <p className="font-medium text-primary mb-2">{workout.title}</p>

                        {/* Preview of content */}
                        <div className="text-xs text-muted-foreground space-y-1">
                            {hasRuns(workout) && workout.runs.map((run, idx) => (
                                <div key={idx} className="flex items-start gap-1">
                                     <span className="mt-0.5">•</span>
                                     <span>{run.distance}km {run.type}</span>
                                </div>
                            ))}
                            {hasExercises(workout) && workout.exercises.slice(0, 3).map((ex, idx) => (
                                <div key={idx} className="flex items-start gap-1">
                                    <span className="mt-0.5">•</span>
                                    <span>{ex.name}</span>
                                </div>
                            ))}
                            {(workout.exercises?.length > 3) && (
                                <p className="pt-1 opacity-70">...and more</p>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
                  <p className="font-medium text-primary">
                      This is just the beginning.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                      Unlock the full {program.workouts.length / 7}-week program and AI coaching features when you start.
                  </p>
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Program details could not be loaded.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EyeIcon(props: any) {
    return (
      <svg
        {...props}
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }
