'use client';
//
// The Edge Coach conversation.
//
// The athlete talks to a coach that already knows this week, the last month and
// what they wrote in their journal. All of that assembly happens server-side in
// /api/ai/coach-chat — this component's job is the conversation: keep the
// thread, show what the coach looked at, and let the athlete accept a plan
// change the coach has drafted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  CalendarDays,
  CheckCircle2,
  CornerDownLeft,
  Flame,
  Loader2,
  MessageSquarePlus,
  Search,
  Target,
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
import { Textarea } from '@/components/ui/textarea';
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
  consulted?: string[];
  planProposal?: PlanProposal | null;
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
  suggestedPrompts: string[];
}

const FALLBACK_PROMPTS = [
  "How's my training going?",
  'What should I focus on this week?',
  'How do I get faster at the sled push?',
];

function CoachMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
          p: props => <p className="mb-3" {...props} />,
          ul: props => <ul className="mb-3 list-disc space-y-1 pl-5" {...props} />,
          ol: props => <ol className="mb-3 list-decimal space-y-1 pl-5" {...props} />,
          li: props => <li className="leading-relaxed" {...props} />,
          strong: props => <strong className="font-semibold" {...props} />,
          a: props => <a className="underline underline-offset-2" {...props} />,
          code: props => (
            <code className="rounded bg-background/60 px-1 py-0.5 text-xs" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

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

export function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
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

  // Pull the athlete's last thread and their current training snapshot, so the
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
              consulted: message.consulted,
            })),
          );
        }
      } catch (error) {
        if (!cancelled) {
          logger.error('Error loading coach conversation:', error);
        }
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
  }, [messages, isSending]);

  const greeting = useMemo(() => {
    if (!snapshot) return "I'm your Edge Coach. Ask me anything about your training.";
    const name = snapshot.athleteFirstName;
    if (!snapshot.hasProgram) {
      return `Hi ${name} — you're not on a program yet, but I can still help you plan your training. What are you working towards?`;
    }
    if (snapshot.todaysSessions.length > 0) {
      return `Hi ${name} — today you've got ${snapshot.todaysSessions.join(' and ')}. Ask me about it, or anything else in your training.`;
    }
    if (snapshot.daysSinceLastSession !== null && snapshot.daysSinceLastSession >= 5) {
      return `Hi ${name} — it's been ${snapshot.daysSinceLastSession} days since your last session. Want to talk about getting back into it?`;
    }
    return `Hi ${name} — rest day today. Good time to talk about how the block is going.`;
  }, [snapshot]);

  const prompts = snapshot?.suggestedPrompts?.length ? snapshot.suggestedPrompts : FALLBACK_PROMPTS;

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending || !currentUser) return;

      setMessages(prev => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', content: trimmed },
      ]);
      setInput('');
      setIsSending(true);

      try {
        const response = await authedFetch('/api/ai/coach-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, conversationId }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'The coach could not answer that.');

        setConversationId(data.conversationId ?? conversationId);
        if (data.snapshot) setSnapshot(data.snapshot);
        setMessages(prev => [
          ...prev,
          {
            id: `coach-${Date.now()}`,
            role: 'assistant',
            content: data.answer,
            consulted: data.consulted,
            planProposal: data.planProposal ?? null,
          },
        ]);
      } catch (error) {
        logger.error('Error calling Edge Coach:', error);
        setMessages(prev => [
          ...prev,
          {
            id: `coach-error-${Date.now()}`,
            role: 'assistant',
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
    [conversationId, currentUser, isSending],
  );

  // The plan the coach drafted has just been written to the athlete's program,
  // so the snapshot the header shows (and the next turn's briefing) is stale.
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

  const startNewThread = () => {
    setConversationId(null);
    setMessages([]);
    toast({ title: 'New conversation started' });
  };

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
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        {snapshot ? <SnapshotBar snapshot={snapshot} /> : <div />}
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={startNewThread} className="shrink-0 gap-1">
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full pr-4">
          <div className="space-y-6 pb-2">
            <div className="flex items-start gap-3">
              <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center border bg-primary text-primary-foreground">
                <Logo className="h-6 w-6" />
              </Avatar>
              <div className="max-w-[85%] rounded-lg bg-muted p-3 text-sm md:max-w-md">
                {greeting}
              </div>
            </div>

            {messages.map(message => (
              <div
                key={message.id}
                className={cn(
                  'flex items-start gap-3',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                {message.role === 'assistant' && (
                  <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center border bg-primary text-primary-foreground">
                    <Logo className="h-6 w-6" />
                  </Avatar>
                )}
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg p-3 text-sm md:max-w-lg',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted',
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
                    <p className="whitespace-pre-wrap">{message.content}</p>
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
            ))}

            {isSending && (
              <div className="flex items-start justify-start gap-3">
                <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center border bg-primary text-primary-foreground">
                  <Logo className="h-6 w-6" />
                </Avatar>
                <div className="flex max-w-md items-center gap-2 rounded-lg bg-muted p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Looking at your training…
                  </span>
                </div>
              </div>
            )}

            {messages.length === 0 && currentUser && (
              <div className="flex flex-wrap gap-2 pl-11">
                {prompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => send(prompt)}
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

      <CardFooter className="border-t pt-4">
        <form
          onSubmit={event => {
            event.preventDefault();
            void send(input);
          }}
          className="relative w-full"
        >
          <Textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              // Enter sends, Shift+Enter breaks the line — the athlete is often
              // typing a paragraph about how a session went.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder={
              currentUser
                ? 'Tell your coach how it went, or ask about the plan…'
                : 'Please log in to talk to your coach.'
            }
            rows={2}
            className="min-h-[56px] resize-none pr-12"
            disabled={isSending || !currentUser}
          />
          <Button
            type="submit"
            size="icon"
            className="absolute bottom-2 right-2 h-8 w-8"
            disabled={isSending || !input.trim() || !currentUser}
          >
            <CornerDownLeft className="h-4 w-4" />
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
