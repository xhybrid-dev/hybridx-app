
'use client';
import { logger } from '@/lib/logger';
import { trackEvent, updateUserMeta, getPlatform } from '@/lib/analytics';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LogOut,
  Shield,
} from 'lucide-react';
import { signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getAuthInstance } from '@/lib/firebase';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { Logo } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { InstallPwaBanner } from '@/components/install-pwa-banner';
import { NotificationPermissionPrompt } from '@/components/notification-permission-prompt';
import { OfflineIndicator } from '@/components/offline-indicator';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { getUserClient } from '@/services/user-service-client';
import { isTrialExpired } from '@/lib/trial';
import { MobileNavBar, primaryNavItems, secondaryNavItems, adminNavItems } from '@/components/mobile-nav-bar';
import { UserProvider, useUserProfile } from '@/contexts/user-context';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';


function NavMenu() {
    const { setOpenMobile } = useSidebar();
    const pathname = usePathname();
    const { user } = useUserProfile();
    const isAdmin = !!user?.isAdmin;

    const handleLinkClick = () => {
        setOpenMobile(false);
    };

    return (
        <>
            <SidebarMenu>
                {primaryNavItems.map((item) => (
                    // Hide the central workout button from the sidebar list
                    !item.isCentral && (
                        <SidebarMenuItem key={item.href}>
                            <SidebarMenuButton asChild tooltip={item.label} isActive={pathname.startsWith(item.href)}>
                                <Link href={item.href} onClick={handleLinkClick}>
                                    <item.icon />
                                    <span>{item.label}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )
                ))}
            </SidebarMenu>
            <SidebarSeparator />
            <SidebarMenu>
                 {secondaryNavItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild tooltip={item.label} isActive={pathname.startsWith(item.href)}>
                            <Link href={item.href} onClick={handleLinkClick}>
                                <item.icon />
                                <span>{item.label}</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                ))}
            </SidebarMenu>
            {/* Admin/debug navigation is only shown to administrators */}
            {isAdmin && (
                <>
                    <SidebarSeparator />
                    <SidebarMenu>
                        {adminNavItems.map((item) => (
                            <SidebarMenuItem key={item.href}>
                                <SidebarMenuButton asChild tooltip={item.label} isActive={pathname.startsWith(item.href)}>
                                    <Link href={item.href} onClick={handleLinkClick}>
                                        <item.icon />
                                        <span>{item.label}</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ))}
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild tooltip="Debug" isActive={pathname.startsWith('/debug')}>
                                <Link href="/debug" onClick={handleLinkClick}>
                                    <Shield />
                                    <span>Debug</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </>
            )}
        </>
    );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionStartRef = useRef<number | null>(null);
  const trackedUserRef = useRef<string | null>(null);
  
  useEffect(() => {
    const initialize = async () => {
        const auth = await getAuthInstance();

        // CRITICAL FIX: Wait for Firebase to restore session from IndexedDB
        if (typeof auth.authStateReady === 'function') {
            await auth.authStateReady();
        }

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                logger.log('✅ [Layout] User authenticated:', currentUser.email);
                setUser(currentUser);

                // Start session tracking for this user (once per auth state)
                if (trackedUserRef.current !== currentUser.uid) {
                    trackedUserRef.current = currentUser.uid;
                    sessionStartRef.current = Date.now();
                    trackEvent(currentUser.uid, 'session_start', { platform: getPlatform() });
                    updateUserMeta(currentUser.uid, {
                        lastLoginAt: new Date(),
                        platform: getPlatform(),
                        // Server jobs run in UTC; this is how they know the athlete's day.
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    });
                }

                const appUser = await getUserClient(currentUser.uid);
                if (appUser && !appUser.isAdmin && pathname !== '/subscription') {
                    const status = appUser.subscriptionStatus || 'trial';
                    const trialEnded = isTrialExpired(appUser.trialStartDate);

                    if (status === 'trial' && trialEnded) {
                        router.push('/subscription');
                    } else if (!['trial', 'active', 'paused'].includes(status)) {
                        router.push('/subscription');
                    }
                }
            } else {
                logger.log('❌ [Layout] No authenticated user, redirecting to login');
                router.push('/login');
            }
            setLoading(false);
        });
        return unsubscribe;
    };

    let unsubscribe: () => void;
    initialize().then(unsub => unsubscribe = unsub);
    
    // Status Bar handling for Android
    if (Capacitor.getPlatform() === 'android') {
        const configureStatusBar = async () => {
            try {
                // Keeps the webview below the status bar on Android 14 and
                // older. From Android 15 (targetSdk 35) edge-to-edge is
                // enforced and this is a no-op, so the layout must also inset
                // itself with env(safe-area-inset-*) — see the header below.
                await StatusBar.setOverlaysWebView({ overlay: false });
                // Set style and background color explicitly
                await StatusBar.setStyle({ style: Style.Light });
                await StatusBar.setBackgroundColor({ color: '#FFFFFF' });
            } catch (e) {
                logger.error("Status bar configuration failed", e);
            }
        };
        configureStatusBar();
    }

    return () => {
        if (unsubscribe) {
            unsubscribe();
        }
    };
  }, [router, pathname]);

  // Tapping a native reminder opens the app wherever it was last left; send
  // the athlete to what the reminder was about instead.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const url = action.notification.extra?.url;
      router.push(typeof url === 'string' && url.startsWith('/') ? url : '/dashboard');
    });
    return () => {
      void listener.then(handle => handle.remove());
    };
  }, [router]);

  // Track page views on route change
  useEffect(() => {
    if (user) {
      trackEvent(user.uid, 'page_view', { path: pathname });
    }
  }, [pathname, user]);

  // Track session end when user hides/closes the tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && user && sessionStartRef.current) {
        const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
        trackEvent(user.uid, 'session_end', {
          durationSeconds,
          platform: getPlatform(),
        });
        updateUserMeta(user.uid, {
          sessionCount: (window as any).__axSessionCount
            ? (window as any).__axSessionCount + 1
            : 1,
        });
        sessionStartRef.current = null;
      } else if (!document.hidden && user && !sessionStartRef.current) {
        sessionStartRef.current = Date.now();
        trackEvent(user.uid, 'session_start', { platform: getPlatform(), resumed: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user]);

  const handleLogout = async () => {
    try {
      const auth = await getAuthInstance();
      await signOut(auth);

      await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'include',
      });
      logger.log('🧹 Session cookie cleared on logout');

      toast({
        title: 'Logged Out',
        description: 'You have been successfully logged out.',
      });
      router.push('/login');
      router.refresh();
    } catch (error) {
      logger.error('Logout error:', error);
      toast({
        title: 'Error',
        description: 'Failed to log out. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
      <UserProvider>
        <SidebarProvider>
            <Sidebar>
            <SidebarHeader className="p-4">
                <Link href="/dashboard" className="flex items-center gap-2">
                <Logo className="h-8 w-8 text-primary" />
                <span className="text-lg font-semibold font-headline">HYBRIDX.CLUB</span>
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <NavMenu />
            </SidebarContent>
            <SidebarFooter>
                <div className="flex w-full items-center justify-between p-2">
                {loading ? (
                    <div className="flex items-center gap-2 w-full">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                    </div>
                ) : user ? (
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Avatar className="h-8 w-8">
                            <AvatarFallback>{user.email?.[0].toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm font-medium">{user.email}</span>
                    </div>
                ) : null}
                <Button variant="ghost" size="icon" onClick={handleLogout} className="flex-shrink-0">
                    <LogOut className="h-5 w-5" />
                </Button>
                </div>
            </SidebarFooter>
            </Sidebar>
            {/*
              min-w-0: without it this flex item takes its automatic minimum
              size from its contents, so one long unbreakable string (an email
              address, a route id, a wide table) stretches the whole page and
              the viewport scrolls sideways on a phone. With it, wide content
              stays inside the scroll container below and truncation works.
            */}
            <SidebarInset className="min-w-0">
            {/*
              min-h rather than a fixed h: Android 15 draws the webview behind
              the status bar, so pt-safe adds real padding here. With a fixed
              height that padding squeezed the trigger/logo row out of the box
              and the bottom border was drawn straight through it.
            */}
            <header className="flex min-h-14 items-center justify-between gap-4 border-b bg-card px-4 pt-safe lg:min-h-[60px] lg:px-6">
                <div className="flex items-center gap-2">
                    <SidebarTrigger className="md:hidden" />
                    <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
                        <Logo className="h-6 w-6 text-primary" />
                        <span className="font-bold text-md font-headline">HYBRIDX.CLUB</span>
                    </Link>
                </div>
                <div className="w-full flex-1">
                    {/* Header content can go here, like breadcrumbs */}
                </div>
            </header>

            {/* Email verification reminder (hidden once verified/dismissed) */}
            <VerifyEmailBanner />

            {/* Offline Indicator */}
            <OfflineIndicator />

            <main className="flex-1 overflow-auto p-4 lg:p-6 pb-28 md:pb-6">{children}</main>

            {/* PWA Banner for Desktop */}
            <div className="hidden md:block">
                <InstallPwaBanner />
            </div>

            {/* Notification Permission Prompt */}
            <NotificationPermissionPrompt />

            {/* Mobile Nav Bar for smaller screens */}
            <div className="md:hidden">
                <MobileNavBar />
            </div>
            </SidebarInset>
        </SidebarProvider>
    </UserProvider>
  );
}
