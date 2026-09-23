'use client';

import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Smartphone, X, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

interface AndroidBetaBannerProps {
  userEmail?: string;
  userName?: string;
}

export function AndroidBetaBanner({ userEmail, userName }: AndroidBetaBannerProps) {
  // Remembered: the banner used to come back on every visit.
  const [isDismissed, setIsDismissedState] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('android-beta-banner-dismissed') === 'true';
    } catch {
      return false;
    }
  });
  const setIsDismissed = (value: boolean) => {
    setIsDismissedState(value);
    try {
      if (value) localStorage.setItem('android-beta-banner-dismissed', 'true');
    } catch {
      /* ignore */
    }
  };
  const [isRequesting, setIsRequesting] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const { toast } = useToast();

  // Only show on Android devices
  const isAndroid = Capacitor.getPlatform() === 'android';

  // Check if user has already requested (stored in localStorage)
  const hasAlreadyRequested = typeof window !== 'undefined'
    && localStorage.getItem('beta-tester-requested') === 'true';

  if (!isAndroid || isDismissed || hasAlreadyRequested) {
    return null;
  }

  const handleRequestAccess = async () => {
    if (!userEmail) {
      toast({
        title: 'Error',
        description: 'Unable to process request. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    setIsRequesting(true);

    try {
      const response = await fetch('/api/beta-testing/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          name: userName || 'User',
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setHasRequested(true);
        localStorage.setItem('beta-tester-requested', 'true');

        toast({
          title: 'Request Submitted!',
          description: 'Check your email for confirmation. We\'ll add you to the beta program soon.',
        });

        // Auto-dismiss after a few seconds
        setTimeout(() => setIsDismissed(true), 5000);
      } else {
        throw new Error(data.error || 'Failed to submit request');
      }
    } catch (error) {
      console.error('Error requesting beta access:', error);
      toast({
        title: 'Request Failed',
        description: 'Unable to submit your request. Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <Card className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/40 border-green-200 dark:border-green-800 relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6"
        onClick={() => setIsDismissed(true)}
      >
        <X className="h-4 w-4" />
      </Button>

      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-800 dark:text-green-300 pr-8">
          <Smartphone className="h-5 w-5" />
          Join the Android Beta Program
        </CardTitle>
        <CardDescription className="text-green-700 dark:text-green-300">
          Help us improve the app! Get early access to new features and updates.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {hasRequested ? (
          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <CheckCircle className="h-5 w-5" />
            <p className="text-sm font-medium">
              Your request has been submitted. Check your email for next steps!
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-green-700 dark:text-green-300 mb-4">
              We're testing the Android app with a small group before the full release.
              Click below to join our closed testing program on Google Play.
            </p>
            <Button
              onClick={handleRequestAccess}
              disabled={isRequesting}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              {isRequesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting Request...
                </>
              ) : (
                <>
                  <Smartphone className="mr-2 h-4 w-4" />
                  Request Beta Access
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
