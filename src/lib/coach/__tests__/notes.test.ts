import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, subDays } from 'date-fns';

// UTC-anchored: expiries are day markers pinned to UTC midnight, so a
// local-time TODAY would make these assertions depend on the test machine.
const TODAY = new Date('2026-09-07T09:00:00.000Z');

const noteDocs: Array<{ id: string; data: Record<string, any> }> = [];
const writes: Array<{ op: string; id?: string; data: Record<string, any> }> = [];

function stamp(date: Date) {
  return { toDate: () => date };
}

// Firestore stand-in: enough of the query builder and batch surface for the
// note service, recording writes so they can be asserted on.
vi.mock('@/lib/firebase-admin', () => {
  const docRef = (id: string) => ({ id });
  const collection = () => {
    const query: any = {
      where: () => query,
      limit: () => query,
      get: async () => ({
        docs: noteDocs.map(doc => ({ id: doc.id, data: () => doc.data, exists: true })),
        empty: noteDocs.length === 0,
      }),
      doc: (id?: string) => docRef(id ?? `generated-${writes.length}`),
    };
    return query;
  };

  return {
    getAdminDb: () => ({
      collection,
      batch: () => ({
        set: (ref: { id: string }, data: Record<string, any>) =>
          writes.push({ op: 'set', id: ref.id, data }),
        update: (ref: { id: string }, data: Record<string, any>) =>
          writes.push({ op: 'update', id: ref.id, data }),
        commit: async () => undefined,
      }),
      getAll: async (...refs: Array<{ id: string }>) =>
        refs.map(ref => {
          const found = noteDocs.find(doc => doc.id === ref.id);
          return { id: ref.id, exists: !!found, data: () => found?.data };
        }),
    }),
  };
});

