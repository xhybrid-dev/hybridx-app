// src/app/(app)/journal/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { BookMarked, PenLine } from 'lucide-react';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getAuthInstance } from '@/lib/firebase';
import { getPaginatedJournalEntries } from '@/services/journal-service-client';
import { getUserClient } from '@/services/user-service-client';
import { getProgramClient } from '@/services/program-service-client';
import { getRecentUserSessions } from '@/services/session-service-client';
import { JournalEntryForm } from '@/components/journal-entry-form';
import { JournalEntryCard } from '@/components/journal-entry-card';
import { JournalTrendsCard } from '@/components/journal-trends-card';
import type { JournalEntry } from '@/models/types';

function JournalSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function JournalPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [userData, setUserData] = useState<string>('{}');

  // Build userData JSON for AI context (profile + recent sessions)
  const buildUserData = useCallback(async (uid: string) => {
    try {
      const [user, sessions] = await Promise.all([
        getUserClient(uid),
        // Only the 10 newest are used below, so only 10 are fetched. This
        // previously read the athlete's entire session history to slice it away.
        getRecentUserSessions(uid, 10),
      ]);
      let program = null;
      if (user?.programId) {
        program = await getProgramClient(user.programId);
      }
      setUserData(JSON.stringify({ user, program, allSessions: sessions }));
    } catch {
      // Non-fatal — AI insight will work with less context
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      const auth = await getAuthInstance();
      const unsubscribe = onAuthStateChanged(auth, async user => {
        if (user) {
          setUserId(user.uid);
          try {
            const result = await getPaginatedJournalEntries(user.uid, 20);
            setEntries(result.entries);
            setLastDoc(result.lastDoc);
            setHasMore(result.hasMore);
          } catch (err) {
            console.error('Error fetching journal entries:', err);
          } finally {
            setLoading(false);
          }
          buildUserData(user.uid);
        } else {
          setLoading(false);
        }
      });
      return unsubscribe;
    };

    let unsubscribe: (() => void) | undefined;
    initialize().then(unsub => { unsubscribe = unsub; });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [buildUserData]);

  const handleLoadMore = async () => {
    if (!userId || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getPaginatedJournalEntries(userId, 20, lastDoc);
      setEntries(prev => [...prev, ...result.entries]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Error loading more journal entries:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleNewEntrySuccess = async () => {
    setIsFormOpen(false);
    // Refresh the list
    if (userId) {
      const result = await getPaginatedJournalEntries(userId, 20);
      setEntries(result.entries);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    }
  };

  const handleDeleted = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleUpdated = (updated: JournalEntry) => {
    setEntries(prev => prev.map(e => (e.id === updated.id ? updated : e)));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-headline flex items-center gap-2">
            <BookMarked className="h-6 w-6 text-primary" />
            My Journal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Record your thoughts, feelings, and progress
          </p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="flex-shrink-0 gap-2">
          <PenLine className="h-4 w-4" />
          New Entry
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <JournalSkeleton />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center space-y-4">
          <BookMarked className="h-12 w-12 text-muted-foreground/50" />
          <div className="space-y-1">
            <p className="font-semibold">Start your journal today</p>
            <p className="text-sm text-muted-foreground">
              Write about how you're feeling, your form, challenges, or any wins — big or small.
              Your coach AI will read your entries to give you more personalised guidance.
            </p>
          </div>
          <Button onClick={() => setIsFormOpen(true)} className="gap-2">
            <PenLine className="h-4 w-4" />
            Write your first entry
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Trends intelligence card — shown once athlete has at least 3 entries */}
          {entries.length >= 3 && (
            <JournalTrendsCard entries={entries} userData={userData} />
          )}

          {entries.map(entry => (
            <JournalEntryCard
              key={entry.id}
              entry={entry}
              userId={userId!}
              userData={userData}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
            />
          ))}
          {hasMore && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more entries'}
            </Button>
          )}
        </div>
      )}

      {/* New entry dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
          </DialogHeader>
          {userId && (
            <JournalEntryForm
              userId={userId}
              onSuccess={handleNewEntrySuccess}
              onCancel={() => setIsFormOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
