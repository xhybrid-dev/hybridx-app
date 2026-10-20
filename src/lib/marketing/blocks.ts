// src/lib/marketing/blocks.ts
//
// The structured content model for emails.
//
// HXMailer's AI styler returned a raw `styledHtml` string. That is the wrong
// output shape for three reasons:
//
//   - Email HTML is not web HTML. It needs tables, inline styles and Outlook
//     conditionals; a model regenerating it wholesale gets it subtly wrong in a
//     different way every time.
//   - The brand drifts. Every regeneration is a fresh chance to invent a new
//     shade, a new button radius, a new heading size.
//   - Editing means editing HTML. Changing one paragraph meant hand-editing a
//     markup blob, or regenerating the whole email and losing everything else.
//
// So the model chooses *structure and words* and nothing else. It emits a typed
// block array; render.ts turns that into email-safe HTML from one template that
// owns every visual decision. Branding is then correct by construction, any
// block is independently editable, and a brand change re-renders every campaign
// instead of needing forty emails rewritten.

import { z } from 'zod';

// A note on `z.enum(['hero'])` where `z.literal('hero')` would read better.
//
// This was changed while chasing a 400 INVALID_ARGUMENT on drafting, on the
// theory that `z.literal()`'s `{"const": "hero"}` was being rejected. That
// theory was wrong — the real cause was the cap on the blocks array, measured
// later (see aiEmailContentSchema). `const` is genuinely absent from the
// schema subset Gemini documents, so this is still correct, and `z.enum` of a
// single value infers the identical `'hero'` type; it simply was not the bug.
//
// Recorded because the wrong explanation is worse than none: anyone reading
// this later should not conclude that `const` breaks drafting.

/** Merge tokens usable inside any text field. Resolved per recipient at send time. */
export const MERGE_TOKEN_HINT =
  'You may use [First Name], [Last Name], [Full Name] and [Email] as merge tokens in any text.';

const hero = z.object({
  type: z.enum(['hero']),
  heading: z.string().describe('Short, punchy headline. Under 60 characters.'),
  subheading: z.string().optional().describe('One supporting sentence.'),
  imageUrl: z.string().optional().describe('Absolute https URL of a hero image.'),
});

const heading = z.object({
  type: z.enum(['heading']),
  text: z.string(),
  level: z.number().int().min(2).max(3).default(2),
});

const paragraph = z.object({
  type: z.enum(['paragraph']),
  text: z.string().describe('One paragraph of body copy. Plain text; no HTML.'),
});

const bulletList = z.object({
  type: z.enum(['bulletList']),
  items: z.array(z.string()).min(1).max(8),
});

const cta = z.object({
  type: z.enum(['cta']),
  label: z.string().describe('Button text. Two to four words, action-led.'),
  url: z.string().describe('Absolute https URL.'),
});

const image = z.object({
  type: z.enum(['image']),
  url: z.string(),
  alt: z.string().describe('Alt text. Required — many clients block images by default.'),
  linkUrl: z.string().optional(),
});

const divider = z.object({ type: z.enum(['divider']) });

const programCard = z.object({
  type: z.enum(['programCard']),
  programName: z.string().describe('Must exactly match a programme from the supplied facts.'),
  description: z.string(),
  url: z.string().optional(),
});

const statRow = z.object({
  type: z.enum(['statRow']),
  stats: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .min(2)
    .max(3)
    .describe('Only figures present in the supplied facts, or the recipient\'s own data.'),
});

const quote = z.object({
  type: z.enum(['quote']),
  text: z.string(),
  attribution: z.string().optional(),
});

/**
 * Escape hatch for hand-built emails and for campaigns migrated from HXMailer,
 * which are HTML-only. Never produced by the AI flows — the whole point of the
 * block model is that generated content cannot emit arbitrary markup.
 */
const rawHtml = z.object({
  type: z.enum(['rawHtml']),
  html: z.string(),
});

export const emailBlockSchema = z.discriminatedUnion('type', [
  hero,
  heading,
  paragraph,
  bulletList,
  cta,
  image,
  divider,
  programCard,
  statRow,
  quote,
  rawHtml,
]);

export type EmailBlock = z.infer<typeof emailBlockSchema>;
export type EmailBlockType = EmailBlock['type'];

/** The blocks an AI flow may emit — rawHtml is deliberately excluded. */
export const generatableBlockSchema = z.discriminatedUnion('type', [
  hero,
  heading,
  paragraph,
  bulletList,
  cta,
  image,
  divider,
  programCard,
  statRow,
  quote,
]);

