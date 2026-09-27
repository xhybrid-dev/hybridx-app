'use client';
//
// Talk to Coach.
//
// One place for everything the athlete wants their coach to know or to answer:
// a proper conversation about the plan, a two-line "ill this week, taking it
// off", or a voice note on the walk home about how the session went. It
// replaces both the old Edge Coach chat and the journal — the journal was where
// athletes wrote things the coach should have been told, and now they tell it.
//
// Whatever they say is read for what's worth remembering (see
// extract-coach-notes.ts). What the coach is holding on to sits at the top of
// the page, so the athlete can see it and take anything back with one tap.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import {
  CalendarDays,
  CheckCircle2,
  Flame,
  Loader2,
  Mic,
  Search,
  Target,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';

import { getAuthInstance } from '@/lib/firebase';
import { authedFetch } from '@/lib/client-auth';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { CoachComposer, type CoachMessageKind } from './coach-composer';
import { CoachMarkdown } from './coach-markdown';
import { noteLabel } from './coach-panel';
import { Logo } from './icons';

interface PlanAdjustment {
  day: number;
  originalTitle: string;
  modifiedTitle: string;
  reason: string;
  modifiedWorkout: unknown;
}

interface PlanProposal {
  analysis: string;
  adjustments: PlanAdjustment[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  kind?: CoachMessageKind;
  about?: string;
  consulted?: string[];
  planProposal?: PlanProposal | null;
}

interface SnapshotNote {
  id: string;
  category: string;
  content: string;
  pausesTraining?: boolean;
}

interface CoachSnapshot {
  athleteFirstName: string;
  programName: string | null;
  programWeek: number | null;
  programDay: number | null;
  programLength: number | null;
  todaysSessions: string[];
  completionRate: number;
  activeWeeks: number;
  daysSinceLastSession: number | null;
  fatigueLabel: string | null;
  raceName: string | null;
  daysToRace: number | null;
  hasStrava: boolean;
  hasProgram: boolean;
  notes: SnapshotNote[];
  suggestedPrompts: string[];
}

const FALLBACK_PROMPTS = [
  "How's my training going?",
  'What should I focus on this week?',
  'How do I get faster at the sled push?',
];

/**
 * Quick ways into the things athletes most often need their coach to know.
 * They start the sentence rather than send it — the detail is the useful part.
 */
const QUICK_STARTERS: Array<{ label: string; draft: string }> = [
  { label: '🤒 Feeling ill', draft: "I'm feeling ill — " },
  { label: '✈️ Away / busy', draft: "Heads up, I'm away " },
  { label: '👨‍👩‍👧 Family time', draft: "I need to put family first " },
  { label: '🦵 Niggle', draft: 'My ' },
  { label: '💪 Session went well', draft: 'Today felt good — ' },
  { label: '😮‍💨 Session was tough', draft: 'That session was tough — ' },
];

/** The strip above the thread: where this athlete actually is, right now. */
function SnapshotBar({ snapshot }: { snapshot: CoachSnapshot }) {
  const chips: Array<{ icon: typeof Target; label: string }> = [];

  if (snapshot.programName) {
    const position =
      snapshot.programWeek && snapshot.programDay
        ? ` · week ${snapshot.programWeek}, day ${snapshot.programDay}`
        : '';
    chips.push({ icon: Target, label: `${snapshot.programName}${position}` });
  }
  if (snapshot.todaysSessions.length > 0) {
    chips.push({ icon: CalendarDays, label: `Today: ${snapshot.todaysSessions.join(' + ')}` });
  }
  if (snapshot.completionRate > 0) {
    chips.push({ icon: CheckCircle2, label: `${snapshot.completionRate}% of plan done (4wk)` });
  }
  if (snapshot.fatigueLabel) {
    chips.push({ icon: Flame, label: snapshot.fatigueLabel });
  }
  if (snapshot.daysToRace !== null && snapshot.daysToRace >= 0) {
    chips.push({
      icon: Target,
      label: `${snapshot.raceName ?? 'Race'} in ${snapshot.daysToRace}d`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(chip => (
        <Badge key={chip.label} variant="secondary" className="gap-1 font-normal">
          <chip.icon className="h-3 w-3" />
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}

/**
 * What the coach is holding on to from what the athlete has said. Visible so it
 * can be trusted, and dismissable so a plan that changed takes one tap to fix.
 */
function RememberedStrip({
  notes,
  onDismiss,
}: {
  notes: SnapshotNote[];
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (notes.length === 0) return null;

  // Time off first: it's the one that changes what the coach does.
  const ordered = [...notes].sort(
    (a, b) => Number(!!b.pausesTraining) - Number(!!a.pausesTraining),
  );
  const shown = expanded ? ordered : ordered.slice(0, 4);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Your coach is keeping in mind</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map(note => (
          <span
            key={note.id}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              note.pausesTraining
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <span className="truncate">
              <span className="font-medium">{noteLabel(note)}:</span> {note.content}
            </span>
            <button
              type="button"
              onClick={() => onDismiss(note.id)}
              aria-label={`Forget: ${note.content}`}
              className="opacity-50 transition-opacity hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {ordered.length > shown.length && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-full px-2 py-0.5 text-xs text-muted-foreground underline underline-offset-2"
          >
            +{ordered.length - shown.length} more
          </button>
        )}
      </div>
    </div>
  );
}

function PlanProposalCard({
  proposal,
  onApplied,
}: {
  proposal: PlanProposal;
  onApplied: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const { toast } = useToast();

  const apply = async () => {
    setApplying(true);
    try {
      const response = await authedFetch('/api/ai/apply-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustments: proposal.adjustments }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update your plan.');
      }
      setApplied(true);
      onApplied();
      toast({
        title: 'Plan updated',
        description: `${proposal.adjustments.length} session(s) changed. Your calendar now shows the new plan.`,
      });
    } catch (error) {
      toast({
        title: 'Could not update your plan',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-background/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Proposed change to your plan
      </p>
      <ul className="mt-2 space-y-2">
        {proposal.adjustments.map(adjustment => (
          <li key={`${adjustment.day}-${adjustment.modifiedTitle}`} className="text-sm">
            <span className="font-medium">Day {adjustment.day}:</span> {adjustment.originalTitle} →{' '}
            <span className="font-medium">{adjustment.modifiedTitle}</span>
            <span className="block text-xs text-muted-foreground">{adjustment.reason}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={apply} disabled={applying || applied}>
          {applying && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {applied ? 'Applied to your plan' : 'Apply to my plan'}
        </Button>
        {!applied && (
          <span className="text-xs text-muted-foreground">Nothing changes until you accept.</span>
        )}
      </div>
    </div>
  );
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE d MMMM');
}

function CoachAvatar() {
  return (
    <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center border bg-primary text-primary-foreground">
      <Logo className="h-6 w-6" />
    </Avatar>
  );
}

export function TalkToCoach({
  seedMessage,
  initialAbout,
  initialDraft,
}: {
  /** Asked straight away once the thread loads (?q=). */
  seedMessage?: string;
  /** The session the athlete came from (?about=). */
  initialAbout?: string;
  /** Text to start the composer with (?draft=). */
  initialDraft?: string;
} = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [about, setAbout] = useState<string | null>(initialAbout ?? null);
  const [isSending, setIsSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadingThread, setLoadingThread] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CoachSnapshot | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    getAuthInstance().then(auth => {
      unsubscribe = onAuthStateChanged(auth, user => {
        setCurrentUser(user);
        setAuthChecked(true);
      });
    });
    return () => unsubscribe?.();
  }, []);

  // Pull the athlete's thread and their current training snapshot, so the
  // conversation resumes where it left off instead of starting cold.
  useEffect(() => {
    if (!authChecked) return;
    if (!currentUser) {
      setLoadingThread(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingThread(true);
      try {
        const response = await authedFetch('/api/ai/coach-chat');
        if (!response.ok) throw new Error('Failed to load coach');
        const data = await response.json();
        if (cancelled) return;

        setSnapshot(data.snapshot ?? null);
        if (data.conversation) {
          setConversationId(data.conversation.id);
          setMessages(
            data.conversation.messages.map((message: any, index: number) => ({
              id: `${data.conversation.id}-${index}`,
              role: message.role,
              content: message.content,
              createdAt: message.createdAt,
              kind: message.kind,
              about: message.about,
              consulted: message.consulted,
            })),
          );
        }
      } catch (error) {
        if (!cancelled) logger.error('Error loading coach conversation:', error);
      } finally {
        if (!cancelled) setLoadingThread(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authChecked, currentUser]);

  // Scrolled via a sentinel rather than the ScrollArea ref: Radix puts that ref
  // on the (overflow-hidden) root, not the viewport that actually scrolls, so
  // calling scrollTo on it does nothing.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending, transcribing]);

  const refreshSnapshot = useCallback(async () => {
    try {
      const response = await authedFetch('/api/ai/coach-chat');
      if (!response.ok) return;
      const data = await response.json();
      if (data.snapshot) setSnapshot(data.snapshot);
    } catch (error) {
      logger.error('Error refreshing coach snapshot:', error);
    }
  }, []);

  // What the coach remembers is written after the reply goes out, so the
  // "Time off" chip for "ill this week" shows up a moment after the answer.
  const refreshRemembered = useCallback(async () => {
    try {
      const response = await authedFetch('/api/ai/coach-notes');
      if (!response.ok) return;
      const data = await response.json();
      setSnapshot(current => (current ? { ...current, notes: data.notes ?? [] } : current));
    } catch (error) {
      logger.error('Error refreshing coach notes:', error);
    }
  }, []);

  const dismissNote = useCallback(async (id: string) => {
    setSnapshot(current =>
      current ? { ...current, notes: current.notes.filter(note => note.id !== id) } : current,
    );
    try {
      await authedFetch(`/api/ai/coach-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      logger.error('Error dismissing coach note:', error);
    }
  }, []);

  const greeting = useMemo(() => {
    if (!snapshot) {
      return "I'm your coach. Tell me how it's going — type it or send a voice note — or ask me anything about your training.";
    }
    const name = snapshot.athleteFirstName;
    if (snapshot.notes.some(note => note.pausesTraining)) {
      return `Hi ${name} — I know you're taking some time off. No pressure from me; just let me know when you're ready to go again.`;
    }
    if (!snapshot.hasProgram) {
      return `Hi ${name} — you're not on a program yet, but I can still help you plan your training. What are you working towards?`;
    }
    if (snapshot.todaysSessions.length > 0) {
      return `Hi ${name} — today you've got ${snapshot.todaysSessions.join(' and ')}. Tell me how it goes, or ask me anything about it.`;
    }
    if (snapshot.daysSinceLastSession !== null && snapshot.daysSinceLastSession >= 5) {
      return `Hi ${name} — it's been ${snapshot.daysSinceLastSession} days since your last session. Anything going on I should know about?`;
    }
    return `Hi ${name} — rest day today. Good time to tell me how the week's been.`;
  }, [snapshot]);

  const prompts = snapshot?.suggestedPrompts?.length ? snapshot.suggestedPrompts : FALLBACK_PROMPTS;

  const send = useCallback(
    async (text: string, kind: CoachMessageKind = 'text') => {
      const trimmed = text.trim();
      if (!trimmed || isSending || !currentUser) return;

      const sentAbout = about;
      setMessages(prev => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
          kind,
          about: sentAbout ?? undefined,
        },
      ]);
      setDraft('');
      setAbout(null);
      setIsSending(true);

      try {
        const response = await authedFetch('/api/ai/coach-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, conversationId, kind, about: sentAbout }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'The coach could not answer that.');

        setConversationId(data.conversationId ?? conversationId);
        if (data.snapshot) {
          // Keep the notes we have: the ones in the reply were read before this
          // message could add to them. They're refreshed a moment later.
          setSnapshot(current => ({ ...data.snapshot, notes: current?.notes ?? data.snapshot.notes }));
        }
        setMessages(prev => [
          ...prev,
          {
            id: `coach-${Date.now()}`,
            role: 'assistant',
            content: data.answer,
            createdAt: new Date().toISOString(),
            consulted: data.consulted,
            planProposal: data.planProposal ?? null,
          },
        ]);
        setTimeout(refreshRemembered, 3000);
      } catch (error) {
        logger.error('Error calling coach:', error);
        setMessages(prev => [
          ...prev,
          {
            id: `coach-error-${Date.now()}`,
            role: 'assistant',
            createdAt: new Date().toISOString(),
            content:
              error instanceof Error && error.message
                ? error.message
                : "I couldn't get to your training data just then. Try again in a moment.",
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [about, conversationId, currentUser, isSending, refreshRemembered],
  );

  // A question arriving from elsewhere in the app (?q=) is asked once, after the
  // thread has loaded so it lands in the athlete's existing conversation.
  const seedSentRef = useRef(false);
  useEffect(() => {
    if (!seedMessage || loadingThread || !currentUser || seedSentRef.current) return;
    seedSentRef.current = true;
    void send(seedMessage);
  }, [seedMessage, loadingThread, currentUser, send]);

  if (!authChecked || loadingThread) {
    return (
      <Card className="flex flex-1 flex-col">
        <CardContent className="flex-1 space-y-4 p-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-10 w-1/2 self-end" />
          <Skeleton className="h-16 w-2/3" />
        </CardContent>
        <CardFooter className="border-t pt-6">
          <Skeleton className="h-10 w-full" />
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="flex flex-1 flex-col overflow-hidden">
      {snapshot && (snapshot.notes.length > 0 || snapshot.programName || snapshot.todaysSessions.length > 0) && (
        <CardHeader className="space-y-3 pb-3">
          <SnapshotBar snapshot={snapshot} />
          <RememberedStrip notes={snapshot.notes} onDismiss={dismissNote} />
        </CardHeader>
      )}

      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full pr-4">
          <div className="space-y-6 pb-2 pt-2">
            <div className="flex items-start gap-3">
              <CoachAvatar />
              <div className="max-w-[85%] rounded-lg bg-muted p-3 text-sm md:max-w-md">
                {greeting}
              </div>
            </div>

            {messages.map((message, index) => {
              const at = new Date(message.createdAt);
              const previous = messages[index - 1];
              const newDay =
                !Number.isNaN(at.getTime()) &&
                (!previous || !isSameDay(new Date(previous.createdAt), at));

              return (
                <Fragment key={message.id}>
                  {newDay && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="h-px flex-1 bg-border" />
                      {dayLabel(at)}
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex items-start gap-3',
                      message.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    {message.role === 'assistant' && <CoachAvatar />}
                    <div
                      className={cn(
                        'max-w-[85%] rounded-lg p-3 text-sm md:max-w-lg',
                        message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <>
                          <CoachMarkdown content={message.content} />
                          {message.planProposal && message.planProposal.adjustments.length > 0 && (
                            <PlanProposalCard
                              proposal={message.planProposal}
                              onApplied={refreshSnapshot}
                            />
                          )}
                          {message.consulted && message.consulted.length > 0 && (
                            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                              <Search className="h-3 w-3" />
                              Checked {message.consulted.join(', ')}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          {(message.kind === 'voice' || message.about) && (
                            <p className="mb-1 flex items-center gap-1 text-xs opacity-80">
                              {message.kind === 'voice' && <Mic className="h-3 w-3" />}
                              {[message.kind === 'voice' ? 'Voice note' : null, message.about]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <Avatar className="h-8 w-8 shrink-0 border">
                        <AvatarFallback>
                          {snapshot?.athleteFirstName?.[0]?.toUpperCase() ||
                            currentUser?.email?.[0]?.toUpperCase() ||
                            'U'}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                </Fragment>
              );
            })}

            {transcribing && (
              <div className="flex items-start justify-end gap-3">
                <div className="flex items-center gap-2 rounded-lg bg-primary/80 p-3 text-sm text-primary-foreground">
                  <Mic className="h-4 w-4" />
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}

            {isSending && (
              <div className="flex items-start justify-start gap-3">
                <CoachAvatar />
                <div className="flex max-w-md items-center gap-2 rounded-lg bg-muted p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Looking at your training…</span>
                </div>
              </div>
            )}

            {messages.length === 0 && currentUser && !isSending && (
              <div className="flex flex-wrap gap-2 pl-11">
                {prompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-2 border-t pt-3">
        {!draft && !isSending && !transcribing && currentUser && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {QUICK_STARTERS.map(starter => (
              <button
                key={starter.label}
                type="button"
                onClick={() => setDraft(starter.draft)}
                className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                {starter.label}
              </button>
            ))}
          </div>
        )}
        <CoachComposer
          value={draft}
          onValueChange={setDraft}
          onSend={send}
          onTranscribing={setTranscribing}
          onError={message => toast({ title: 'Voice note', description: message, variant: 'destructive' })}
          disabled={isSending || !currentUser}
          about={about}
          onClearAbout={() => setAbout(null)}
          autoFocus={!!initialDraft}
          placeholder={
            currentUser
              ? 'Type to your coach, or tap the mic for a voice note…'
              : 'Please log in to talk to your coach.'
          }
        />
      </CardFooter>
    </Card>
  );
}
