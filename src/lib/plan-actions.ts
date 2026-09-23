'use client';
// src/lib/plan-actions.ts
//
// Moving an athlete's plan in time: catching up after time away, pausing and
// resuming. Every one of these changes the start date, and every start-date
// change has to clear the per-day session docs from today on — they are keyed
// by date and would otherwise keep showing the old schedule.

import { updateUser } from '@/services/user-service-client';
import { clearFutureProgramSessions } from '@/services/session-service';
import { logger } from '@/lib/logger';
import type { User } from '@/models/types';

export async function moveProgramStart(user: User, startDate: Date, extra: Partial<User> = {}): Promise<void> {
  await updateUser(user.id, { startDate, ...extra });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  try {
    await clearFutureProgramSessions({ fromDate: today });
  } catch (error) {
    logger.error('Failed to clear stale program sessions after moving the plan:', error);
  }

  if (user.garminConnectedAt) {
    // Re-push the watch schedule so it matches the new dates.
    fetch('/api/garmin/sync-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true })
      .catch(() => {});
  }
}
