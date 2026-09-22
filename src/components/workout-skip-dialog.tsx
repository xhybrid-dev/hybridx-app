'use client';
//
// Skipping used to open the same "Workout Complete! 🎉" modal as finishing.
// This asks why instead: the answer goes to the coach, and an illness or
// injury gets pointed at the coach rather than at a share button.

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { SkipReason } from '@/models/types';

const REASONS: { value: SkipReason; label: string }[] = [
  { value: 'time', label: 'No time today' },
  { value: 'tired', label: 'Too tired / sore' },
  { value: 'ill', label: 'Feeling ill' },
  { value: 'injured', label: 'Niggle or injury' },
  { value: 'other', label: 'Something else' },
];

const FOLLOW_UP: Record<SkipReason, string> = {
  time: "No problem — one missed session doesn't undo your training. If this week is busy, your coach can reshuffle it.",
  tired: 'Listening to your body is part of the plan. If it keeps happening, your coach can ease the load.',
  ill: 'Rest up. Tell your coach how long you expect to be off and it will adjust what comes next.',
  injured: "Don't train through it. Tell your coach what hurts and it will work around it.",
  other: 'Noted. Your next session is on the dashboard when you are ready.',
};

export function WorkoutSkipDialog({
  open,
  onOpenChange,
  workoutTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutTitle: string;
  onConfirm: (reason: SkipReason) => Promise<void>;
}) {
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState<SkipReason | null>(null);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setConfirmed(null);
    }
  };

  const confirm = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      await onConfirm(reason);
      setConfirmed(reason);
    } finally {
      setSaving(false);
    }
  };

  const coachQuestion = confirmed
    ? `I skipped ${workoutTitle} today — ${REASONS.find(r => r.value === confirmed)?.label.toLowerCase()}. What should I do with the rest of my week?`
    : '';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {confirmed ? (
          <>
            <DialogHeader>
              <DialogTitle>Session skipped</DialogTitle>
              <DialogDescription>{FOLLOW_UP[confirmed]}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button asChild variant={confirmed === 'ill' || confirmed === 'injured' ? 'default' : 'outline'}>
                <Link href={`/assistant?q=${encodeURIComponent(coachQuestion)}`}>
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Tell your coach
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/dashboard">Back to dashboard</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Skip {workoutTitle}?</DialogTitle>
              <DialogDescription>What&apos;s getting in the way? Your coach uses this to adjust your plan.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2" role="radiogroup" aria-label="Reason for skipping">
              {REASONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === option.value}
                  onClick={() => setReason(option.value)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    reason === option.value ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="ghost" onClick={() => close(false)}>Keep the session</Button>
              <Button onClick={confirm} disabled={!reason || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Skip it
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
