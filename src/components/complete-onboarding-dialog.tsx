'use client';

import { useState } from 'react';
import { Loader2, ArrowRight, ArrowLeft, Award, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getTopPrograms } from '@/services/program-recommendation';
import { getProgramClient } from '@/services/program-service-client';
import { fitToSchedule } from '@/lib/plan-condense';
import { updateUser } from '@/services/user-service-client';
import { useToast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/analytics';
import { ProgramPreviewDialog } from '@/components/program-preview-dialog';
import type { WorkoutDay } from '@/models/types';
import { logger } from '@/lib/logger';

type Experience = 'beginner' | 'intermediate' | 'advanced';
type Frequency = '3' | '4' | '5+';
type Goal = 'strength' | 'endurance' | 'hybrid';

interface ProfileData {
  experience: Experience;
  frequency: Frequency;
  goal: Goal;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  onComplete: () => void;
}

export function CompleteOnboardingDialog({ open, onOpenChange, userId, onComplete }: Props) {
  // userName is part of the public props but unused here — nothing in this
  // dialog currently renders a greeting.
  const { toast } = useToast();
  const [step, setStep] = useState<'profile' | 'program'>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    experience: 'beginner',
    frequency: '3',
    goal: 'hybrid',
  });
  const [selectedProgramId, setSelectedProgramId] = useState<string | undefined>(undefined);

  const recommendations = getTopPrograms(profile, 3);

  const handleProfileNext = () => {
    setSelectedProgramId(recommendations[0]?.program.id);
    setStep('program');
  };

  const handleFinish = async (programId?: string) => {
    setIsLoading(true);
    try {
      let customProgram: WorkoutDay[] | null = null;

      if (programId) {
        try {
          const selectedProgram = await getProgramClient(programId);
          customProgram = selectedProgram ? fitToSchedule(selectedProgram.workouts, profile.frequency) : null;
        } catch (err) {
          logger.error('Program adjustment failed:', err);
        }
      }

      await updateUser(userId, {
        experience: profile.experience,
        frequency: profile.frequency,
        goal: profile.goal,
        programId: programId ?? null,
        startDate: programId ? new Date() : undefined,
        customProgram: customProgram,
        onboardingSkipped: false,
      });

      trackEvent(userId, 'onboarding_completed', {
        experience: profile.experience,
        frequency: profile.frequency,
        goal: profile.goal,
        selectedProgramId: programId ?? null,
        completedViaPrompt: true,
      });

      toast({
        title: programId ? 'Program assigned!' : 'Profile updated!',
        description: programId
          ? 'Your personalised program is ready. Great work!'
          : 'Your profile is set. Browse programs anytime from the Programs tab.',
      });

      onComplete();
      onOpenChange(false);
    } catch (err) {
      logger.error('Failed to complete onboarding:', err);
      toast({ title: 'Error', description: 'Could not save your profile. Please try again.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {step === 'profile' && (
          <>
            <DialogHeader>
              <DialogTitle>Tell us about yourself</DialogTitle>
              <DialogDescription>
                3 quick questions — takes under a minute. We'll match you to the perfect program.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-2">
              {/* Experience */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Your training level</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['beginner', 'intermediate', 'advanced'] as Experience[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, experience: v }))}
                      className={cn(
                        'rounded-lg border-2 px-3 py-3 text-sm font-medium transition-all text-center capitalize',
                        profile.experience === v
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      {v === 'beginner' && '🌱 '}
                      {v === 'intermediate' && '💪 '}
                      {v === 'advanced' && '🔥 '}
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Frequency */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Days per week you can train</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['3', '4', '5+'] as Frequency[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, frequency: v }))}
                      className={cn(
                        'rounded-lg border-2 px-3 py-3 text-sm font-medium transition-all text-center',
                        profile.frequency === v
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      {v} days
                    </button>
                  ))}
                </div>
              </div>

              {/* Goal */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Primary goal</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'strength', label: '🏋️ Strength' },
                    { value: 'endurance', label: '🏃 Endurance' },
                    { value: 'hybrid', label: '⚡ Hybrid' },
                  ] as { value: Goal; label: string }[]).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, goal: value }))}
                      className={cn(
                        'rounded-lg border-2 px-3 py-3 text-sm font-medium transition-all text-center',
                        profile.goal === value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={handleProfileNext}>
                See Matched Programs <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === 'program' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <Award className="h-5 w-5 text-primary" />
                <DialogTitle>Your Program Matches</DialogTitle>
              </div>
              <DialogDescription>
                Based on your profile — pick one to start, or skip and explore all programs later.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {recommendations.map((rec, index) => {
                const isTop = index === 0;
                const isSelected = selectedProgramId === rec.program.id;
                return (
                  <div
                    key={rec.program.id}
                    onClick={() => setSelectedProgramId(rec.program.id)}
                    className={cn(
                      'cursor-pointer rounded-lg border-2 p-4 transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : isTop
                        ? 'border-primary/30 hover:border-primary/50'
                        : 'border-border hover:border-primary/30'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold">{rec.program.name}</p>
                      {isTop && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          Best Match
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {rec.matchPercentage}% match · {rec.program.duration} weeks · {rec.program.daysPerWeek} days/week
                    </p>
                    <p className="text-sm mb-3">{rec.program.description}</p>
                    {rec.matchReasons.slice(0, 2).map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs mb-1">
                        <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{r}</span>
                      </div>
                    ))}
                    {isSelected && rec.considerations.length > 0 && (
                      <div className="border-t pt-2 mt-2 space-y-1">
                        {rec.considerations.slice(0, 1).map((c, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <AlertCircle className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">{c}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                      <ProgramPreviewDialog programId={rec.program.id} programName={rec.program.name} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('profile')}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleFinish(undefined)} disabled={isLoading}>
                  Skip for Now
                </Button>
                <Button onClick={() => handleFinish(selectedProgramId)} disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Start Program
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