/** A block an AI flow may emit — the union above minus rawHtml. */
export type GeneratableBlock = z.infer<typeof generatableBlockSchema>;

export const emailContentSchema = z.object({
  subject: z.string().describe('Subject line. Under 60 characters so inboxes do not truncate it.'),
  previewText: z
    .string()
    .describe('Preheader shown after the subject in the inbox. One short sentence.'),
  blocks: z.array(generatableBlockSchema).min(2).max(20),
});

export type EmailContent = z.infer<typeof emailContentSchema>;

// ---------------------------------------------------------------------------
// The AI-facing shape
// ---------------------------------------------------------------------------
//
// Everything above is the real model: a discriminated union, where a `cta` is
// guaranteed to carry a `url` and a `quote` cannot. That is what storage and
// render.ts work with, and it stays strict.
//
// What Gemini is asked for is one flat object per block — a `type` enum plus
// every field any variant might need, all optional — narrowed back into the
// strict union by `toEmailBlocks` below. The looseness is confined to the API
// boundary; nothing downstream sees it.
//
// Honest history: this was flattened on the theory that the union's `anyOf`
// was what Gemini rejected. It was not; the blocks array cap was. But the flat
// shape stays, for two reasons. It was never shown to be *wrong*, and the
// measured cause was grammar size — a ten-branch `anyOf` unrolled across the
// array would be a considerably larger grammar than one flat object, so
// restoring the union would most likely lower the usable cap rather than
// raise it. Reverting it would trade a working schema for an untested one.

/** Every block type an AI flow may emit. Order matches the union above. */
export const GENERATABLE_BLOCK_TYPES = [
  'hero',
  'heading',
  'paragraph',
  'bulletList',
  'cta',
  'image',
  'divider',
  'programCard',
  'statRow',
  'quote',
] as const;

/**
 * One block as Gemini is asked to produce it. Flat and permissive by
 * necessity — `toEmailBlocks` is what enforces the real per-type rules.
 */
export const aiBlockSchema = z.object({
  type: z.enum(GENERATABLE_BLOCK_TYPES).describe('Which kind of block this is.'),
  // hero
  heading: z.string().optional().describe('hero: short, punchy headline, under 60 characters.'),
  subheading: z.string().optional().describe('hero: one supporting sentence.'),
  imageUrl: z.string().optional().describe('hero: absolute https URL of a hero image.'),
  // heading, paragraph, quote
  text: z.string().optional().describe('heading/paragraph/quote: the text itself. Plain text; no HTML.'),
  // Deliberately an unconstrained number, not .int().min(2).max(3).
  //
  // `minimum`/`maximum` were the only JSON Schema keywords this schema used
  // that compose-journey's — which Gemini accepts in this same deployment —
  // does not. Rather than keep guessing which keyword the 400 is about, this
  // schema now uses a strict subset of the keyword set that is provably
  // working. toEmailBlocks clamps the value instead, so a stray 5 costs a
  // heading level rather than the whole block.
  level: z.number().optional().describe('heading: 2 for a section, 3 for a sub-section. Use 2 or 3 only.'),
  // bulletList
  items: z.array(z.string()).optional().describe('bulletList: two to eight short points.'),
  // cta
  label: z.string().optional().describe('cta: button text. Two to four words, action-led.'),
  // cta, image, programCard
  url: z.string().optional().describe('cta/image/programCard: absolute https URL.'),
  // image
  alt: z.string().optional().describe('image: alt text. Required — many clients block images.'),
  linkUrl: z.string().optional().describe('image: optional absolute https URL to link the image to.'),
  // programCard
  programName: z.string().optional().describe('programCard: must exactly match a programme from the facts.'),
  description: z.string().optional().describe('programCard: one or two sentences about the programme.'),
  // statRow
  stats: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional()
    .describe('statRow: two or three figures. Only figures present in the supplied facts.'),
  // quote
  attribution: z.string().optional().describe('quote: who said it.'),
});

