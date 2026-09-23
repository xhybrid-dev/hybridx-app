// src/components/verify-email-banner.tsx
'use client';

import { useEffect, useState } from 'react';
import { MailWarning, X } from 'lucide-react';
import { onAuthStateChanged, sendEmailVerification, type User as FirebaseUser } from 'firebase/auth';
import { getAuthInstance } from '@/lib/firebase';
import { authedFetch } from '@/lib/client-auth';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

/**
 * Soft reminder for users who haven't verified their email yet. We don't block
 * access on verification (that would hurt activation), but we nudge — verified
 * emails meaningfully improve deliverability of the re-engagement / coaching
 * emails that drive retention.
 */
const DISMISS_KEY = 'verifyEmailDismissedUntil';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export function VerifyEmailBanner() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const auth = await getAuthInstance();
      unsub = onAuthStateChanged(auth, setFbUser);
    })();
    return () => unsub?.();
  }, []);

  // A dismissal holds for a week; per-session meant it came back every visit.
  useEffect(() => {
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (until > Date.now()) setDismissed(true);
    } catch {
      /* storage unavailable: show it */
    }
  }, []);

  if (dismissed || !fbUser || fbUser.emailVerified) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      // Prefer our own transport (Brevo/Gmail); fall back to Firebase's sender.
      const res = await authedFetch('/api/auth/send-verification', { method: 'POST' });
      if (!res.ok) throw new Error(`send-verification failed: ${res.status}`);
      toast({ title: 'Verification email sent', description: `Check ${fbUser.email} for the link.` });
    } catch (err) {
      logger.error('Resend via transport failed, falling back to Firebase sender:', err);
      try {
        await sendEmailVerification(fbUser);
        toast({ title: 'Verification email sent', description: `Check ${fbUser.email} for the link.` });
      } catch (err2) {
        logger.error('Resend verification failed:', err2);
        toast({ title: 'Could not send email', description: 'Please try again in a moment.', variant: 'destructive' });
      }
    } finally {
      setSending(false);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
    } catch {
      /* dismiss for this view only */
    }
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm">
      <MailWarning className="h-4 w-4 shrink-0 text-yellow-600" />
      <span className="flex-1">
        Please verify your email to secure your account and get coaching updates.
      </span>
      <Button size="sm" variant="outline" onClick={handleResend} disabled={sending}>
        {sending ? 'Sending…' : 'Resend'}
      </Button>
      <button onClick={handleDismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
