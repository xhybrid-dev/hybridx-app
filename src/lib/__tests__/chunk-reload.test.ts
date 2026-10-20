import { describe, expect, it, vi } from 'vitest';

import { isChunkLoadError, reloadForNewVersion, RELOAD_COOLDOWN_MS } from '@/lib/chunk-reload';

describe('isChunkLoadError', () => {
  it("recognises webpack's missing-chunk error, the one a stale home-screen app hits after a deploy", () => {
    const error = Object.assign(
      new Error('Loading chunk 6671 failed. (error: https://app.hybridx.club/_next/static/chunks/6671.38b7744b45bfe98a.js)'),
      { name: 'ChunkLoadError' },
    );
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('recognises the message even when the name was lost on the way', () => {
    expect(isChunkLoadError(new Error('Loading chunk 6671 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 312 failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/y.js'))).toBe(true);
  });

  it('leaves every other error alone', () => {
    expect(isChunkLoadError(new Error('Missing or insufficient permissions.'))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError('Loading chunk 1 failed')).toBe(false);
  });
});

describe('reloadForNewVersion', () => {
  const memoryStorage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };

  it('reloads the first time', () => {
    const reload = vi.fn();
    expect(reloadForNewVersion({ storage: memoryStorage(), now: 1_000_000, reload })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload again straight after reloading, so a broken deploy shows its error instead of looping', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForNewVersion({ storage, now: 1_000_000, reload });

    expect(reloadForNewVersion({ storage, now: 1_000_000 + RELOAD_COOLDOWN_MS - 1, reload })).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads for the next deploy once the cooldown has passed', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForNewVersion({ storage, now: 1_000_000, reload });

    expect(reloadForNewVersion({ storage, now: 1_000_000 + RELOAD_COOLDOWN_MS, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads when it cannot remember having done so', () => {
    const reload = vi.fn();
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} };

    expect(reloadForNewVersion({ storage: null, now: 1_000_000, reload })).toBe(false);
    expect(reloadForNewVersion({ storage: blocked, now: 1_000_000, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
