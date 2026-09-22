'use client';
//
// One step between signup and the dashboard: installing the web app, which
// iOS needs before it will deliver web push at all. Native app users and
// people already running the installed app skip straight to training.
// Notification permission is asked after the first workout instead (see the
// completion screen), when a reminder means something.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { Download, ArrowRight, Share } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/icons';
import { trackEvent } from '@/lib/analytics';
import { useAuth } from '@/components/AuthProvider';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function SetupPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [ready, setReady] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!user && typeof window !== 'undefined') {
      // Give AuthProvider a moment to resolve before redirecting
      const t = setTimeout(() => {
        if (!user) router.push('/login');
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [user, router]);

  useEffect(() => {
    const standalone =
      Capacitor.isNativePlatform() ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) {
      router.replace('/dashboard');
      return;
    }
    setIsIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    setReady(true);

    const handleInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, [router]);

  const goToDashboard = () => router.push('/dashboard');

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      trackEvent(user?.uid ?? null, outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed', { source: 'setup' });
    }
    goToDashboard();
  };

  const handleSkip = () => {
    trackEvent(user?.uid ?? null, 'pwa_install_dismissed', { source: 'setup_skip' });
    goToDashboard();
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-2">
          <Logo className="h-10 w-10 text-primary" />
          <span className="text-xl font-bold font-headline">HYBRIDX.CLUB</span>
        </div>

        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="text-center space-y-2">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Download className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Put HybridX on your home screen</h1>
            <p className="text-muted-foreground">
              It opens like an app, works without signal at the gym, and can remind you before each session.
            </p>
          </div>

          {isIos ? (
            <div className="space-y-4">
              <div className="bg-muted rounded-xl p-4 space-y-3 text-sm">
                <p className="font-medium">On iPhone or iPad:</p>
                <div className="space-y-2 text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <span className="font-mono bg-background rounded px-1.5 py-0.5">1</span>
                    Tap the <Share className="h-4 w-4 inline mx-1" /> Share button in Safari
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="font-mono bg-background rounded px-1.5 py-0.5">2</span>
                    Scroll down and tap &ldquo;Add to Home Screen&rdquo;
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="font-mono bg-background rounded px-1.5 py-0.5">3</span>
                    Tap &ldquo;Add&rdquo;, then open HybridX from your home screen
                  </p>
                </div>
              </div>
              <Button className="w-full" onClick={goToDashboard}>
                Done <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleSkip}>
                Skip for now
              </Button>
            </div>
          ) : installPrompt ? (
            <div className="space-y-3">
              <Button className="w-full" size="lg" onClick={handleInstall}>
                <Download className="mr-2 h-4 w-4" />
                Install the app
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleSkip}>
                Skip for now
              </Button>
            </div>
          ) : (
            <Button className="w-full" size="lg" onClick={goToDashboard}>
              Go to today&apos;s training <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
