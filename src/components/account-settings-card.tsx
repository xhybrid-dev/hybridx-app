'use client';
//
// Password reset and account deletion, both self-serve. Deleting an account
// in-app is an App Store requirement; before this only an admin could.

import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authedFetch } from '@/lib/client-auth';
import { getAuthInstance } from '@/lib/firebase';
import { logger } from '@/lib/logger';

export function AccountSettingsCard({ email }: { email: string }) {
  const { toast } = useToast();
  const [sendingReset, setSendingReset] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const sendReset = async () => {
    setSendingReset(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast({ title: 'Check your email', description: `A link to choose a new password is on its way to ${email}.` });
    } catch (error) {
      logger.error('Password reset request failed:', error);
      toast({ title: 'Could not send the email', description: 'Please try again in a few minutes.', variant: 'destructive' });
    } finally {
      setSendingReset(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const response = await authedFetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not delete your account.');
      await signOut(await getAuthInstance()).catch(() => {});
      window.location.href = '/';
    } catch (error) {
      toast({
        title: 'Account not deleted',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Signed in as {email}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={sendReset} disabled={sendingReset}>
          {sendingReset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
          Change password
        </Button>

        <AlertDialog onOpenChange={open => { if (!open) setConfirmText(''); }}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive hover:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This cancels any subscription immediately and permanently deletes your plans, workout history, journal and
                coach conversations. It can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
              <Input id="confirm-delete" value={confirmText} onChange={e => setConfirmText(e.target.value)} autoComplete="off" />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Keep my account</AlertDialogCancel>
              <Button variant="destructive" onClick={deleteAccount} disabled={confirmText !== 'DELETE' || deleting}>
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete permanently
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
