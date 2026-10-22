'use client';
// src/components/zoom-lock.tsx
//
// Stops pinch-zoom everywhere (the browser, the home-screen app and the iOS/
// Android builds). Renders nothing.
//
// iOS Safari ignores `user-scalable=no` / `maximum-scale` in the viewport tag,
// so the viewport alone doesn't hold there. It does fire gesture* events for
// pinches, and cancelling them is what actually stops the zoom.

import { useEffect } from 'react';

export function ZoomLock() {
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    // Browsers that don't fire gesture* events: cancel any two-finger move.
    const blockMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    // preventDefault is ignored on passive listeners.
    const opts = { passive: false } as const;

    document.addEventListener('gesturestart', block, opts);
    document.addEventListener('gesturechange', block, opts);
    document.addEventListener('gestureend', block, opts);
    document.addEventListener('touchmove', blockMultiTouch, opts);
    return () => {
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
      document.removeEventListener('gestureend', block);
      document.removeEventListener('touchmove', blockMultiTouch);
    };
  }, []);

  return null;
}
