'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNotificationPermission } from '@/hooks/use-notification-permission';
import { subscribeUserToPush } from '@/lib/push-subscribe';
import { useSessions } from '@/contexts/user-context';

const NOTIFICATION_PROMPT_KEY = 'notification_prompt_dismissed';
const NOTIFICATION_PROMPT_VERSION = '1'; // Increment this to re-show the prompt after updates

export function NotificationPermissionPrompt() {
  const [isVisible, setIsVisible] = useState(false);
  const { permission, isSupported, requestPermission } = useNotificationPermission();
  // Asking before someone has trained once gets a reflexive "no" that can't be
  // undone in the browser. Wait until they've done a session.
  const { streakData } = useSessions();
  const hasTrained = streakData.totalWorkouts > 0;

  useEffect(() => {
    if (!hasTrained) return;
    // Only show if:
    // 1. Notifications are supported
    // 2. Permission hasn't been granted or denied yet
    // 3. User hasn't dismissed this version of the prompt
    const dismissed = localStorage.getItem(NOTIFICATION_PROMPT_KEY);

    if (isSupported && permission === 'default' && dismissed !== NOTIFICATION_PROMPT_VERSION) {
      // Show after a short delay to not overwhelm on first load
      const timer = setTimeout(() => setIsVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isSupported, permission, hasTrained]);

  const handleEnable = async () => {
    // Request permission + subscribe to web push in one step
    const success = await subscribeUserToPush();
    if (!success) {
      // Fall back to old permission-only request if push subscribe failed
      await requestPermission();
    }
    setIsVisible(false);
    localStorage.setItem(NOTIFICATION_PROMPT_KEY, NOTIFICATION_PROMPT_VERSION);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem(NOTIFICATION_PROMPT_KEY, NOTIFICATION_PROMPT_VERSION);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 z-50 animate-in slide-in-from-bottom-5">
      <Card className="border-2 shadow-lg">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="font-semibold text-sm mb-1">Never miss a workout</h3>
                <p className="text-sm text-muted-foreground">
                  Get daily reminders about your scheduled workouts.
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleEnable} size="sm" className="flex-1">
                  Enable Notifications
                </Button>
                <Button onClick={handleDismiss} variant="ghost" size="icon" className="flex-shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
