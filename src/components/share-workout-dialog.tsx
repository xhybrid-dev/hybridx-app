'use client';
import { logger } from '@/lib/logger';

import { useState, useCallback } from 'react';
import { Share2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { WorkoutSession } from '@/models/types';
import { hasRuns } from '@/lib/type-guards';
import { WorkoutImageGenerator } from '@/components/WorkoutImageGenerator';
import { generateCardSummary } from '@/ai/flows/card-summary';

interface ShareWorkoutDialogProps {
  session: WorkoutSession;
  trigger?: React.ReactNode;
}

export function ShareWorkoutDialog({ session, trigger }: ShareWorkoutDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cardSummary, setCardSummary] = useState<string | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [calories, setCalories] = useState<number | undefined>(undefined);
  const [formattedDuration, setFormattedDuration] = useState<string | undefined>(undefined);
  const { toast } = useToast();

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const handleOpenChange = useCallback(async (open: boolean) => {
    setIsOpen(open);
    if (open && cardSummary === null) {
      const strava = session.stravaActivity;

      // Format duration from moving_time if available
      const durationSeconds = strava?.moving_time;
      const durationMinutes = durationSeconds
        ? Math.round(durationSeconds / 60)
        : session.duration ? parseInt(session.duration, 10) : undefined;

      if (durationSeconds) setFormattedDuration(formatDuration(durationSeconds));
      else if (session.duration) setFormattedDuration(session.duration);

      const distanceKm = strava?.distance ? Math.round((strava.distance / 1000) * 100) / 100 : undefined;
      const paceMinPerKm = distanceKm && durationMinutes
        ? Math.round((durationMinutes / distanceKm) * 10) / 10
        : undefined;

      // Fetch calories from Strava detailed activity in parallel with AI summary
      const [summaryResult, caloriesResult] = await Promise.allSettled([
        generateCardSummary({
          workoutTitle: session.workoutTitle,
          workoutType: (session.workoutDetails ? hasRuns(session.workoutDetails) : session.programType === 'running') ? 'running' : 'hyrox',
          distanceKm,
          durationMinutes,
          paceMinPerKm,
          stravaActivityName: strava?.name,
          userNotes: session.notes,
        }),
        session.stravaId
          ? fetch(`/api/strava/activities/${session.stravaId}`).then(r => r.ok ? r.json() : null)
          : Promise.resolve(null),
      ]);

      if (summaryResult.status === 'fulfilled') {
        setCardSummary(summaryResult.value);
        setSummaryFailed(false);
      } else {
        logger.error('Failed to generate card summary:', summaryResult.reason);
        setCardSummary(session.notes ?? null);
        setSummaryFailed(true);
      }

      if (caloriesResult.status === 'fulfilled' && caloriesResult.value?.calories > 0) {
        setCalories(caloriesResult.value.calories);
      }
    }
  }, [session, cardSummary]);

  const handleCopyText = () => {
    const durationLine = session.duration ? `\nDuration: ${session.duration}` : '';
    const text = `Just crushed a ${session.workoutTitle} workout! 💪${durationLine}\n\nGet your personalized HYROX training at HYBRIDX.CLUB`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copied!',
      description: 'Text copied to clipboard',
    });
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'HYBRIDX Workout',
          text: `Just crushed a ${session.workoutTitle} workout! 💪`,
          url: 'https://hybridx.club',
        });
      } catch (error) {
        logger.error('Error sharing:', error);
      }
    } else {
      handleCopyText();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-16px)] max-w-md p-4">
        <DialogHeader className="px-0">
          <DialogTitle>Share Your Workout</DialogTitle>
          <DialogDescription>
            Download and share your achievement on social media
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {summaryFailed && (
            <p className="text-xs text-muted-foreground text-center">
              AI summary unavailable — using your notes instead.
            </p>
          )}
          {/* Workout Image Generator — preview + download */}
          <WorkoutImageGenerator
            workout={{
              name: session.workoutTitle,
              type: (session.workoutDetails ? hasRuns(session.workoutDetails) : session.programType === 'running') ? 'Running' : 'HYROX',
              startTime: session.workoutDate,
              distance: session.stravaActivity?.distance,
              duration: formattedDuration,
              calories: calories,
              notes: cardSummary ?? undefined,
            }}
          />

          {/* Divider */}
          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground mb-2">Or share via</p>
            <div className="flex gap-2">
              <Button onClick={handleShare} variant="outline" className="flex-1">
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button onClick={handleCopyText} variant="outline" className="flex-1">
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copied!' : 'Copy Text'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
