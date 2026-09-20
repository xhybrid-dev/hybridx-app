import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aiCopyKey, readAiCopy, writeAiCopy } from '../ai-copy-cache';

// The test environment is 'node', so there is no localStorage. These tests
// install a minimal in-memory stand-in, which also lets the failure cases
// (throwing / unavailable storage) be exercised directly.
function installStore(impl?: Partial<Storage>): Map<string, string> {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    ...impl,
  };
  vi.stubGlobal('localStorage', store);
  return map;
}

describe('aiCopyKey', () => {
  it('is stable for the same inputs', () => {
    expect(aiCopyKey('dashboard', 'u1', 'Programme', 5)).toBe(aiCopyKey('dashboard', 'u1', 'Programme', 5));
  });

  it('changes when any input changes', () => {
    const base = aiCopyKey('dashboard', 'u1', 'Programme', 5);
    expect(aiCopyKey('dashboard', 'u1', 'Programme', 6)).not.toBe(base);
    expect(aiCopyKey('dashboard', 'u1', 'Other', 5)).not.toBe(base);
    expect(aiCopyKey('dashboard', 'u2', 'Programme', 5)).not.toBe(base);
    expect(aiCopyKey('workout', 'u1', 'Programme', 5)).not.toBe(base);
  });

  it('treats an absent part as distinct from a present one', () => {
    // A note being cleared must not keep serving the copy written while it was set.
    expect(aiCopyKey('k', 'u', 'a', undefined)).not.toBe(aiCopyKey('k', 'u', 'a', 'x'));
    // Absent and empty deliberately DO collide: both mean "no notes".
    expect(aiCopyKey('k', 'u', 'a', undefined)).toBe(aiCopyKey('k', 'u', 'a', ''));
  });

  it('does not collide when adjacent parts shift a character between them', () => {
    // The separator is what makes this hold; plain concatenation would not.
    expect(aiCopyKey('k', 'u', 'ab', 'c')).not.toBe(aiCopyKey('k', 'u', 'a', 'bc'));
  });

  it('embeds the current date so yesterday’s copy is unreachable', () => {
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    const day1 = aiCopyKey('dashboard', 'u1', 'Programme');
    vi.setSystemTime(new Date('2026-03-02T10:00:00Z'));
    const day2 = aiCopyKey('dashboard', 'u1', 'Programme');
    expect(day1).not.toBe(day2);
  });
});

describe('readAiCopy / writeAiCopy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('round-trips a value', () => {
    installStore();
    const key = aiCopyKey('dashboard', 'u1', 'Programme');
    expect(readAiCopy(key)).toBeNull();
    writeAiCopy(key, 'Nice work this week.');
    expect(readAiCopy(key)).toBe('Nice work this week.');
  });

  it('prunes entries from previous days on write', () => {
    const map = installStore();
    const oldKey = aiCopyKey('dashboard', 'u1', 'Programme');
    writeAiCopy(oldKey, 'yesterday');
    expect(map.size).toBe(1);

    vi.setSystemTime(new Date('2026-03-02T10:00:00Z'));
    const newKey = aiCopyKey('dashboard', 'u1', 'Programme');
    writeAiCopy(newKey, 'today');

    expect(readAiCopy(newKey)).toBe('today');
    expect(map.has(oldKey)).toBe(false);
    expect(map.size).toBe(1);
  });

  it('leaves unrelated localStorage keys alone', () => {
    const map = installStore();
    map.set('cached_user', '{}');
    writeAiCopy(aiCopyKey('dashboard', 'u1', 'P'), 'x');
    expect(map.get('cached_user')).toBe('{}');
  });

  it('returns null rather than throwing when storage is unavailable', () => {
    installStore({ getItem: () => { throw new Error('SecurityError'); } });
    expect(readAiCopy('anything')).toBeNull();
  });

  it('swallows a write failure so a full quota cannot break the page', () => {
    installStore({ setItem: () => { throw new Error('QuotaExceededError'); } });
    expect(() => writeAiCopy('k', 'v')).not.toThrow();
  });
});
