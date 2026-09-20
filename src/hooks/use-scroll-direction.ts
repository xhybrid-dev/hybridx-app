// src/hooks/use-scroll-direction.ts
'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Which way the page was last scrolled. Used by MobileNavBar to hide the bottom
 * bar on the way down.
 *
 * Two things matter here, because this is mounted on every authenticated page
 * and therefore sits on the scroll path of the whole mobile app:
 *
 *  - The listener is passive. Without that flag the browser has to wait for the
 *    handler before committing the scroll, and this handler reads layout
 *    (pageYOffset) on every event — a standard source of mobile scroll jank.
 *  - The effect has no dependencies. It previously depended on scrollDirection,
 *    so the listener was torn down and re-registered on every up/down flip, and
 *    lastScrollY was reset to the current offset each time. Both the last offset
 *    and the last direction now live in refs, so the listener is attached once.
 *
 * The layout read is additionally deferred into requestAnimationFrame, so a
 * burst of scroll events collapses into one measurement per frame.
 */
export function useScrollDirection() {
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down' | null>(null);
  const lastY = useRef(0);
  const lastDirection = useRef<'up' | 'down' | null>(null);

  useEffect(() => {
    lastY.current = window.pageYOffset;
    let queued = false;

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const y = window.pageYOffset;
        const delta = y - lastY.current;

        // Same 5px dead zone as before: ignore sub-threshold jitter, and don't
        // move lastY either, so slow drags still accumulate towards it.
        if (Math.abs(delta) <= 5) return;

        const direction = delta > 0 ? 'down' : 'up';
        if (direction !== lastDirection.current) {
          lastDirection.current = direction;
          setScrollDirection(direction);
        }
        lastY.current = y > 0 ? y : 0;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return scrollDirection;
}
