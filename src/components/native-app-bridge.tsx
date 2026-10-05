'use client';
// src/components/native-app-bridge.tsx
//
// App-wide behaviour for the iOS/Android builds. Renders nothing, and does
// nothing on the web.

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useTheme } from '@/contexts/theme-context';
import { logger } from '@/lib/logger';

export function NativeAppBridge() {
  const { resolvedTheme } = useTheme();

  // Android back button. Without a listener Capacitor closes the app on every
  // press, even mid-workout. Close an open dialog/sheet first (Radix closes on
  // Escape), then go back a page, and only leave the app from the first page.
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const handle = App.addListener('backButton', ({ canGoBack }) => {
      const openLayer = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]');
      if (openLayer) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });
    return () => {
      void handle.then(h => h.remove());
    };
  }, []);

  // Status bar icons follow the app's theme, not the phone's: dark icons on the
  // light theme, light icons on the dark theme. They used to be fixed dark, so
  // the clock and battery disappeared against the dark header.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: resolvedTheme === 'dark' ? Style.Dark : Style.Light }).catch(error =>
      logger.error('Status bar style failed', error),
    );
  }, [resolvedTheme]);

  return null;
}
