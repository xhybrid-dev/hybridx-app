// src/app/(app)/journal/[id]/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Brain, Sparkles, Loader2, Pencil, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { getAuthInstance } from '@/lib/firebase';
import { authedFetch } from '@/lib/client-auth';
import { getJournalEntry, updateJournalEntry } from '@/services/journal-service-client';
import { getUserClient } from '@/services/user-service-client';
import { getProgramClient } from '@/services/program-service-client';
import { getAllUserSessions } from '@/services/session-service-client';
import { journalInsight } from '@/ai/flows/journal-insight';
import { JournalEntryForm } from '@/components/journal-entry-form';
import { CoachMarkdown } from '@/components/coach-markdown';
import type { JournalEntry, MoodLevel } from '@/models/types';

const MOOD_COLOURS: Record<MoodLevel, string> = {
  great:      'bg-green-500 text-white',
  good:       'bg-emerald-400 text-white',
  okay:       'bg-yellow-400 text-white',
  tired:      'bg-orange-400 text-white',
  struggling: 'bg-red-500 text-white',
};

const MOOD_LABELS: Record<MoodLevel, string> = {
  great:      'Great',
  good:       'Good',
  okay:       'Okay',
  tired:      'Tired',
  struggling: 'Struggling',
};

function AISectionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/6" />
    </div>
  );
}

