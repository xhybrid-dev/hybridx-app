'use client';

import type { MouseEvent, ReactNode } from 'react';
import { PRIVACY_POLICY_URL } from '@/lib/legal';
import { openExternal } from '@/lib/native';
import { cn } from '@/lib/utils';

/**
 * Link to the privacy policy. In the iOS/Android apps it opens the in-app
 * browser sheet (with a Done button), so the athlete can't get stranded on a
 * page with no way back; on the web it opens a new tab.
 */
export function PrivacyPolicyLink({
  className,
  children = 'Privacy Policy',
}: {
  className?: string;
  children?: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternal(PRIVACY_POLICY_URL);
  };
  return (
    <a
      href={PRIVACY_POLICY_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={cn('underline underline-offset-2 hover:text-primary', className)}
    >
      {children}
    </a>
  );
}
