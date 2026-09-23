// src/components/mobile-nav-bar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, Newspaper, LayoutDashboard, Sparkles, BookOpen, CreditCard, Calendar, Activity, Shield, History, BookMarked, Gauge, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CustomWorkoutIcon } from './icons';
import { useScrollDirection } from '@/hooks/use-scroll-direction';

// Primary navigation items, including the central button. The coach is the
// app's main differentiator, so it gets a tab rather than a hamburger entry.
export const primaryNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Today' },
  { href: '/calendar', icon: Calendar, label: 'Plan' },
  { href: '/workout/active', icon: CustomWorkoutIcon, label: 'Workout', isCentral: true },
  { href: '/assistant', icon: Sparkles, label: 'Coach' },
  { href: '/history', icon: History, label: 'Progress' },
];

// Everything else lives in the menu.
export const secondaryNavItems = [
  { href: '/programs', icon: BookOpen, label: 'Programs' },
  { href: '/profile', icon: User, label: 'Profile' },
  { href: '/journal', icon: BookMarked, label: 'Journal' },
  { href: '/training', icon: Gauge, label: 'Training Form' },
  { href: '/activity-feed', icon: Activity, label: 'Activity Feed' },
  { href: '/articles', icon: Newspaper, label: 'Articles' },
  { href: '/vdot', icon: Target, label: 'VDOT Calculator' },
  { href: '/subscription', icon: CreditCard, label: 'Subscription' },
];

// Admin-specific items
export const adminNavItems = [
    { href: '/admin/programs', icon: Shield, label: 'Manage Programs' },
];

export function MobileNavBar() {
  const pathname = usePathname();
  const scrollDirection = useScrollDirection();

  // Separate the central button from the side items for easier layout control
  const centralItem = primaryNavItems.find(item => item.isCentral);
  const sideItems = primaryNavItems.filter(item => !item.isCentral);
  const leftItems = sideItems.slice(0, 2);
  const rightItems = sideItems.slice(2, 4);

  return (
    <nav className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-sm md:hidden safe-area-inset-bottom transition-transform duration-300 ease-in-out",
        scrollDirection === 'down' ? 'translate-y-full' : 'translate-y-0'
    )}>
      <div className="relative flex h-16 items-center px-safe">
        {/* Left side items */}
        <div className="flex flex-1 justify-around">
          {leftItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-1 text-muted-foreground transition-colors hover:text-primary touch-manipulation active:scale-95 min-h-[44px] min-w-[44px] justify-center px-2 py-1',
                  isActive && 'text-primary'
                )}
                aria-label={`Navigate to ${item.label}`}
              >
                <item.icon className="h-6 w-6" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
        
        {/* Central Button - Absolutely Positioned */}
        {centralItem && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
            <Link
              href={centralItem.href}
              className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full bg-accent text-accent-foreground shadow-lg touch-manipulation active:scale-95 transition-transform"
              aria-label={`${centralItem.label} - Main action`}
            >
              <centralItem.icon className="h-6 w-6" />
              <span className="text-xs font-bold">{centralItem.label}</span>
            </Link>
          </div>
        )}

        {/* Right side items */}
        <div className="flex flex-1 justify-around">
          {rightItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-1 text-muted-foreground transition-colors hover:text-primary touch-manipulation active:scale-95 min-h-[44px] min-w-[44px] justify-center px-2 py-1',
                  isActive && 'text-primary'
                )}
                aria-label={`Navigate to ${item.label}`}
              >
                <item.icon className="h-6 w-6" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
