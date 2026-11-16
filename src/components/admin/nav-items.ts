import type { ComponentType } from 'react';
import {
  BarChart2,
  BookOpen,
  Contact,
  DoorOpen,
  FlaskConical,
  Filter,
  Mail,
  Send,
  Settings,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface AdminNavSection {
  label: string;
  icon: ComponentType<{ className?: string }>;
  items: AdminNavItem[];
}

/**
 * Single source of truth for admin navigation.
 *
 * The desktop sidebar and the mobile drawer render from this same list, so a
 * page added here appears in both rather than only in whichever one was
 * remembered.
 */
export const ADMIN_NAV: AdminNavSection[] = [
  {
    label: 'Admin Panel',
    icon: Settings,
    items: [
      { href: '/admin/programs', label: 'Programs', icon: BookOpen },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart2 },
    ],
  },
  {
    label: 'Marketing',
    icon: Mail,
    items: [
      { href: '/admin/marketing', label: 'Overview', icon: BarChart2 },
      { href: '/admin/marketing/studio', label: 'Studio', icon: Sparkles },
      { href: '/admin/marketing/eval', label: 'Drafting eval', icon: FlaskConical },
      { href: '/admin/marketing/journeys', label: 'Journeys', icon: Workflow },
      { href: '/admin/marketing/campaigns', label: 'Campaigns', icon: Send },
      { href: '/admin/marketing/subscribers', label: 'Subscribers', icon: Contact },
      { href: '/admin/marketing/segments', label: 'Segments', icon: Filter },
      { href: '/admin/marketing/routes', label: 'Routes', icon: DoorOpen },
      { href: '/admin/marketing/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((section) => section.items);

/**
 * The nav entry a path belongs to — longest match wins, so
 * `/admin/marketing/campaigns/123/edit` resolves to Campaigns rather than to
 * the shorter `/admin/marketing` overview.
 */
export function findActiveItem(pathname: string): AdminNavItem | undefined {
  return ADMIN_NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
