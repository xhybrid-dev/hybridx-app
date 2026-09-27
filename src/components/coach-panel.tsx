'use client';
//
// The coach, where the athlete already is.
//
// Talk to Coach is where you go to have a conversation; this is the coach being
// present on the dashboard — saying its piece, showing what it is holding on to
// about you, and taking a typed line or a voice note without you going
// anywhere. Either goes into the same thread as Talk to Coach, so the two are
// one conversation, not two.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';

import { authedFetch } from '@/lib/client-auth';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CoachComposer, type CoachMessageKind } from './coach-composer';
import { CoachMarkdown } from './coach-markdown';
import { Logo } from './icons';

export interface CoachNote {
  id: string;
  category: string;
  content: string;
  expiresAt: string | null;
  pausesTraining?: boolean;
}

interface CoachNotesState {
  notes: CoachNote[];
  /** The same rendering the coach's own prompts use; pass straight to a flow. */
  promptText: string | null;
  loaded: boolean;
  dismiss: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * What the coach remembers about this athlete.
 *
 * `loaded` flips true even on failure: callers gate their AI calls on it, and a
 * coach that never speaks because its memory was unreachable is worse than one
 * that speaks without it.
 */
export function useCoachNotes(enabled: boolean): CoachNotesState {
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await authedFetch('/api/ai/coach-notes');
      if (!response.ok) throw new Error('Failed to load coach notes');
      const data = await response.json();
      setNotes(data.notes ?? []);
      setPromptText(data.promptText ?? null);
    } catch (error) {
      logger.error('Error loading coach notes:', error);
    } finally {
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoaded(true);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const dismiss = useCallback(async (id: string) => {
    setNotes(current => current.filter(note => note.id !== id));
    try {
      await authedFetch(`/api/ai/coach-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      logger.error('Error dismissing coach note:', error);
    }
  }, []);

  return { notes, promptText, loaded, dismiss, refresh };
}

const CATEGORY_LABELS: Record<string, string> = {
  availability: 'Away',
  constraint: 'Watching',
  goal: 'Goal',
  preference: 'Noted',
  context: 'Noted',
  commitment: 'You said',
};

/** The short label a remembered note is shown under. */
export function noteLabel(note: { category: string; pausesTraining?: boolean }): string {
  if (note.pausesTraining) return 'Time off';
  return CATEGORY_LABELS[note.category] ?? 'Noted';
}

export function CoachPanel({
  summary,
  summaryLoading,
  notes,
  onDismissNote,
  onNotesMayHaveChanged,
  className,
}: {
  summary: string;
  summaryLoading: boolean;
  notes: CoachNote[];
  onDismissNote: (id: string) => void;
  onNotesMayHaveChanged?: () => void;
  className?: string;
}) {
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const send = async (message: string, kind: CoachMessageKind) => {
    if (!message.trim() || sending) return;

    setSending(true);
    setError(null);
    setReply(null);
    try {
      const response = await authedFetch('/api/ai/coach-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, kind }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          [data.error || 'The coach could not answer that.', data.detail && `(${data.detail})`]
            .filter(Boolean)
            .join(' '),
        );
      }

      setReply(data.answer);

      // What the coach remembers is updated after the reply is sent, so give
      // that a moment before asking for the notes again — the chip for "away
      // next week" should appear right after you say it.
      if (onNotesMayHaveChanged) setTimeout(onNotesMayHaveChanged, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-primary text-primary-foreground">
          <Logo className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          {summaryLoading ? (
            <Skeleton className="h-5 w-2/3" />
          ) : (
            <div className="text-sm text-foreground/90">
              <CoachMarkdown content={summary} variant="inline" />
            </div>
          )}

          {notes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {notes.slice(0, expanded ? notes.length : 3).map(note => (
                <span
                  key={note.id}
                  className="group inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <span className="truncate">
                    <span className="font-medium">{noteLabel(note)}:</span>{' '}
                    {note.content}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDismissNote(note.id)}
                    aria-label={`Forget: ${note.content}`}
                    className="opacity-40 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {notes.length > 3 && !expanded && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="rounded-full px-2 py-0.5 text-xs text-muted-foreground underline underline-offset-2"
                >
                  +{notes.length - 3} more
                </button>
              )}
            </div>
          )}

          {reply && (
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              <CoachMarkdown content={reply} variant="compact" />
              <Link
                href="/coach"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Carry on in Talk to Coach
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <div className="mt-3">
            <CoachComposer
              variant="compact"
              onSend={send}
              onError={setError}
              disabled={sending}
              placeholder={sending ? 'Your coach is replying…' : 'Tell your coach something — or tap the mic'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
