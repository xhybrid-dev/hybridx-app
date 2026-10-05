'use client';
// src/lib/native.ts
//
// Browser features that don't work inside the iOS/Android app WebView, with
// native replacements. On the web each helper does what the page did before.

import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Open a link to another site. In the apps it opens in an in-app browser sheet
 * (SFSafariViewController / Chrome Custom Tab) the athlete can close to get
 * back, rather than replacing the app's WebView or leaving the app.
 */
export async function openExternal(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Hand a generated file to the user. A web download (`<a download>`) does
 * nothing in the Android WebView, so the apps write the file to the cache and
 * open the share sheet instead, where it can be saved to Files/Drive or sent on.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title: filename, files: [uri] });
    } catch (error) {
      // Closing the share sheet without picking anything isn't a failed export.
      if (!isShareCancelled(error)) throw error;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Open the system share sheet. Returns false where none is available (desktop
 * browsers without the Web Share API) so the caller can fall back. The Android
 * WebView has no navigator.share, so the apps use the native sheet.
 */
export async function shareContent(content: { title?: string; text?: string; url?: string }): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    await Share.share(content);
    return true;
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share(content);
    return true;
  }
  return false;
}

/** True when a cancelled share sheet threw; that isn't an error worth logging. */
export function isShareCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|abort/i.test(message) || (error instanceof DOMException && error.name === 'AbortError');
}
