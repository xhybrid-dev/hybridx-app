'use client';
//
// The one input for talking to the coach: type it, or hold a voice note.
//
// Used full-size on the Talk to Coach page and as a single line on the
// dashboard. Either way the athlete gets the same two choices — a typed
// message or a voice note — and both land in the same thread, read by the same
// coach, remembered the same way.

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Loader2, Mic, Square, X } from 'lucide-react';

import { authedFetch } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import {
  MAX_VOICE_NOTE_SECONDS,
  transcribeRecording,
  useVoiceRecorder,
} from '@/hooks/use-voice-recorder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type CoachMessageKind = 'text' | 'voice';

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function CoachComposer({
  onSend,
  onTranscribing,
  onError,
  disabled,
  placeholder = 'Tell your coach how it went, or ask about the plan…',
  variant = 'full',
  value,
  onValueChange,
  about,
  onClearAbout,
  autoFocus,
}: {
  /** Called with the message (or the voice note's transcript) to send. */
  onSend: (text: string, kind: CoachMessageKind) => void | Promise<void>;
  /** True while a voice note is being turned into text. */
  onTranscribing?: (busy: boolean) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  variant?: 'full' | 'compact';
  /** Controlled draft, so the page can prefill it (quick starters, ?draft=). */
  value?: string;
  onValueChange?: (value: string) => void;
  /** The session this message is about, shown as a removable chip. */
  about?: string | null;
  onClearAbout?: () => void;
  autoFocus?: boolean;
}) {
  const [ownDraft, setOwnDraft] = useState('');
  const draft = value ?? ownDraft;
  const setDraft = onValueChange ?? setOwnDraft;
  const [transcribing, setTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const recorder = useVoiceRecorder({
    onError,
    onRecorded: async recording => {
      if (recording.seconds < 1) {
        onError?.('That was a bit short — hold on a moment longer and speak.');
        return;
      }
      setTranscribing(true);
      onTranscribing?.(true);
      try {
        const transcript = await transcribeRecording(recording, authedFetch);
        if (!transcript) {
          onError?.("Couldn't hear anything in that one — try again somewhere quieter?");
          return;
        }
        await onSend(transcript, 'voice');
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "Couldn't send that voice note.");
      } finally {
        setTranscribing(false);
        onTranscribing?.(false);
      }
    },
  });

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const recording = recorder.state === 'recording';
  const busy = disabled || transcribing;
  const canType = !busy && !recording;
  const micAvailable = recorder.state !== 'unsupported';

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void onSend(text, 'text');
  };

  const aboutChip = about ? (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
      <span className="truncate">About: {about}</span>
      {onClearAbout && (
        <button type="button" onClick={onClearAbout} aria-label="Not about this session">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  ) : null;

  // While recording, the input gives way to the recording bar: the athlete
  // should see that it's listening and how long they've been going.
  if (recording || transcribing) {
    return (
      <div className="w-full space-y-2">
        {aboutChip}
        <div
          className={cn(
            'flex w-full items-center gap-3 rounded-md border bg-background px-3',
            variant === 'full' ? 'min-h-[56px]' : 'h-10',
          )}
          role="status"
          aria-live="polite"
        >
          {transcribing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="flex-1 text-sm text-muted-foreground">Sending your voice note…</span>
            </>
          ) : (
            <>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="flex-1 text-sm tabular-nums">
                {clock(recorder.seconds)}
                <span className="text-muted-foreground"> / {clock(MAX_VOICE_NOTE_SECONDS)}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={recorder.cancel}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={recorder.stop} className="gap-1">
                <Square className="h-3 w-3 fill-current" />
                Send
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const micButton = micAvailable ? (
    <Button
      type="button"
      size="icon"
      variant={variant === 'full' ? 'secondary' : 'ghost'}
      className={variant === 'full' ? 'h-8 w-8' : 'h-7 w-7'}
      onClick={() => void recorder.start()}
      disabled={!canType}
      aria-label="Record a voice note"
      title="Record a voice note"
    >
      <Mic className="h-4 w-4" />
    </Button>
  ) : null;

  const sendButton = (
    <Button
      type="submit"
      size="icon"
      variant={variant === 'full' ? 'default' : 'ghost'}
      className={variant === 'full' ? 'h-8 w-8' : 'h-7 w-7'}
      disabled={!canType || !draft.trim()}
      aria-label="Send to your coach"
    >
      <CornerDownLeft className="h-4 w-4" />
    </Button>
  );

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
      className="w-full space-y-2"
    >
      {aboutChip}
      {variant === 'full' ? (
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              // Enter sends, Shift+Enter breaks the line — the athlete is often
              // typing a paragraph about how a session went.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            rows={2}
            className="min-h-[56px] resize-none pr-24"
            disabled={!canType}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {/* An empty box shows the mic first: talking is the quick way in. */}
            {micButton}
            {sendButton}
          </div>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder={placeholder}
            className="pr-16"
            disabled={!canType}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
            {micButton}
            {sendButton}
          </div>
        </div>
      )}
    </form>
  );
}
