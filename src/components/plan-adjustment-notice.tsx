'use client';
//
// Tells the athlete when the nightly coach changed today's session, and lets
// them put it back. The job used to write these rows with nothing reading
// them, so plans changed silently.

import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';

import { db } from '@/lib/firebase';
import { logger } from '@/lib/logger';
import { getUserClient, updateUser } from '@/services/user-service-client';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { WorkoutDay } from '@/models/types';
import type { WorkoutSession } from '@/services/session-service-client';

interface AdjustmentNotice {
  id: string;
  title: string;
  body: string;
  target?: 'session' | 'program';
  sessionId?: string | null;
  day?: number;
  original?: WorkoutDay;
  modified?: WorkoutDay;
}

export function PlanAdjustmentNotice({
  userId,
  todaysSessions,
  onChanged,
}: {
  userId: string;
  /** Today's persisted sessions — opening the dashboard copies the adjusted workout into one. */
  todaysSessions: WorkoutSession[];
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [notice, setNotice] = useState<AdjustmentNotice | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Equality filters only, so no composite index is needed.
    getDocs(query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false),
      limit(10),
    ))
      .then(snapshot => {
        if (cancelled) return;
        const latest = snapshot.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<AdjustmentNotice, 'id'> & { type?: string; createdAt?: { toMillis(): number } }) }))
          // Only today's news: an adjustment from last week is not actionable.
          .filter(n => n.type === 'ai-adjustment' && (n.createdAt?.toMillis() ?? 0) > Date.now() - 36 * 3_600_000)[0];
        setNotice(latest ?? null);
      })
      .catch(error => logger.error('Failed to load plan adjustments:', error));
    return () => { cancelled = true; };
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
    setNotice(null);
  }, []);

  const handleUndo = async () => {
    if (!notice?.original) return;
    setBusy(true);
    try {
      const restoreSession = (id: string) =>
        updateDoc(doc(db, 'workoutSessions', id), {
          workoutDetails: notice.original,
          workoutTitle: notice.original!.title,
        });

      if (notice.target === 'session' && notice.sessionId) {
        await restoreSession(notice.sessionId);
      } else {
        const user = await getUserClient(userId);
        const program = (user?.customProgram ?? []) as WorkoutDay[];
        const index = program.findIndex(w => w.day === notice.day && w.title === notice.modified?.title);
        if (index !== -1) {
          const restored = [...program];
          restored[index] = notice.original;
          await updateUser(userId, { customProgram: restored });
        }
        const copied = todaysSessions.find(
          s => !s.finishedAt && s.workoutDetails?.title === notice.modified?.title,
        );
        if (copied) await restoreSession(copied.id);
      }
      await markRead(notice.id);
      await onChanged();
      toast({ title: 'Original session restored', description: `${notice.original.title} is back on today's plan.` });
    } catch (error) {
      logger.error('Failed to undo plan adjustment:', error);
      toast({ title: 'Could not restore the session', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!notice) return null;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" />
          {notice.title}
        </CardTitle>
        <CardDescription>{notice.body}</CardDescription>
      </CardHeader>
      <CardFooter className="gap-2 pt-0">
        <Button size="sm" onClick={() => markRead(notice.id).catch(err => logger.error(err))} disabled={busy}>
          Sounds good
        </Button>
        {notice.original && (
          <Button size="sm" variant="ghost" onClick={handleUndo} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
            Keep the original
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
