
'use client';

import { useState, useEffect } from 'react';
import { addMonths, format } from 'date-fns';
import { Calendar as CalendarIcon, Trophy, Flag, AlertTriangle, ArrowRight, Loader2, Check, RefreshCw, ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { calculateTrainingPhases, type RacePlan } from '@/services/race-scheduler';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/client-auth';
import type { WorkoutDay } from '@/models/types';
import { hasRuns, hasExercises } from '@/lib/type-guards';
import { updateUser } from '@/services/user-service-client';
import { clearFutureProgramSessions } from '@/services/session-service';
import { logger } from '@/lib/logger';
import { savePersonalProgram } from '@/services/program-service-client'; // IMPORTED
import { useUser } from '@/contexts/user-context';

// Helper to remove undefined values for Firestore
function sanitizeForFirestore(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(v => sanitizeForFirestore(v));
    } else if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
        return Object.keys(obj).reduce((acc, key) => {
            const value = obj[key];
            if (value !== undefined) {
                acc[key] = sanitizeForFirestore(value);
            }
            return acc;
        }, {} as any);
    }
    return obj;
}

export function RacePrepDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [date, setDate] = useState<Date>();
  const [eventName, setEventName] = useState('');
  const [eventType, setEventType] = useState('hyrox');
  const [eventDetails, setEventDetails] = useState('');
  const [adjustComments, setAdjustComments] = useState('');
  
  const [planPreview, setPlanPreview] = useState<RacePlan | null>(null);
  const [generatedWorkouts, setGeneratedWorkouts] = useState<WorkoutDay[]>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const { toast } = useToast();
  const router = useRouter();
  const { user } = useUser();

  // Reset when closed
  useEffect(() => {
      if (!isOpen) {
          setStep(1);
          setGeneratedWorkouts([]);
      }
  }, [isOpen]);

  // Recalculate timeline preview whenever date changes
  useEffect(() => {
    if (date) {
      const plan = calculateTrainingPhases(date);
      setPlanPreview(plan);
    } else {
      setPlanPreview(null);
    }
  }, [date]);

  const handleGeneratePreview = async () => {
    if (!date || !eventName) return;
    setIsGenerating(true);
    
    try {
        const response = await authedFetch('/api/ai/generate-race-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date,
                eventName,
                eventType,
                eventDetails
            })
        });
        
        if (!response.ok) throw new Error("Failed to generate");
        
        const data = await response.json();
        setGeneratedWorkouts(data.workouts);
        setStep(2); 
        
    } catch (error) {
        toast({ title: "Error", description: "Could not generate plan. Please try again.", variant: "destructive" });
    } finally {
        setIsGenerating(false);
    }
  };

  const handleConfirmAndStart = async () => {
      if (!user) return;
      setIsSaving(true);
      
      try {
          const sanitizedWorkouts = sanitizeForFirestore(generatedWorkouts);

          // 1. Create a Personal Program document
          const programId = await savePersonalProgram(user.id, {
              name: `Prep for ${eventName}`,
              description: `Custom ${eventType} plan tailored for ${eventName}. generated on ${format(new Date(), 'PP')}. ${eventDetails}`,
              programType: eventType.includes('run') ? 'running' : 'hyrox',
              workouts: sanitizedWorkouts
          });

          // 2. Set this as the active program
          await updateUser(user.id, {
              programId: programId,
              customProgram: sanitizedWorkouts, // Keep this for now as a fallback/cache
              startDate: new Date(),
              goal: 'hybrid',
          });

          // Clear any leftover per-day session docs from a previously assigned program so they
          // don't keep shadowing this newly activated plan's workouts on the same calendar dates.
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          try {
              await clearFutureProgramSessions({ fromDate: today });
          } catch (err) {
              // Not fatal — the program itself is already assigned — but it is not
              // cosmetic either: leftover docs shadow the new plan's workouts, so the
              // calendar can look empty. Say so rather than failing silently, which is
              // what made this hard to diagnose.
              logger.error('Failed to clear stale program sessions:', err);
              toast({
                  title: 'Program started, but the calendar may be stale',
                  description: 'Some entries from your previous plan could not be cleared. Reschedule the program if days look empty.',
                  variant: 'destructive',
              });
          }

          toast({
              title: "Plan Activated!",
              description: `Training for ${eventName} starts now. Good luck!`,
          });
          
          setIsOpen(false);
          router.refresh();
          
      } catch (error) {
          console.error("Save Failed:", error);
          toast({ title: "Save Failed", description: "Could not activate plan. Please try again.", variant: "destructive" });
      } finally {
          setIsSaving(false);
      }
  };

  const handleRegenerate = async () => {
      toast({ title: "AI Adjustment", description: "This would regenerate the plan based on your comments.", });
      handleGeneratePreview();
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <div className="group relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow cursor-pointer hover:shadow-lg transition-all">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Flag className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold leading-none tracking-tight text-lg">Train for an Event</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Got a race date? We'll reverse-engineer your perfect plan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogTrigger>
      
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            {step === 1 ? "Event Setup" : `Preview: ${eventName}`}
          </DialogTitle>
          <DialogDescription>
            {step === 1 
                ? "Tell us when you're racing. We'll build the bridge backwards from the finish line."
                : "Review your generated schedule. Adjust if needed, then confirm to start."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
            
          {/* STEP 1: INPUTS */}
          {step === 1 && (
            <div className="grid gap-6">
              <div className="grid gap-2">
                <Label>Event Name</Label>
                <Input 
                  placeholder="e.g. Hyrox London, Manchester Marathon" 
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Event Type</Label>
                  <Select value={eventType} onValueChange={setEventType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hyrox">Hyrox</SelectItem>
                      <SelectItem value="crossfit">Functional / CrossFit</SelectItem>
                      <SelectItem value="half-marathon">Half Marathon</SelectItem>
                      <SelectItem value="marathon">Marathon</SelectItem>
                      <SelectItem value="5k">5K Race</SelectItem>
                      <SelectItem value="10k">10K Race</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Race Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? format(date, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={setDate}
                        disabled={(date) => date < new Date()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Event Details & Goals</Label>
                <Textarea 
                    placeholder="Specific movements, target time, or limitations..."
                    className="resize-none"
                    rows={3}
                    value={eventDetails}
                    onChange={(e) => setEventDetails(e.target.value)}
                />
              </div>

              {/* TIMELINE VISUAL */}
              {planPreview && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">Your {planPreview.totalWeeks}-Week Roadmap</h4>
                    <span className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-full uppercase",
                      planPreview.status === 'optimal' ? "bg-green-100 text-green-700" :
                      planPreview.status === 'long-term' ? "bg-blue-100 text-blue-700" :
                      "bg-orange-100 text-orange-700"
                    )}>
                      {planPreview.status.replace('-', ' ')}
                    </span>
                  </div>
                  <div className="h-6 w-full flex rounded-full overflow-hidden">
                    {planPreview.phases.map((phase, idx) => (
                      <div 
                        key={idx}
                        className={cn(phase.color, "h-full")}
                        style={{ width: `${(phase.weeks / planPreview.totalWeeks) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {planPreview.phases.map((phase, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", phase.color)} />
                        <span className="font-medium text-foreground">{phase.name}</span>
                        <span>({phase.weeks} wks)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: PREVIEW & CONFIRM */}
          {step === 2 && (
              <div className="space-y-6">
                  <div className="bg-muted/30 border rounded-lg p-4 text-sm">
                      <p className="font-medium text-primary mb-1">Your plan is ready.</p>
                      <p className="text-muted-foreground">
                          We've generated {generatedWorkouts.length} workouts leading up to {date ? format(date, "PPP") : 'race day'}.
                          Here is a preview of your first week.
                      </p>
                  </div>

                  <ScrollArea className="h-[300px] border rounded-md p-4">
                      {generatedWorkouts.slice(0, 7).map((workout) => (
                          <div key={workout.day} className="mb-4 last:mb-0 border-b last:border-0 pb-4 last:pb-0">
                              <div className="flex justify-between items-start mb-1">
                                  <span className="font-bold text-sm">Day {workout.day}</span>
                                  <span className="text-xs uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                      {hasRuns(workout) && hasExercises(workout) ? 'Hybrid' : hasRuns(workout) ? 'Run' : 'Strength'}
                                  </span>
                              </div>
                              <p className="font-medium">{workout.title}</p>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {hasRuns(workout) ? workout.runs[0]?.description : workout.exercises?.[0]?.name}
                              </p>
                          </div>
                      ))}
                  </ScrollArea>

                  <div className="space-y-2">
                      <Label>Adjustments / Feedback</Label>
                      <div className="flex gap-2">
                          <Input 
                              placeholder="e.g. 'Make Saturdays rest days' or 'Add more rowing'"
                              value={adjustComments}
                              onChange={(e) => setAdjustComments(e.target.value)}
                          />
                          <Button variant="outline" size="icon" onClick={handleRegenerate} title="Regenerate with comments">
                              <RefreshCw className="h-4 w-4" />
                          </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                          Not perfect? Add a comment and hit refresh to refine the plan.
                      </p>
                  </div>
              </div>
          )}

        </div>

        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          {step === 1 ? (
              <Button disabled={!date || !eventName || isGenerating} onClick={handleGeneratePreview} className="w-full sm:w-auto">
                {isGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</> : "Preview Plan"}
              </Button>
          ) : (
              <div className="flex w-full justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                      <ChevronLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={handleConfirmAndStart} disabled={isSaving} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Start Training
                  </Button>
              </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckCircle(props: any) {
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
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    )
  }
