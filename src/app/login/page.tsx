// src/app/login/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { LoginForm } from '@/components/auth-forms';
import { Logo } from '@/components/icons';
import { getAuthInstance } from '@/lib/firebase';
import { logger } from '@/lib/logger';

/** Where to send an athlete whose Firebase session is still alive. */
function resumeDestination(): string {
  const pending = localStorage.getItem('pending-strava-auth');
  if (!pending) return '/dashboard';
  localStorage.removeItem('pending-strava-auth');
  try {
    const { code, scope, timestamp } = JSON.parse(pending);
    if (Date.now() - timestamp < 300_000) {
      return `/api/strava/exchange?code=${encodeURIComponent(code)}&scope=${encodeURIComponent(scope)}`;
    }
  } catch {
    /* stale or malformed — just go to the dashboard */
  }
  return '/dashboard';
}

export default function LoginPage() {
  const { toast } = useToast();
  // True while we find out whether Firebase still has this athlete signed in.
  const [resuming, setResuming] = useState(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');
    const stravaCode = urlParams.get('strava-code');
    const stravaScope = urlParams.get('strava-scope');

    if (reason?.includes('strava-auth') && stravaCode) {
        toast({
            title: 'Session Expired',
            description: 'Please log in again to complete your Strava connection.',
            variant: 'destructive'
        });

        // Store Strava data in localStorage to complete after login
        localStorage.setItem('pending-strava-auth', JSON.stringify({
            code: stravaCode,
            scope: stravaScope,
            timestamp: Date.now()
        }));
    }
  }, [toast]);

  // The session cookie lasts 14 days, but Firebase keeps the athlete signed in
  // on the device far longer. Someone coming back after a fortnight away was
  // shown a password form they may no longer remember; mint a fresh cookie and
  // take them straight back to their training instead.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = await getAuthInstance();
        await auth.authStateReady();
        const current = auth.currentUser;
        if (current && !cancelled) {
          const response = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ idToken: await current.getIdToken(true) }),
          });
          if (response.ok && !cancelled) {
            window.location.href = resumeDestination();
            return; // keep the spinner up while the browser navigates
          }
        }
      } catch (error) {
        logger.error('Could not resume the previous session:', error);
      }
      if (!cancelled) setResuming(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="container z-40 bg-background">
        <div className="flex h-20 items-center justify-between py-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-8 w-8 text-primary" />
            <span className="font-bold font-headline">HYBRIDX.CLUB</span>
          </Link>
          <nav>
            <Button asChild variant="ghost">
              <Link href="/signup">Sign Up</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center p-4">
        {resuming ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground" role="status">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Signing you back in…</p>
          </div>
        ) : (
          <LoginForm />
        )}
      </main>
    </div>
  );
}
