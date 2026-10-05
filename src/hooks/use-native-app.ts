'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * True inside the iOS/Android app builds. False on the server and on the first
 * client render, so server and client markup match; it flips after mount.
 *
 * The apps never sell or advertise memberships: Apple and Google require their
 * own in-app purchase for digital subscriptions sold in an app, so purchasing
 * happens on the website only. Existing members are recognised by their
 * account and keep full access in the apps.
 */
export function useIsNativeApp(): boolean {
  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
  }, []);
  return isNative;
}
