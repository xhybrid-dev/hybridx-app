'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

/**
 * Keeps the screen on while `active` is true, using the Screen Wake Lock API.
 *
 * The browser drops the lock whenever the page is hidden (app switch, phone
 * locked by hand), so it is requested again when the page becomes visible.
 * Does nothing where the API isn't available, or when the request is refused
 * (e.g. low battery): the screen then dims on the phone's normal timeout.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (sentinel || document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (released) {
          void lock.release();
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch (error) {
        logger.warn('Screen wake lock request failed', error);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
