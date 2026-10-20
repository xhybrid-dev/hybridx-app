import { describe, it, expect } from 'vitest';
import { toJsonSchema } from '@genkit-ai/core/schema';
import { aiEmailContentSchema, toEmailBlocks } from '@/lib/marketing/blocks';

/**
 * The measured ceiling on the blocks array.
 *
 * Drafting failed with a bare 400 INVALID_ARGUMENT for as long as this array
 * was capped at 20. Laddering the bound against the live API, with the block
 * schema and prompt held constant, put the boundary here:
 *
 *     3, 5, 8, 10, 12  pass
 *     15, 20           fail
 *
 * 12 is therefore the highest value observed to work, and the shipped cap of
 * 10 leaves headroom. This test fails if someone raises the cap past what was
 * actually measured — the failure mode is a total outage of drafting, and the
 * API names no field, so it is not a cheap thing to rediscover.
 *
 * Adding properties to aiBlockSchema also grows the grammar this bound
 * interacts with, so a schema change means re-measuring rather than trusting
 * this number.
 */
const HIGHEST_MEASURED_WORKING_CAP = 12;

describe('aiEmailContentSchema stays inside Gemini structured-output limits', () => {
  it('caps the blocks array at or below the highest measured working bound', () => {
    const schema = toJsonSchema({ schema: aiEmailContentSchema }) as {
      properties: { blocks: { maxItems?: number } };
    };
    const cap = schema.properties.blocks.maxItems;

    expect(cap).toBeDefined();
    expect(cap).toBeLessThanOrEqual(HIGHEST_MEASURED_WORKING_CAP);
  });

  it('still asks for enough blocks to build a real email', () => {
    const schema = toJsonSchema({ schema: aiEmailContentSchema }) as {
      properties: { blocks: { maxItems?: number } };
    };
    // The prompt asks for six to ten blocks; a cap below that would silently
    // truncate every draft, which is a quieter failure than the 400 was.
    expect(schema.properties.blocks.maxItems).toBeGreaterThanOrEqual(10);
  });
});

describe('toEmailBlocks', () => {
  it('narrows well-formed flat blocks into the strict union', () => {
    const { blocks, rejected } = toEmailBlocks([
      { type: 'hero', heading: 'Back to the start line' },
      { type: 'paragraph', text: 'Hi [First Name].' },
      { type: 'cta', label: 'Resume', url: 'https://app.hybridx.club/dashboard' },
      { type: 'divider' },
    ] as never);

    expect(rejected).toEqual([]);
    expect(blocks.map((b) => b.type)).toEqual(['hero', 'paragraph', 'cta', 'divider']);
  });

  it('defaults an omitted heading level rather than dropping the block', () => {
    const { blocks } = toEmailBlocks([{ type: 'heading', text: 'What changed' }] as never);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { level: number }).level).toBe(2);
  });

  it('clamps an out-of-range heading level instead of dropping the block', () => {
    const { blocks, rejected } = toEmailBlocks([
      { type: 'heading', text: 'Too deep', level: 5 },
      { type: 'heading', text: 'Too shallow', level: 1 },
      { type: 'heading', text: 'Fractional', level: 2.6 },
    ] as never);

    expect(rejected).toEqual([]);
    expect(blocks.map((b) => (b as { level: number }).level)).toEqual([3, 2, 3]);
  });

  it('recovers heading text the model put in the "heading" field', () => {
    // The collision the flat schema creates: a block of type `heading` keeps
    // its words in `text`, but there is also a field named `heading` (hero's).
    // Models write into the one that shares the type's name, and the block was
    // dropped for a missing `text` it had in fact written.
    const { blocks, rejected } = toEmailBlocks([
      { type: 'heading', heading: 'What changed this month' },
    ] as never);

    expect(rejected).toEqual([]);
    expect(blocks[0]).toEqual({ type: 'heading', text: 'What changed this month', level: 2 });
  });

  it('recovers hero text put in "text" instead of "heading"', () => {
    const { blocks, rejected } = toEmailBlocks([
      { type: 'hero', text: 'Back to the start line' },
    ] as never);

    expect(rejected).toEqual([]);
    expect(blocks[0]).toEqual({ type: 'hero', heading: 'Back to the start line' });
  });

  it('prefers the correct field when both are present', () => {
    const { blocks } = toEmailBlocks([
      { type: 'heading', text: 'Right one', heading: 'Wrong one' },
    ] as never);
    expect((blocks[0] as { text: string }).text).toBe('Right one');
  });

  it('still drops a block whose missing field cannot be recovered', () => {
    // The line the repair must not cross. A cta with no url has no text to
    // move — inventing a link would put a broken one in front of a subscriber.
    const { blocks, rejected } = toEmailBlocks([{ type: 'cta', label: 'Go' }] as never);
    expect(blocks).toEqual([]);
    expect(rejected[0].reason).toContain('url');
  });

  it('drops a block missing a field its own type requires, with a reason', () => {
    const { blocks, rejected } = toEmailBlocks([
      { type: 'cta', label: 'Broken' },
      { type: 'programCard', programName: 'HYROX Base' },
    ] as never);

    expect(blocks).toEqual([]);
    expect(rejected.map((r) => r.type)).toEqual(['cta', 'programCard']);
    expect(rejected[0].reason).toContain('url');
    expect(rejected[1].reason).toContain('description');
  });

  it('strips fields belonging to a different variant', () => {
    // The flat shape lets the model attach any field to any block; a leftover
    // cta url must not ride along on a paragraph into storage.
    const { blocks } = toEmailBlocks([
      { type: 'paragraph', text: 'Clean me', label: 'stale', url: 'https://x.test' },
    ] as never);

    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'Clean me' });
  });

  it('ignores explicit nulls the model sends for unused fields', () => {
    const { blocks, rejected } = toEmailBlocks([
      { type: 'paragraph', text: 'Still fine', heading: null, items: null },
    ] as never);

    expect(rejected).toEqual([]);
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'Still fine' });
  });
});

describe('toEmailBlocks with salvage', () => {
  it('keeps an incomplete block in place with a blank for the gap', () => {
    const { blocks, rejected, salvaged } = toEmailBlocks(
      [
        { type: 'paragraph', text: 'Before' },
        { type: 'cta', label: 'Go' },
        { type: 'paragraph', text: 'After' },
      ] as never,
      { salvage: true },
    );
    expect(rejected).toEqual([]);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'cta', 'paragraph']);
    expect(blocks[1]).toMatchObject({ type: 'cta', label: 'Go', url: '' });
    expect(salvaged).toEqual([expect.objectContaining({ index: 1, type: 'cta' })]);
  });

  it('never invents a value for the gap', () => {
    const { blocks } = toEmailBlocks([{ type: 'statRow' }] as never, { salvage: true });
    expect(blocks[0]).toMatchObject({ stats: [{ value: '', label: '' }, { value: '', label: '' }] });
  });
});

