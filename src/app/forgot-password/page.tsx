'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';

import { getAuthInstance } from '@/lib/firebase';
import { logger } from '@/lib/logger';
import { Logo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ForgotPasswordForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus('sending');
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setStatus('idle');
        return;
      }
      if (data.fallback) {
        // Our mail transport was unavailable; Firebase's own sender still works.
        await sendPasswordResetEmail(await getAuthInstance(), email).catch(err => logger.error('Fallback reset failed:', err));
      }
      setStatus('sent');
    } catch (err) {
      logger.error('Password reset request failed:', err);
      setError('Could not reach the server. Check your connection and try again.');
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <MailCheck className="h-8 w-8 text-primary" />
          <CardTitle className="font-headline">Check your email</CardTitle>
          <CardDescription>
            If there&apos;s a HybridX account for <span className="font-medium text-foreground">{email}</span>, a link to
            choose a new password is on its way. It can take a minute — check your spam folder too.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="font-headline">Forgot your password?</CardTitle>
          <CardDescription>Enter the email you signed up with and we&apos;ll send you a link to choose a new one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="reset-email">Email</Label>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={status === 'sending' || !email}>
            {status === 'sending' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reset link
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login"><ArrowLeft className="mr-2 h-4 w-4" />Back to sign in</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="container z-40 bg-background">
        <div className="flex h-20 items-center py-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-8 w-8 text-primary" />
            <span className="font-bold font-headline">HYBRIDX.CLUB</span>
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center p-4">
        <Suspense fallback={null}>
          <ForgotPasswordForm />
        </Suspense>
      </main>
    </div>
  );
}
