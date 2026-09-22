'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Bell, CheckCircle2, ArrowRight, Share, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/icons';
import { subscribeUserToPush } from '@/lib/push-subscribe';
import { trackEvent } from '@/lib/analytics';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/utils';

type Step = 'pwa' | 'notifications' | 'done';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function SetupPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('pwa');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [notifStatus, setNotifStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');
  const [pwaStatus, setPwaStatus] = useState<'idle' | 'prompted' | 'installed' | 'skipped'>('idle');

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
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsStandalone(standalone);
    setIsIos(ios);

    if (standalone) {
      // Already running as PWA — skip to notifications
      setPwaStatus('installed');
      setStep('notifications');
    }

    const handleInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);

    // Check if notification already granted
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      setNotifStatus('granted');
    }

    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  const handleInstallPwa = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      trackEvent(user?.uid ?? null, outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed', {
        source: 'setup',
      });
      setPwaStatus(outcome === 'accepted' ? 'installed' : 'skipped');
    }
    setStep('notifications');
  };

  const handleSkipPwa = () => {
    trackEvent(user?.uid ?? null, 'pwa_install_dismissed', { source: 'setup_skip' });
    setPwaStatus('skipped');
    setStep('notifications');
  };

  const handleEnableNotifications = async () => {
    setNotifStatus('loading');
    const success = await subscribeUserToPush();
    if (success) {
      setNotifStatus('granted');
      trackEvent(user?.uid ?? null, 'notifications_enabled', { source: 'setup' });
    } else {
      setNotifStatus(
        typeof Notification !== 'undefined' && Notification.permission === 'denied'
          ? 'denied'
          : 'idle'
      );
    }
    setStep('done');
  };

  const handleSkipNotifications = () => {
    setStep('done');
  };

  const handleGoToDashboard = () => {
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <Logo className="h-10 w-10 text-primary" />
          <span className="text-xl font-bold font-headline">HYBRIDX.CLUB</span>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2">
          {(['pwa', 'notifications', 'done'] as Step[]).map((s) => (
            <div
              key={s}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                step === s ? 'w-8 bg-primary' : 'w-2 bg-muted'
              )}
            />
          ))}
        </div>

        {/* PWA Step */}
        {step === 'pwa' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
                <Download className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Install the App</h1>
              <p className="text-muted-foreground">
                Add HYBRIDX to your home screen for instant access, offline support, and a
                full app experience.
              </p>
            </div>

            <div className="space-y-3 bg-muted/40 rounded-xl p-4 text-sm">
              <BenefitRow icon="⚡" text="Opens instantly from your home screen" />
              <BenefitRow icon="📴" text="Works offline — train without signal" />
              <BenefitRow icon="🔔" text="Receive push notifications for workouts" />
              <BenefitRow icon="📱" text="Full-screen, no browser chrome" />
            </div>

            {isIos && !isStandalone ? (
              <div className="space-y-4">
                <div className="bg-muted rounded-xl p-4 space-y-3 text-sm">
                  <p className="font-medium">Install on iPhone/iPad:</p>
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
                      Tap &ldquo;Add&rdquo; in the top-right corner
                    </p>
                  </div>
                </div>
                <Button className="w-full" onClick={() => setStep('notifications')}>
                  I&apos;ve installed it <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button variant="ghost" className="w-full" onClick={handleSkipPwa}>
                  Skip for now
                </Button>
              </div>
            ) : installPrompt ? (
              <div className="space-y-3">
                <Button className="w-full" size="lg" onClick={handleInstallPwa}>
                  <Download className="mr-2 h-4 w-4" />
                  Install App
                </Button>
                <Button variant="ghost" className="w-full" onClick={handleSkipPwa}>
                  Skip for now
                </Button>
              </div>
            ) : (
              // Already installed or install prompt not available (e.g. already PWA / Chrome already prompted)
              <div className="space-y-3">
                <p className="text-center text-sm text-muted-foreground">
                  {isStandalone
                    ? '✅ Already running as an installed app!'
                    : 'Your browser will prompt you to install automatically.'}
                </p>
                <Button className="w-full" onClick={() => setStep('notifications')}>
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Notifications Step */}
        {step === 'notifications' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
                <Bell className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Stay on Track</h1>
              <p className="text-muted-foreground">
                Enable notifications so your AI coach can remind you about today&apos;s workout
                — even with the app closed.
              </p>
            </div>

            <div className="space-y-3 bg-muted/40 rounded-xl p-4 text-sm">
              <BenefitRow icon="🤖" text="AI-personalised workout reminders each morning" />
              <BenefitRow icon="📅" text="Never forget a scheduled session" />
              <BenefitRow icon="🔁" text="Re-engagement nudges if you miss a day" />
            </div>

            {notifStatus === 'granted' ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-600 justify-center font-medium">
                  <CheckCircle2 className="h-5 w-5" />
                  Notifications enabled!
                </div>
                <Button className="w-full" onClick={() => setStep('done')}>
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : notifStatus === 'denied' ? (
              <div className="space-y-3">
                <p className="text-center text-sm text-muted-foreground">
                  Notifications are blocked. You can enable them later in your browser settings
                  under <strong>Notifications</strong> for this site.
                </p>
                <Button className="w-full" onClick={() => setStep('done')}>
                  Continue anyway <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleEnableNotifications}
                  disabled={notifStatus === 'loading'}
                >
                  <Bell className="mr-2 h-4 w-4" />
                  {notifStatus === 'loading' ? 'Enabling...' : 'Enable Notifications'}
                </Button>
                <Button variant="ghost" className="w-full" onClick={handleSkipNotifications}>
                  Skip for now
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Done Step */}
        {step === 'done' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300 text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">You&apos;re all set!</h1>
              <p className="text-muted-foreground">
                Your training program is ready. Let&apos;s get to work.
              </p>
            </div>

            <div className="space-y-2 text-sm text-left bg-muted/40 rounded-xl p-4">
              <StatusRow
                label="PWA Installed"
                done={pwaStatus === 'installed' || isStandalone}
                skipped={pwaStatus === 'skipped'}
              />
              <StatusRow
                label="Notifications"
                done={notifStatus === 'granted'}
                skipped={notifStatus !== 'granted'}
              />
            </div>

            <Button className="w-full" size="lg" onClick={handleGoToDashboard}>
              Go to Dashboard <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function BenefitRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-foreground">{text}</span>
    </div>
  );
}

function StatusRow({
  label,
  done,
  skipped,
}: {
  label: string;
  done: boolean;
  skipped: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium">{label}</span>
      {done ? (
        <span className="text-green-600 flex items-center gap-1 text-xs font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" /> Enabled
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">Skipped</span>
      )}
    </div>
  );
}
