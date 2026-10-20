// src/lib/chunk-reload.ts
//
// After a deploy, a page still running the previous build asks for that
// build's lazily loaded chunks, and the server no longer has them: each
// rollout serves only its own files, and the service worker (skipWaiting)
// drops the old build's precache as soon as the new one takes over. Nothing on
// that page can recover — "Try Again" re-renders the same stale code — so the
// fix is a full reload onto the current build. A home-screen app or the native
// shell has no refresh button to do that with, so the app does it itself.

const RELOAD_KEY = 'hx-chunk-reload-at';

/** A chunk failing again this soon after a reload isn't a stale page: the deploy itself is broken. */
export const RELOAD_COOLDOWN_MS = 30_000;

const CHUNK_ERROR_MESSAGES = [
  /Loading (CSS )?chunk [\w-]+ failed/i,          // webpack
  /Failed to fetch dynamically imported module/i,  // Chrome, native import()
  /Importing a module script failed/i,             // Safari
  /error loading dynamically imported module/i,    // Firefox
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string' && CHUNK_ERROR_MESSAGES.some(pattern => pattern.test(message));
}

interface ReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: number;
  reload: () => void;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reloads onto the current build, unless it already did so moments ago.
 * Returns whether it reloaded. Without session storage there's no way to tell
 * a stale page from a broken deploy, which would reload forever, so it doesn't.
 */
export function reloadForNewVersion({
  storage = sessionStorageOrNull(),
  now = Date.now(),
  reload = () => window.location.reload(),
}: Partial<ReloadDeps> = {}): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
