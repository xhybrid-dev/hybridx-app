'use client';

import { useEffect, useState } from 'react';
import { isChunkLoadError, reloadForNewVersion } from '@/lib/chunk-reload';

/**
 * For an error boundary. When the error is a missing chunk from a build that's
 * since been replaced, reloads onto the current one (see lib/chunk-reload.ts).
 *
 * `updating` is true while that reload is on its way, so the boundary can say
 * so instead of flashing an error. `retry` is what Try Again should do: a real
 * reload for a stale build, since re-rendering the old code fails the same way.
 */
export function useStaleBuildRecovery(error: Error, reset: () => void) {
  const stale = isChunkLoadError(error);
  const [updating, setUpdating] = useState(stale);

  useEffect(() => {
    setUpdating(stale && reloadForNewVersion());
  }, [error, stale]);

  return {
    updating,
    retry: stale ? () => window.location.reload() : reset,
  };
}
