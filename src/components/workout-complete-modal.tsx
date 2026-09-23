// src/components/workout-complete-modal.tsx
'use client';
//
// The moment after a session: record how hard it felt, show where the week
// stands, and say what's next — then offer sharing. It used to be sharing
// only, with a duration box that was never saved.

import { useEffect, useState } from 'react';
import { differenceInMinutes, format } from 'date-fns';
import { Bell, CalendarClock, CheckCircle2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useDebouncedCallback } from 'use-debounce';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { StravaUploadButton } from '@/components/strava-upload-button';
import { ShareWorkoutDialog } from '@/components/share-workout-dialog';
import { updateWorkoutSession } from '@/services/session-service-client';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { subscribeUserToPush } from '@/lib/push-subscribe';
import { enableNativePush } from '@/lib/native-push';
import type { WorkoutSession } from '@/models/types';

interface WorkoutCompleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: WorkoutSession;
  userHasStrava?: boolean;
  weekProgress?: { done: number; target: number };
  nextSession?: { title: string; date: Date } | null;
}

const RPE_LABELS: Record<number, string> = {
  1: 'Very easy', 3: 'Easy', 5: 'Moderate', 7: 'Hard', 9: 'Very hard', 10: 'Max effort',
};

/** A believable duration from the session's own timestamps, or ''. */
function initialDuration(session: WorkoutSession): string {
  if (session.stravaActivity?.moving_time) return `${Math.round(session.stravaActivity.moving_time / 60)} mins`;
  if (session.duration) return session.duration;
  if (session.startedInApp && session.finishedAt) {
    const minutes = differenceInMinutes(session.finishedAt, session.startedAt);
    if (minutes >= 5 && minutes <= 300) return `${minutes} mins`;
  }
  return '';
}

export default function WorkoutCompleteModal({
  isOpen,
  onClose,
  session,
  userHasStrava,
  weekProgress,
  nextSession,
}: WorkoutCompleteModalProps) {
  const [duration, setDuration] = useState('');
  const [rpe, setRpe] = useState<number | undefined>(session.rpe);
  // Asked here, after a session, rather than at signup before any value.
  const [reminder, setReminder] = useState<'hidden' | 'offer' | 'enabling' | 'on'>('hidden');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const undecided = Capacitor.isNativePlatform()
          ? (await PushNotifications.checkPermissions()).receive === 'prompt'
          : typeof Notification !== 'undefined' && 'serviceWorker' in navigator && Notification.permission === 'default';
        if (!cancelled && undecided) setReminder('offer');
      } catch {
        /* no push available here */
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const enableReminders = async () => {
    setReminder('enabling');
    const ok = Capacitor.isNativePlatform() ? await enableNativePush() : await subscribeUserToPush();
    setReminder(ok ? 'on' : 'hidden');
  };

  useEffect(() => {
    if (isOpen) {
      const value = initialDuration(session);
      setDuration(value);
      setRpe(session.rpe);
      // Save the derived duration so history and sharing have it too.
      if (value && !session.duration) {
        updateWorkoutSession(session.id, { duration: value }).catch(err => logger.error('Saving duration failed:', err));
      }
    }
  }, [isOpen, session]);

  const saveDuration = useDebouncedCallback((value: string) => {
    updateWorkoutSession(session.id, { duration: value.trim() }).catch(err => logger.error('Saving duration failed:', err));
  }, 800);

  const chooseRpe = (value: number) => {
    setRpe(value);
    updateWorkoutSession(session.id, { rpe: value }).catch(err => logger.error('Saving RPE failed:', err));
  };

  const showDurationInput = !session.stravaActivity?.moving_time;
  const sessionWithEdits = { ...session, duration: duration || session.duration, rpe };

  return (
    <Dialog open={isOpen} onOpenChange={() => { saveDuration.flush(); onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Session done 🎉</DialogTitle>
          <DialogDescription>{session.workoutTitle} is logged.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {weekProgress && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              <div className="text-sm">
                <p className="font-semibold">
                  {weekProgress.done} of {weekProgress.target} this week
                </p>
                <p className="text-muted-foreground">
                  {weekProgress.done >= weekProgress.target
                    ? 'Week hit — that keeps your streak going.'
                    : `${weekProgress.target - weekProgress.done} more to hit this week.`}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>How hard did that feel?</Label>
            <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Session effort, 1 to 10">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rpe === value}
                  aria-label={`${value}${RPE_LABELS[value] ? ` — ${RPE_LABELS[value]}` : ''}`}
                  onClick={() => chooseRpe(value)}
                  className={cn(
                    'h-9 rounded-md border text-sm font-medium tabular-nums transition-colors',
                    rpe === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground h-4">
              {rpe ? RPE_LABELS[rpe] ?? RPE_LABELS[rpe - 1] : 'Your coach uses this to judge the load.'}
            </p>
          </div>

          {showDurationInput && (
            <div className="space-y-2">
              <Label htmlFor="duration-input">Duration</Label>
              <Input
                id="duration-input"
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                  saveDuration(e.target.value);
                }}
                placeholder="e.g. 45 mins"
              />
            </div>
          )}

          {nextSession && (
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="text-sm">
                <p className="text-muted-foreground">Next up · {format(nextSession.date, 'EEEE')}</p>
                <p className="font-semibold">{nextSession.title}</p>
              </div>
            </div>
          )}

          {reminder !== 'hidden' && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-primary/5 p-3 text-sm">
              <span className="flex items-center gap-2">
                <Bell className="h-4 w-4 shrink-0 text-primary" />
                {reminder === 'on'
                  ? "Done — we'll remind you before your next session."
                  : nextSession
                    ? `Want a nudge before ${format(nextSession.date, 'EEEE')}'s session?`
                    : 'Want a nudge before your next session?'}
              </span>
              {reminder !== 'on' && (
                <Button size="sm" onClick={enableReminders} disabled={reminder === 'enabling'}>
                  Remind me
                </Button>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            {userHasStrava && (
              <StravaUploadButton
                sessionId={session.id}
                activityName={session.workoutTitle}
                isUploaded={session.uploadedToStrava}
                stravaId={session.stravaId}
                disabled={session.skipped}
              />
            )}
            <ShareWorkoutDialog
              session={sessionWithEdits}
              trigger={
                <Button variant="outline" className="w-full">
                  Share workout image
                </Button>
              }
            />
          </div>

          <Button onClick={() => { saveDuration.flush(); onClose(); }} className="w-full">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