describe('coach notes', () => {
  beforeEach(() => {
    noteDocs.length = 0;
    writes.length = 0;
  });

  it('gives short-lived categories an expiry and lasting ones none', async () => {
    const { defaultExpiry } = await import('@/services/coach-notes');

    expect(defaultExpiry('availability', TODAY)).toEqual(new Date('2026-10-07T00:00:00.000Z'));
    expect(defaultExpiry('commitment', TODAY)).toEqual(new Date('2026-09-28T00:00:00.000Z'));
    expect(defaultExpiry('goal', TODAY)).toBeNull();
    expect(defaultExpiry('preference', TODAY)).toBeNull();
  });

  it('never hands back a note that has stopped being true', async () => {
    noteDocs.push(
      {
        id: 'current',
        data: {
          userId: 'a1',
          category: 'availability',
          content: 'Away in Spain 12–19 September.',
          status: 'active',
          createdAt: stamp(subDays(TODAY, 1)),
          updatedAt: stamp(subDays(TODAY, 1)),
          expiresAt: stamp(addDays(TODAY, 12)),
        },
      },
      {
        id: 'stale',
        data: {
          userId: 'a1',
          category: 'availability',
          content: 'Away in France in July.',
          status: 'active',
          createdAt: stamp(subDays(TODAY, 60)),
          updatedAt: stamp(subDays(TODAY, 60)),
          expiresAt: stamp(subDays(TODAY, 5)),
        },
      },
    );

    const { getActiveNotes } = await import('@/services/coach-notes');
    const notes = await getActiveNotes('a1', TODAY);

    expect(notes.map(note => note.id)).toEqual(['current']);
  });

  it('renders notes for a prompt with their category, window and age', async () => {
    const { formatNotesForPrompt } = await import('@/services/coach-notes');

    const text = formatNotesForPrompt(
      [
        {
          id: 'n1',
          userId: 'a1',
          category: 'availability',
          content: 'Away in Spain 12–19 September.',
          source: 'chat',
          status: 'active',
          createdAt: subDays(TODAY, 2),
          updatedAt: subDays(TODAY, 2),
          expiresAt: addDays(TODAY, 12),
          pausesTraining: false,
        },
      ],
      TODAY,
    );

    expect(text).toContain('[availability]');
    expect(text).toContain('Away in Spain 12–19 September.');
    expect(text).toContain('through 2026-09-19');
    expect(text).toContain('noted 2 days ago');
  });

  it('says nothing when there is nothing remembered', async () => {
    const { formatNotesForPrompt } = await import('@/services/coach-notes');
    expect(formatNotesForPrompt([], TODAY)).toBeNull();
  });

  it('adds a new note with the default expiry for its category', async () => {
    const { applyNoteWrites } = await import('@/services/coach-notes');

    const counts = await applyNoteWrites(
      'a1',
      [{ action: 'add', category: 'commitment', content: 'Committed to three sessions this week.' }],
      { now: TODAY },
    );

    expect(counts.added).toBe(1);
    const written = writes.find(write => write.op === 'set');
    expect(written?.data.content).toBe('Committed to three sessions this week.');
    expect(written?.data.userId).toBe('a1');
    expect(written?.data.expiresAt.toDate()).toEqual(new Date('2026-09-28T00:00:00.000Z'));
  });

  it('honours an end date the athlete actually gave', async () => {
    const { applyNoteWrites } = await import('@/services/coach-notes');

    await applyNoteWrites(
      'a1',
      [
        {
          action: 'add',
          category: 'availability',
          content: 'Away in Spain 12–19 September.',
          expiresAt: '2026-09-19',
        },
      ],
      { now: TODAY },
    );

    const written = writes.find(write => write.op === 'set');
    expect(written?.data.expiresAt.toDate().toISOString().slice(0, 10)).toBe('2026-09-19');
  });

  it("never writes over a note belonging to someone else", async () => {
    noteDocs.push({
      id: 'someone-elses',
      data: {
        userId: 'other-athlete',
        category: 'constraint',
        content: 'Sore knee.',
        status: 'active',
        createdAt: stamp(TODAY),
        updatedAt: stamp(TODAY),
        expiresAt: null,
      },
    });

    const { applyNoteWrites } = await import('@/services/coach-notes');
    const counts = await applyNoteWrites(
      'a1',
      [
        { action: 'resolve', id: 'someone-elses' },
        { action: 'update', id: 'someone-elses', content: 'Knee is fine now.' },
      ],
      { now: TODAY },
    );

    expect(counts.resolved).toBe(0);
    expect(counts.updated).toBe(0);

    // The resolve is dropped outright. The update can't touch the other
    // athlete's note either — its content lands as a fresh note owned by the
    // athlete this extraction was actually about.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ op: 'set' });
    expect(writes[0].data.userId).toBe('a1');
    expect(writes[0].data.content).toBe('Knee is fine now.');
  });

  it('resolves and updates the athlete\'s own notes', async () => {
    noteDocs.push({
      id: 'mine',
      data: {
        userId: 'a1',
        category: 'constraint',
        content: 'Right knee sore on lunges.',
        status: 'active',
        createdAt: stamp(subDays(TODAY, 10)),
        updatedAt: stamp(subDays(TODAY, 10)),
        expiresAt: null,
      },
    });

    const { applyNoteWrites } = await import('@/services/coach-notes');
    const counts = await applyNoteWrites('a1', [{ action: 'resolve', id: 'mine' }], { now: TODAY });

    expect(counts.resolved).toBe(1);
    expect(writes[0]).toMatchObject({ op: 'update', id: 'mine' });
    expect(writes[0].data.status).toBe('resolved');
  });

  it('keeps a note current through the whole of its last day', async () => {
    const { isCurrent } = await import('@/services/coach-notes');
    const through = { expiresAt: new Date('2026-09-07T00:00:00.000Z') };

    expect(isCurrent(through, TODAY)).toBe(true);
    expect(isCurrent(through, new Date('2026-09-08T00:00:01.000Z'))).toBe(false);
    expect(isCurrent({ expiresAt: null }, TODAY)).toBe(true);
  });

  it('knows when the athlete is on time off, and when that has ended', async () => {
    const { activeTrainingPause } = await import('@/services/coach-notes');
    const note = (overrides: Record<string, any>) => ({
      id: 'n',
      userId: 'a1',
      category: 'constraint' as const,
      content: 'Ill with flu; taking the week off.',
      source: 'voice' as const,
      status: 'active' as const,
      createdAt: TODAY,
      updatedAt: TODAY,
      expiresAt: addDays(TODAY, 3),
      pausesTraining: true,
      ...overrides,
    });

    expect(activeTrainingPause([note({})], TODAY)?.content).toBe('Ill with flu; taking the week off.');
    // A niggle they're training around is not time off.
    expect(activeTrainingPause([note({ pausesTraining: false })], TODAY)).toBeNull();
    expect(activeTrainingPause([note({ expiresAt: subDays(TODAY, 2) })], TODAY)).toBeNull();
  });

  it('gives time off an end even when the athlete named none', async () => {
    const { applyNoteWrites } = await import('@/services/coach-notes');

    await applyNoteWrites(
      'a1',
      [{ action: 'add', category: 'context', content: 'Family commitments; not training for now.', pausesTraining: true }],
      { now: TODAY },
    );

    const written = writes.find(write => write.op === 'set');
    expect(written?.data.pausesTraining).toBe(true);
    // A week, not the 45 days a context note would otherwise get.
    expect(written?.data.expiresAt.toDate()).toEqual(new Date('2026-09-14T00:00:00.000Z'));
  });

  it("doesn't end time off just because the note's wording was edited", async () => {
    noteDocs.push({
      id: 'off',
      data: {
        userId: 'a1',
        category: 'constraint',
        content: 'Ill this week.',
        status: 'active',
        pausesTraining: true,
        createdAt: stamp(TODAY),
        updatedAt: stamp(TODAY),
        expiresAt: stamp(addDays(TODAY, 5)),
      },
    });

    const { applyNoteWrites } = await import('@/services/coach-notes');
    await applyNoteWrites(
      'a1',
      [{ action: 'update', id: 'off', category: 'constraint', content: 'Ill with flu this week.', expiresAt: '2026-09-13' }],
      { now: TODAY },
    );

    expect(writes[0]).toMatchObject({ op: 'update', id: 'off' });
    expect(writes[0].data.pausesTraining).toBe(true);
  });

  it('ignores writes with nothing in them', async () => {
    const { applyNoteWrites } = await import('@/services/coach-notes');
    const counts = await applyNoteWrites('a1', [{ action: 'add', content: '   ' }], { now: TODAY });

    expect(counts).toEqual({ added: 0, updated: 0, resolved: 0 });
    expect(writes).toHaveLength(0);
  });
});