export default function JournalEntryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const entryId = params.id as string;

  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userData, setUserData] = useState<string>('{}');
  const [loading, setLoading] = useState(true);
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const buildUserData = useCallback(async (uid: string) => {
    try {
      const [user, sessions] = await Promise.all([
        getUserClient(uid),
        getAllUserSessions(uid),
      ]);
      let program = null;
      if (user?.programId) {
        program = await getProgramClient(user.programId);
      }
      setUserData(JSON.stringify({ user, program, allSessions: sessions.slice(0, 10) }));
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      const auth = await getAuthInstance();
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          setUserId(user.uid);
          try {
            const fetched = await getJournalEntry(entryId);
            if (!fetched || fetched.userId !== user.uid) {
              router.push('/journal');
              return;
            }
            setEntry(fetched);
          } catch (err) {
            console.error('Error fetching journal entry:', err);
            toast({ title: 'Error', description: 'Could not load this entry.', variant: 'destructive' });
            router.push('/journal');
          } finally {
            setLoading(false);
          }
          buildUserData(user.uid);
        } else {
          router.push('/login');
        }
      });
      return unsubscribe;
    };

    let unsubscribe: (() => void) | undefined;
    initialize().then(unsub => { unsubscribe = unsub; });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [entryId, router, toast, buildUserData]);

  const handleGenerateAnalysis = async () => {
    if (!entry) return;
    setGeneratingAnalysis(true);
    try {
      // The same memory the chat has, so the journal response doesn't ask about
      // a quiet fortnight the athlete already explained to the coach.
      let coachNotes: string | undefined;
      try {
        const notesResponse = await authedFetch('/api/ai/coach-notes');
        if (notesResponse.ok) {
          coachNotes = (await notesResponse.json()).promptText ?? undefined;
        }
      } catch {
        // Memory is an enhancement here — never a reason to withhold the response.
      }

      const result = await journalInsight({
        journalContent: entry.content,
        mood: entry.mood,
        tags: entry.tags,
        entryDate: format(entry.date, 'yyyy-MM-dd'),
        userData,
        coachNotes,
      });
      const now = new Date();
      await updateJournalEntry(entry.id, {
        aiInterpretation: result.interpretation,
        aiCoachResponse: result.coachResponse,
        aiInsight: result.insight,
        aiAnalysisGeneratedAt: now,
        aiInsightGeneratedAt: now,
      });
      setEntry(prev => prev ? {
        ...prev,
        aiInterpretation: result.interpretation,
        aiCoachResponse: result.coachResponse,
        aiInsight: result.insight,
        aiAnalysisGeneratedAt: now,
        updatedAt: now,
      } : prev);
      toast({ title: 'Analysis ready', description: 'Your coach has responded.' });

      // Let the coach carry anything standing in this entry — a holiday, a
      // niggle, a rough patch at work — into the rest of the app, so the
      // athlete doesn't have to repeat it in the chat.
      authedFetch('/api/ai/coach-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entry.content, source: 'journal' }),
      }).catch(() => {
        // Best-effort: the analysis they asked for has already landed.
      });
    } catch (err) {
      console.error('Error generating analysis:', err);
      toast({ title: 'Error', description: 'Failed to generate analysis. Please try again.', variant: 'destructive' });
    } finally {
      setGeneratingAnalysis(false);
    }
  };

  const handleEditSuccess = async () => {
    setIsEditOpen(false);
    // Re-fetch the entry to show updated content
    if (entry) {
      const updated = await getJournalEntry(entry.id);
      if (updated) setEntry(updated);
    }
    toast({ title: 'Entry updated' });
  };

  // Determine what AI content to show
  const hasNewAnalysis = Boolean(entry?.aiInterpretation && entry?.aiCoachResponse);
  const hasLegacyInsight = Boolean(entry?.aiInsight && !hasNewAnalysis);
  const hasAnyAnalysis = hasNewAnalysis || hasLegacyInsight;

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
    );
  }

  if (!entry) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      {/* Navigation bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/journal"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          My Journal
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setIsEditOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit Entry
        </Button>
      </div>

      {/* Entry header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold font-headline">
          {format(entry.date, 'EEEE, d MMMM yyyy')}
        </h1>
        <div className="flex flex-wrap gap-2">
          {entry.mood && (
            <Badge className={cn('text-sm px-3 py-0.5', MOOD_COLOURS[entry.mood])}>
              {MOOD_LABELS[entry.mood]}
            </Badge>
          )}
          {entry.tags?.map(tag => (
            <Badge key={tag} variant="outline" className="text-sm capitalize px-3 py-0.5">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Section 1: Your Entry */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <BookOpen className="h-4 w-4" />
          Your Entry
        </div>
        <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground">
          {entry.content}
        </p>
      </div>

      {/* Section 2: What Your Coach Hears */}
      <div className={cn(
        'rounded-xl border p-6 space-y-3',
        'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-800/40'
      )}>
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
          <Brain className="h-4 w-4" />
          What Your Coach Hears
        </div>
        {generatingAnalysis ? (
          <AISectionSkeleton />
        ) : hasNewAnalysis ? (
          <CoachMarkdown
            content={entry.aiInterpretation ?? ''}
            className="text-base text-foreground/90"
          />
        ) : hasLegacyInsight ? (
          <p className="text-sm text-muted-foreground italic">
            Generate a new analysis to see this section.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Generate a coaching analysis to unlock this section.
          </p>
        )}
      </div>

      {/* Section 3: Coach's Advice */}
      <div className="rounded-xl border bg-primary/5 border-primary/20 p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary uppercase tracking-wide">
          <Sparkles className="h-4 w-4" />
          Coach's Advice
        </div>
        {generatingAnalysis ? (
          <AISectionSkeleton />
        ) : hasNewAnalysis ? (
          <CoachMarkdown
            content={entry.aiCoachResponse ?? ''}
            className="text-base text-foreground/90"
          />
        ) : hasLegacyInsight ? (
          <CoachMarkdown content={entry.aiInsight ?? ''} className="text-base text-foreground/90" />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Your coach hasn't responded to this entry yet.
          </p>
        )}
      </div>

      {/* Generate / Refresh analysis button */}
      <Button
        onClick={handleGenerateAnalysis}
        disabled={generatingAnalysis}
        variant={hasAnyAnalysis ? 'outline' : 'default'}
        className="w-full gap-2"
      >
        {generatingAnalysis ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {generatingAnalysis
          ? 'Generating analysis…'
          : hasAnyAnalysis
          ? 'Refresh Coaching Analysis'
          : 'Generate Coaching Analysis'}
      </Button>

      {/* Edit dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Journal Entry</DialogTitle>
          </DialogHeader>
          {userId && entry && (
            <JournalEntryForm
              userId={userId}
              entry={entry}
              onSuccess={handleEditSuccess}
              onCancel={() => setIsEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
