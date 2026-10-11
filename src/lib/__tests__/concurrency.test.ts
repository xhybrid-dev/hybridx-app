import { describe, it, expect } from 'vitest';
import { mapWithLimit, singleFlightWithFollowUp } from '@/lib/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('mapWithLimit', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapWithLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('never exceeds the limit — the property the AI rate limit depends on', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithLimit(Array.from({ length: 25 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
  });

  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithLimit(Array.from({ length: 50 }, (_, i) => i), 7, async (n) => {
      await tick();
      seen.push(n);
    });
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it('handles an empty list without spawning workers', async () => {
    expect(await mapWithLimit([], 4, async () => 1)).toEqual([]);
  });

  it('does not hang on a zero or negative limit', async () => {
    // A naive pool spawns `limit` workers and awaits them; at zero that is an
    // empty Promise.all resolving instantly with nothing done, or a deadlock.
    expect(await mapWithLimit([1, 2, 3], 0, async (n) => n * 2)).toEqual([2, 4, 6]);
    expect(await mapWithLimit([1, 2, 3], -5, async (n) => n * 2)).toEqual([2, 4, 6]);
  });

  it('caps workers at the item count', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithLimit([1, 2], 100, async () => {
      inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('propagates a rejection, as Promise.all does', async () => {
    await expect(
      mapWithLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('singleFlightWithFollowUp', () => {
  // A controllable run: each call starts a new run and records it.
  const harness = () => {
    const runs: { resolve: () => void; reject: (e: Error) => void }[] = [];
    const refresh = singleFlightWithFollowUp(() => new Promise<void>((resolve, reject) => { runs.push({ resolve, reject }); }));
    return { runs, refresh };
  };

  it('a caller arriving mid-run waits for a fresh run, not the one already going', async () => {
    const { runs, refresh } = harness();
    const first = refresh();
    const second = refresh();
    expect(runs).toHaveLength(1);

    runs[0].resolve();
    await first;
    await tick();
    // The second caller's write may have landed after run 1 read, so run 2 starts.
    expect(runs).toHaveLength(2);

    let secondDone = false;
    void second.then(() => { secondDone = true; });
    await tick();
    expect(secondDone).toBe(false);
    runs[1].resolve();
    await second;
  });

  it('shares one follow-up between every caller that arrives mid-run', async () => {
    const { runs, refresh } = harness();
    const first = refresh();
    const queued = [refresh(), refresh(), refresh()];

    runs[0].resolve();
    await first;
    await tick();
    expect(runs).toHaveLength(2);
    runs[1].resolve();
    await Promise.all(queued);
    expect(runs).toHaveLength(2);
  });

  it('still runs the follow-up when the current run fails', async () => {
    const { runs, refresh } = harness();
    const first = refresh();
    const second = refresh();

    runs[0].reject(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await tick();
    expect(runs).toHaveLength(2);
    runs[1].resolve();
    await expect(second).resolves.toBeUndefined();
  });
});