/** What a drafting flow asks Gemini for. */
export const aiEmailContentSchema = z.object({
  subject: z.string().describe('Subject line. Under 60 characters so inboxes do not truncate it.'),
  previewText: z
    .string()
    .describe('Preheader shown after the subject in the inbox. One short sentence.'),
  // The cap is load-bearing, and 10 is not arbitrary.
  //
  // This array at maxItems 20 is what made every draft fail with a bare 400
  // INVALID_ARGUMENT. Measured against the live API by laddering the bound
  // with everything else held constant:
  //
  //     3, 5, 8, 10, 12  pass
  //     15, 20           fail
  //
  // So the limit sits between 12 and 15, and it is about the *bound*, not the
  // block schema: the same block schema capped at 3 always passed, and adding
  // subject/previewText at cap 3 still passed. Gemini names no field in the
  // 400, which fits a constrained-decoding grammar-size limit — the item
  // schema carries 14 optional properties, and the grammar is unrolled per
  // permitted element.
  //
  // 10 keeps clear headroom under the boundary and is what the prompt has
  // always asked for ("six to ten blocks"). Raising it needs re-measuring, and
  // so does adding fields to aiBlockSchema, since that grows the same grammar.
  blocks: z.array(aiBlockSchema).min(2).max(10),
});

export type AiEmailContent = z.infer<typeof aiEmailContentSchema>;

export interface NarrowedBlocks {
  /** Narrowed against generatableBlockSchema, so never a rawHtml block. */
  blocks: GeneratableBlock[];
  /** Blocks the model produced that do not satisfy their own type's rules. */
  rejected: { type: string; reason: string }[];
  /**
   * With `salvage`, blocks kept in `blocks` (at `index`) with blank placeholders
   * for what the model left out, so the reviewer can complete them in place.
   */
  salvaged: { index: number; type: string; reason: string }[];
}

/**
 * Fill the required fields a candidate lacks with blanks, so an incomplete block
 * can be kept and completed by hand. Only blanks are added — nothing is guessed,
 * so a missing URL stays an empty field the reviewer must fill, never a link the
 * system made up.
 */
function withPlaceholders(cleaned: Record<string, unknown>): Record<string, unknown> {
  const str = (k: string) => (typeof cleaned[k] === 'string' ? (cleaned[k] as string) : '');
  switch (cleaned.type) {
    case 'hero':
      return { ...cleaned, heading: str('heading') };
    case 'heading':
      return { ...cleaned, text: str('text'), level: cleaned.level ?? 2 };
    case 'paragraph':
    case 'quote':
      return { ...cleaned, text: str('text') };
    case 'bulletList': {
      const items = Array.isArray(cleaned.items)
        ? (cleaned.items as unknown[]).filter((i): i is string => typeof i === 'string')
        : [];
      return { ...cleaned, items: items.length ? items : [''] };
    }
    case 'cta':
      return { ...cleaned, label: str('label'), url: str('url') };
    case 'image':
      return { ...cleaned, url: str('url'), alt: str('alt') };
    case 'programCard':
      return { ...cleaned, programName: str('programName'), description: str('description') };
    case 'statRow': {
      const stats = Array.isArray(cleaned.stats)
        ? (cleaned.stats as Array<{ value?: unknown; label?: unknown }>).map((x) => ({
            value: typeof x?.value === 'string' ? x.value : '',
            label: typeof x?.label === 'string' ? x.label : '',
          }))
        : [];
      while (stats.length < 2) stats.push({ value: '', label: '' });
      return { ...cleaned, stats: stats.slice(0, 3) };
    }
    default:
      return cleaned;
  }
}

/**
 * Required content a block must actually have, beyond the key merely existing.
 * Returns what is blank, or an empty list for a complete block. Used both to
 * flag salvaged blocks and to keep them flagged until the reviewer fills them.
 */
export function missingContent(block: EmailBlock): string[] {
  const blank = (v: string | undefined) => !v || !v.trim();
  switch (block.type) {
    case 'hero':
      return blank(block.heading) ? ['heading'] : [];
    case 'heading':
    case 'paragraph':
    case 'quote':
      return blank(block.text) ? ['text'] : [];
    case 'bulletList':
      return block.items.some((i) => !blank(i)) ? [] : ['items'];
    case 'cta':
      return [...(blank(block.label) ? ['label'] : []), ...(blank(block.url) ? ['url'] : [])];
    case 'image':
      return [...(blank(block.url) ? ['url'] : []), ...(blank(block.alt) ? ['alt text'] : [])];
    case 'programCard':
      return [
        ...(blank(block.programName) ? ['programme name'] : []),
        ...(blank(block.description) ? ['description'] : []),
      ];
    case 'statRow':
      return block.stats.filter((x) => !blank(x.value) && !blank(x.label)).length >= 2
        ? []
        : ['stats'];
    default:
      return [];
  }
}

/**
 * Narrow flat AI output back into real blocks.
 *
 * A block that does not satisfy its type's rules — a `cta` with no `url`, a
 * `programCard` with no `programName` — is dropped rather than repaired or
 * passed through. Guessing a missing URL would put a broken link in front of a
 * subscriber; passing it through would break render.ts's exhaustive switch. The
 * caller surfaces `rejected` so a thin draft is visibly thin rather than
 * quietly short.
 *
 * Extra keys are stripped by the per-variant schemas, so the `label` left over
 * from a `cta` cannot ride along on a `paragraph`.
 */
