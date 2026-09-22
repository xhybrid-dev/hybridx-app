// src/components/trial-banner.tsx
'use client';

import Link from 'next/link';
import { Star, AlertTriangle } from 'lucide-react';
import { useUserProfile } from '@/contexts/user-context';
import { getTrialDaysLeft } from '@/lib/trial';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Persistent trial-countdown banner shown on the dashboard.
 *
 * Trial users currently only see their remaining days if they navigate to the
 * subscription page — which they have no reason to do. Surfacing the countdown
 * (with rising urgency in the final stretch) on the dashboard is the highest-ROI
 * nudge for trial→paid conversion.
 */
export function TrialBanner({ when }: { when?: 'urgent' | 'calm' } = {}) {
  const { user, loading } = useUserProfile();

  if (loading || !user) return null;
  // Only relevant while actually on a trial.
  if ((user.subscriptionStatus || 'trial') !== 'trial') return null;

  const daysLeft = getTrialDaysLeft(user.trialStartDate);
  const urgent = daysLeft <= 3;
  // The dashboard shows it above today's workout only in the last few days.
  if (when === 'urgent' && !urgent) return null;
  if (when === 'calm' && urgent) return null;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
        urgent
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="flex items-start gap-3">
        {urgent ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        ) : (
          <Star className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
        )}
        <div>
          <p className="font-semibold">
            {daysLeft > 0
              ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in your free trial`
              : 'Your free trial has ended'}
          </p>
          <p className="text-sm text-muted-foreground">
            Keep your AI-tailored plans, race planner and progress tracking — just £5/month.
          </p>
        </div>
      </div>
      <Button asChild variant={urgent ? 'destructive' : 'accent'} className="shrink-0">
        <Link href="/subscription">
          {daysLeft > 0 ? 'Subscribe & keep access' : 'Subscribe now'}
        </Link>
      </Button>
    </div>
  );
}
