// src/lib/concurrency.ts
//
// Bounded parallelism for cron jobs that fan out per user.
//
// `Promise.all(users.map(...))` is the obvious shape and the wrong one once the
// work inside makes a network call. It starts every request at once, so a job
// that behaves fine with twenty users floods a provider at two thousand and
// comes back rate-limited — and the failure arrives all at once, at 3am, on the
// run nobody is watching.

/**
 * Map over items with at most `limit` operations in flight.
 *
 * Results keep the input order regardless of completion order. A rejection
 * propagates, as with Promise.all — callers that want partial success should
 * catch inside `fn`, which is what the cron routes do so one bad user cannot
 * abandon the rest of the run.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  // A non-positive limit would spawn no workers and hang forever. Treat it as
  // sequential, which is the safest reading of "no more than zero at a time".
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));

  const results = new Array<R>(items.length);
  let next = 0;

  async function work(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, work));
  return results;
}

/**
 * Wraps `run` so only one call is in flight at a time.
 *
 * A call made while one is running does not share it: that run may have read
 * its data before the caller's own write landed. It gets one more run after
 * the current one instead, shared with every other caller that arrives in the
 * meantime. So awaiting the result always means "a run that started after I
 * asked has finished".
 */
export function singleFlightWithFollowUp(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  const call = (): Promise<void> => {
    if (!inFlight) {
      inFlight = new Promise<void>(resolve => resolve(run())).finally(() => { inFlight = null; });
      return inFlight;
    }
    if (!followUp) {
      followUp = inFlight
        .catch(() => undefined)
        .then(() => {
          followUp = null;
          return call();
        });
    }
    return followUp;
  };
  return call;
}