export function toEmailBlocks(
  raw: z.infer<typeof aiBlockSchema>[],
  options: { salvage?: boolean } = {},
): NarrowedBlocks {
  const blocks: GeneratableBlock[] = [];
  const rejected: { type: string; reason: string }[] = [];
  const salvaged: { index: number; type: string; reason: string }[] = [];

  for (const candidate of raw) {
    // Drop keys the model left explicitly null/undefined so they cannot look
    // like a present-but-invalid value to the variant schema.
    const cleaned: Record<string, unknown> = Object.fromEntries(
      Object.entries(candidate).filter(([, v]) => v !== undefined && v !== null),
    );

    // The AI schema cannot constrain this (see `level` above), so clamp rather
    // than reject: a heading with a silly level is still a usable heading.
    if (cleaned.type === 'heading' && typeof cleaned.level === 'number') {
      cleaned.level = Math.min(3, Math.max(2, Math.round(cleaned.level)));
    }

    // Recover text the model put in an adjacent field.
    //
    // The flat shape has a trap of its own making: a block whose *type* is
    // `heading` keeps its words in `text`, while the field literally named
    // `heading` belongs to `hero`. Models put the words in `heading`, which is
    // the reading the field name invites, and the block was then dropped for a
    // missing `text` it had actually written.
    //
    // Moving a value the model did supply is not the same as inventing one.
    // This is why a `cta` with no `url` is still dropped: there is nothing to
    // move, and guessing a link puts a broken one in front of a subscriber.
    const alias = (target: string, sources: string[]) => {
      if (typeof cleaned[target] === 'string' && cleaned[target]) return;
      for (const source of sources) {
        if (typeof cleaned[source] === 'string' && cleaned[source]) {
          cleaned[target] = cleaned[source];
          return;
        }
      }
    };

    if (cleaned.type === 'heading' || cleaned.type === 'paragraph' || cleaned.type === 'quote') {
      alias('text', ['heading', 'description', 'label']);
    } else if (cleaned.type === 'hero') {
      alias('heading', ['text']);
    } else if (cleaned.type === 'cta') {
      alias('label', ['text']);
    } else if (cleaned.type === 'programCard') {
      alias('description', ['text']);
    }

    const parsed = generatableBlockSchema.safeParse(cleaned);
    if (parsed.success) {
      blocks.push(parsed.data);
      continue;
    }

    const reason = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');

    // Draft review keeps the block, blank where the model left a gap, so the
    // reviewer sees it in its place and completes it rather than losing it.
    if (options.salvage) {
      const repaired = generatableBlockSchema.safeParse(withPlaceholders(cleaned));
      if (repaired.success) {
        salvaged.push({ index: blocks.length, type: candidate.type, reason });
        blocks.push(repaired.data);
        continue;
      }
    }

    rejected.push({ type: candidate.type, reason });
  }

  return { blocks, rejected, salvaged };
}

/** Human-readable label for the block editor. */
export const BLOCK_LABELS: Record<EmailBlockType, string> = {
  hero: 'Hero',
  heading: 'Heading',
  paragraph: 'Paragraph',
  bulletList: 'Bullet list',
  cta: 'Button',
  image: 'Image',
  divider: 'Divider',
  programCard: 'Programme card',
  statRow: 'Stats',
  quote: 'Quote',
  rawHtml: 'Custom HTML',
};

/** Extract every plain-text string in a block, for validation and previews. */
export function blockText(block: EmailBlock): string {
  switch (block.type) {
    case 'hero':
      return [block.heading, block.subheading].filter(Boolean).join(' ');
    case 'heading':
    case 'paragraph':
      return block.text;
    case 'bulletList':
      return block.items.join(' ');
    case 'cta':
      return block.label;
    case 'image':
      return block.alt;
    case 'programCard':
      return `${block.programName} ${block.description}`;
    case 'statRow':
      return block.stats.map((s) => `${s.value} ${s.label}`).join(' ');
    case 'quote':
      return [block.text, block.attribution].filter(Boolean).join(' ');
    case 'rawHtml':
      return block.html;
    case 'divider':
      return '';
  }
}

/** All text across a set of blocks — what the validator checks. */
export function blocksToText(blocks: EmailBlock[]): string {
  return blocks.map(blockText).filter(Boolean).join('\n\n');
}
