import { beforeEach, describe, expect, it, vi } from 'vitest';

let stored: Record<string, any> | null = null;
const updates: Array<Record<string, any>> = [];

/** Firestore refuses `undefined` anywhere in a write; so does this stand-in. */
function assertNoUndefined(value: unknown, path = ''): void {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}")`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${path}.${index}`));
  else if (value && typeof value === 'object' && !(value instanceof Date) && !('toDate' in (value as object))) {
    for (const [key, item] of Object.entries(value)) assertNoUndefined(item, path ? `${path}.${key}` : key);
  }
}

vi.mock('@/lib/firebase-admin', () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ exists: !!stored, id, data: () => stored }),
        update: async (data: Record<string, any>) => {
          assertNoUndefined(data);
          updates.push(data);
        },
      }),
    }),
  }),
}));

describe('appendExchange', () => {
  beforeEach(() => {
    updates.length = 0;
    stored = {
      userId: 'a1',
      title: 'Ultra recovery',
      createdAt: new Date('2026-09-20T08:00:00Z'),
      updatedAt: new Date('2026-09-20T08:00:01Z'),
      messages: [
        // An athlete message has no `consulted`; a coach reply without lookups neither.
        { role: 'user', content: 'Week off after my 50k.', createdAt: '2026-09-20T08:00:00.000Z' },
        { role: 'assistant', content: 'Enjoy it.', createdAt: '2026-09-20T08:00:00.001Z' },
        { role: 'user', content: 'Legs gone', createdAt: '2026-09-21T08:00:00.000Z', kind: 'voice', about: 'Engine Builder' },
        { role: 'assistant', content: 'Easy day.', createdAt: '2026-09-21T08:00:00.001Z', consulted: ['your notes'] },
      ],
    };
  });

  it('continues an existing thread without writing undefined fields', async () => {
    const { appendExchange } = await import('@/services/coach-conversation');

    const id = await appendExchange({
      userId: 'a1',
      conversationId: 'thread-1',
      userMessage: 'Starting ATHX on Monday.',
      assistantMessage: 'Good — we build the strength back gradually.',
    });

    expect(id).toBe('thread-1');
    expect(updates).toHaveLength(1);
    const messages = updates[0].messages;
    expect(messages).toHaveLength(6);
    expect(messages[0]).toEqual({ role: 'user', content: 'Week off after my 50k.', createdAt: '2026-09-20T08:00:00.000Z' });
    // What was there is kept.
    expect(messages[2]).toMatchObject({ kind: 'voice', about: 'Engine Builder' });
    expect(messages[3].consulted).toEqual(['your notes']);
    expect(messages[5].content).toBe('Good — we build the strength back gradually.');
  });
});
