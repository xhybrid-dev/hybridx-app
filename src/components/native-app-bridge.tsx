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

  // The status bar follows the app's theme, not the phone's: dark icons on a
  // white bar for the light theme, light icons on a near-black bar for the dark
  // one. The bar sits above the web view (overlaysWebView: false), so its
  // background is native and has to be set here too; it used to stay white
  // from capacitor.config.ts, leaving light icons invisible on a white band
  // above the dark header. Colours match the header (--card in globals.css).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const dark = resolvedTheme === 'dark';
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(error =>
      logger.error('Status bar style failed', error),
    );
    StatusBar.setBackgroundColor({ color: dark ? '#0A0A0A' : '#FFFFFF' }).catch(error =>
      logger.error('Status bar colour failed', error),
    );
  }, [resolvedTheme]);

  return null;
}
