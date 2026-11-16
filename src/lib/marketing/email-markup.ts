// src/lib/marketing/email-markup.ts
//
// The format the drafting model writes in, and the parser that turns it into
// blocks.
//
// Why a text format instead of JSON blocks
// ----------------------------------------
// Drafting used to ask Gemini for an array of flat block objects: one `type`
// enum plus fourteen optional fields covering every block type. That shape
// was the main reason drafts came back broken:
//
//   - The schema could not say which fields each type needs, so a heading
//     arrived with its words in `heading` (the hero's field) instead of
//     `text`, a button with no url, a programme card with no name.
//   - The array was capped at ten items, a measured Gemini grammar limit. With
//     every paragraph its own block, that left about eight blocks for a whole
//     email, and content was cut to fit.
//   - Writing copy inside a JSON grammar, at low thinking, produces stiff copy.
//
// Models write Markdown fluently and reliably. So the model now writes a
// short, Markdown-like document, and this parser — deterministic, testable,
// with no length cap — turns it into the same strict blocks render.ts and the
// editor already use. The structured-output schema shrinks to four strings.
//
// The format
// ----------
//   # Headline                       hero (first line of the email)
//   One supporting sentence          hero subheading: the line directly under
//                                    the headline, with no blank line between
//   ## Section heading               heading, level 2 (### for level 3)
//   Plain text                       paragraph; a blank line ends it
//   - point                          bullet list (consecutive lines)
//   > quoted words                   quote; a last line "> — Name" attributes it
//   ---                              divider
//   [button: Label -> destination]   the call to action; destination is a key
//                                    from the list the prompt gives
//   [program: Exact Name | Why it fits this reader]
//   [stats: 12 weeks = per programme | 14 days = free trial]
//   [image: https://… | Alt text]
//
// Anything the parser cannot use is reported as an issue with the line it came
// from, never dropped silently. Each issue says who can fix it: most go back to
// the model in a repair pass; a missing link the brief never supplied goes to
// the reviewer, because nobody else knows it.

import { APP_MARKETING_PATHS } from './app-routes';
import { generatableBlockSchema, type GeneratableBlock } from './blocks';
import type { ValidationIssue } from './validate';

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/** A link the model may point a button at, by key rather than by typing a URL. */
export interface Destination {
  key: string;
  url: string;
  /** Where the link came from — the app's own route list, or the brief. */
  source: 'app' | 'brief';
}

/** Written where a button needs a link that nobody has supplied yet. */
export const ADD_LINK = 'ADD-LINK';

const URL_IN_TEXT = /https?:\/\/[^\s<>"'()\[\]]+/g;

/** Strip punctuation a sentence put after a URL, e.g. "see https://x.com/a." */
function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

/** App route to a short key: "/" → "home", "/activity-feed" → "activity-feed". */
function appKey(path: string): string {
  return path === '/' ? 'home' : path.replace(/^\//, '');
}

/**
 * Every destination a button in this email may use.
 *
 * App routes come from the one route list the validator also reads, so the
 * model cannot be offered a page that the validator would then reject. URLs
 * in the brief become `link-1`, `link-2`… so a shop or book page the marketer
 * supplied is used exactly as written — the model never retypes a URL.
 */
export function buildDestinations(briefText: string, appUrl: string): Destination[] {
  const base = appUrl.replace(/\/$/, '');
  const app: Destination[] = APP_MARKETING_PATHS.map((path) => ({
    key: appKey(path),
    url: path === '/' ? base : `${base}${path}`,
    source: 'app',
  }));

  const seen = new Set<string>();
  const brief: Destination[] = [];
  for (const raw of briefText.match(URL_IN_TEXT) ?? []) {
    const url = trimUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    brief.push({ key: `link-${brief.length + 1}`, url, source: 'brief' });
  }

  // Brief links first: when the brief names a link, that is almost always
  // where the email should send people.
  return [...brief, ...app];
}

// ---------------------------------------------------------------------------
// Brand casing
// ---------------------------------------------------------------------------

/**
 * Correct brand casing in model output instead of warning about it.
 *
 * "Hyrox" → "HYROX" and "HybridX" → "HYBRIDX" are mechanical fixes with one
 * right answer, and leaving them as warnings put busywork in front of the
 * reviewer on almost every draft. Programme names are protected: the live
 * catalogue spells several of them "Hyrox", and the name must match the
 * catalogue exactly to pass the fact-check.
 */
export function normaliseBrand(text: string, programNames: readonly string[] = []): string {
  const protectedNames = [...programNames]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const held: string[] = [];

  let out = text;
  for (const name of protectedNames) {
    const pattern = new RegExp(escapeRegExp(name), 'gi');
    out = out.replace(pattern, () => {
      held.push(name);
      return `\u0000${held.length - 1}\u0000`;
    });
  }

  out = out
    .replace(/\bHybrid[\s-]?X\b(?!\.club)/gi, 'HYBRIDX')
    .replace(/\bHybridX\.club\b/gi, 'HYBRIDX.CLUB')
    .replace(/\bhyrox\b/gi, 'HYROX');

  // Restore with the catalogue's own spelling, so a lower-cased mention of a
  // real programme also comes out matching the catalogue.
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParseOptions {
  destinations: Destination[];
  /** Live programme names, for exact-name matching and brand casing. */
  programNames?: readonly string[];
  /**
   * Parsing part of an email (one block being revised), so the whole-email
   * checks — has a button, opens with a headline — do not apply.
   */
  fragment?: boolean;
}

export interface ParseResult {
  blocks: GeneratableBlock[];
  issues: ValidationIssue[];
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Turn the model's document into blocks.
 *
 * Lenient about form, strict about content: a numbered list becomes bullets,
 * a stray "**" is removed, a second "#" becomes a section heading. But a
 * button with no usable destination, or a programme that is not in the
 * catalogue, is kept in place and flagged — never guessed at, never dropped.
 */
export function parseEmailMarkup(source: string, options: ParseOptions): ParseResult {
  const programNames = options.programNames ?? [];
  const blocks: GeneratableBlock[] = [];
  const issues: ValidationIssue[] = [];

  const issue = (
    severity: ValidationIssue['severity'],
    found: string,
    message: string,
    extra: Partial<ValidationIssue> = {},
  ) => issues.push({ severity, kind: 'structure', found, message, ...extra });

  /** Clean one run of prose: inline Markdown, stray HTML, brand casing. */
  const clean = (raw: string): string => {
    let text = raw;
    // An inline link has nowhere to go: paragraphs render as plain text. Keep
    // the words, report the link so a button can carry it instead.
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => {
      issue(
        'warning',
        url,
        `An inline link on "${label}" was removed — body text cannot hold links. Use the button for the main link.`,
      );
      return label;
    });
    if (/<[a-z/][^>]*>/i.test(text)) {
      issue('warning', text.slice(0, 60), 'HTML tags were removed from this text. Write plain text only.');
      text = text.replace(/<[^>]+>/g, '');
    }
    text = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return normaliseBrand(text, programNames);
  };

  const push = (block: GeneratableBlock) => {
    blocks.push(block);
    return blocks.length - 1;
  };

  // Open runs, flushed by a blank line or a different kind of line.
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let quote: string[] = [];
  /** Index of a hero still accepting its subheading line. */
  let heroAwaitingSub: number | null = null;

  const flushParagraph = () => {
    const text = clean(paragraph.join(' '));
    paragraph = [];
    if (text) push({ type: 'paragraph', text });
  };
  const flushBullets = () => {
    const items = bullets.map(clean).filter(Boolean);
    bullets = [];
    if (items.length) push({ type: 'bulletList', items: items.slice(0, 8) });
    if (items.length > 8) {
      issue('warning', `${items.length} bullet points`, 'A list was cut to its first eight points. Keep lists short.', {
        blockIndex: blocks.length - 1,
      });
    }
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const lines = [...quote];
    quote = [];
    let attribution: string | undefined;
    const last = lines[lines.length - 1];
    const attr = last.match(/^\s*[—–-]{1,2}\s*(.+)$/);
    if (attr && lines.length > 1) {
      attribution = clean(attr[1]);
      lines.pop();
    }
    const text = clean(lines.join(' ').replace(/^["“]|["”]$/g, ''));
    if (text) push({ type: 'quote', text, ...(attribution ? { attribution } : {}) });
  };
  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushQuote();
  };

  const lines = stripFences(source).split(/\r?\n/);

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();

    if (!line) {
      flushAll();
      heroAwaitingSub = null;
      continue;
    }

    // Hero subheading: the plain line directly under the headline. A long one
    // is the first paragraph written without a blank line, not a subheading.
    if (heroAwaitingSub !== null && !isMarkupLine(line) && line.length <= 160) {
      const hero = blocks[heroAwaitingSub];
      if (hero.type === 'hero') {
        const sub = clean(line);
        hero.subheading = hero.subheading ? `${hero.subheading} ${sub}` : sub;
      }
      continue;
    }
    heroAwaitingSub = null;

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushAll();
      push({ type: 'divider' });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      flushAll();
      const depth = headingMatch[1].length;
      const text = clean(headingMatch[2]);
      if (!text) continue;
      // Only the email's opening "#" is a hero. A later one is a section
      // heading the model over-weighted, which is how it would render anyway.
      if (depth === 1 && blocks.length === 0) {
        heroAwaitingSub = push({ type: 'hero', heading: text });
      } else {
        push({ type: 'heading', text, level: depth >= 3 ? 3 : 2 });
      }
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•+]|\d{1,2}[.)])\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      flushQuote();
      bullets.push(bulletMatch[1]);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushBullets();
      if (quoteMatch[1].trim()) quote.push(quoteMatch[1].trim());
      continue;
    }

    const directive = line.match(/^\[\s*([a-z][a-z -]*?)\s*:\s*(.*?)\s*\]$/i);
    if (directive) {
      flushAll();
      parseDirective(directive[1].toLowerCase(), directive[2], lineIndex + 1);
      continue;
    }

    // A line that is nothing but a Markdown link is a button by intent.
    const bareLink = line.match(/^\[([^\]]+)\]\((\S+)\)$/);
    if (bareLink) {
      flushAll();
      pushButton(bareLink[1], bareLink[2]);
      continue;
    }

    if (bullets.length && /^\s{2,}/.test(rawLine)) {
      // An indented continuation of the previous bullet point.
      bullets[bullets.length - 1] += ` ${line}`;
      continue;
    }

    flushBullets();
    flushQuote();
    paragraph.push(line);
  }
  flushAll();

  function pushButton(rawLabel: string, rawDestination: string) {
    const label = clean(rawLabel);
    const destination = rawDestination.trim();
    const index = blocks.length;
    const resolved = resolveDestination(destination, options.destinations);

    push({ type: 'cta', label, url: resolved.url });

    if (!label) {
      issue('error', `button (block ${index + 1})`, 'This button has no label. Give it two to four action-led words.', {
        blockIndex: index,
      });
    }
    if (resolved.problem === 'add-link') {
      issue(
        'error',
        label || 'button',
        `The brief gave no link for this button. Add the URL for "${label || 'this button'}" before sending.`,
        { blockIndex: index, owner: 'human' },
      );
    } else if (resolved.problem === 'unknown') {
      issue(
        'error',
        destination || '(none)',
        `The button "${label}" points at "${destination || 'nothing'}", which is not one of the destinations offered. Use a destination key from the list, or ${ADD_LINK} if the brief gave no link.`,
        { blockIndex: index },
      );
    }
  }

  function parseDirective(name: string, body: string, line: number) {
    const parts = body.split(/\s*\|\s*/);
    switch (name) {
      case 'button':
      case 'cta':
      case 'btn': {
        const arrow = body.match(/^(.*?)\s*(?:->|→|=>)\s*(.*)$/);
        if (arrow) pushButton(arrow[1], arrow[2]);
        else if (parts.length === 2) pushButton(parts[0], parts[1]);
        else pushButton(body, '');
        return;
      }

      case 'program':
      case 'programme':
      case 'program card':
      case 'programme card': {
        const [rawName = '', ...rest] = parts;
        const description = clean(rest.join(' | '));
        const wanted = normaliseName(rawName);
        const match = programNames.find((p) => normaliseName(p) === wanted);
        const index = push({
          type: 'programCard',
          programName: match ?? clean(rawName),
          description,
        });
        if (!match) {
          issue(
            'error',
            rawName || '(no name)',
            programNames.length
              ? `"${rawName}" is not one of the current programmes. Use a name exactly as listed in the facts, or remove the card.`
              : 'No programme catalogue was available, so a programme card cannot be checked. Remove it.',
            { blockIndex: index, kind: 'fact' },
          );
        }
        if (!description) {
          issue('error', rawName, 'This programme card has no description. Add one sentence on why it suits the reader.', {
            blockIndex: index,
          });
        }
        return;
      }

      case 'stats':
      case 'stat':
      case 'stat row': {
        const stats = parts
          .map((part) => {
            const m = part.match(/^(.*?)\s*=\s*(.*)$/);
            return m ? { value: clean(m[1]), label: clean(m[2]) } : null;
          })
          .filter((s): s is { value: string; label: string } => !!s && !!s.value && !!s.label)
          .slice(0, 3);
        if (stats.length >= 2) {
          push({ type: 'statRow', stats });
        } else {
          issue(
            'error',
            `[stats: ${body}]`,
            'A stats row needs two or three "value = label" figures from the facts. It was left out; rewrite it or drop it.',
          );
        }
        return;
      }

      case 'image': {
        const [url = '', alt = ''] = parts;
        const index = push({ type: 'image', url: url.trim(), alt: clean(alt) });
        if (!/^https:\/\//.test(url.trim())) {
          issue('error', url || '(none)', 'This image needs an absolute https URL.', {
            blockIndex: index,
            owner: 'human',
          });
        }
        if (!clean(alt)) {
          issue('error', 'image', 'This image needs alt text — many inboxes block images by default.', {
            blockIndex: index,
          });
        }
        return;
      }

      default: {
        // Keep the words rather than lose them, and say why it looks odd.
        const text = clean(body);
        const index = text ? push({ type: 'paragraph', text }) : undefined;
        issue(
          'warning',
          `[${name}: …] (line ${line})`,
          `"${name}" is not a block this email format has, so it was kept as plain text.`,
          index === undefined ? {} : { blockIndex: index },
        );
      }
    }
  }

  // Every block must still satisfy the strict schema render.ts relies on. The
  // parser builds them by hand, so this is a guard against a parser bug, not a
  // model mistake — but a guard that reports rather than throws.
  blocks.forEach((block, index) => {
    if (!generatableBlockSchema.safeParse(block).success) {
      issue('error', `${block.type} (block ${index + 1})`, `This ${block.type} block is incomplete.`, {
        blockIndex: index,
      });
    }
  });

  // Whole-email shape.
  if (options.fragment) {
    if (!blocks.length) issue('error', '(empty)', 'The revision has no content.');
  } else if (!blocks.length) {
    issue('error', '(empty)', 'The draft has no content.');
  } else {
    const buttons = blocks.filter((b) => b.type === 'cta').length;
    if (buttons === 0) {
      issue('error', '(no button)', 'The email has no button. Add one call to action.');
    } else if (buttons > 2) {
      issue('warning', `${buttons} buttons`, 'More than two buttons splits attention. Keep one primary call to action.');
    }
    if (blocks[0].type !== 'hero') {
      issue('warning', blocks[0].type, 'The email does not open with a headline.');
    }
  }

  return { blocks, issues };
}

/** Lines the parser gives meaning to — anything else is prose. */
function isMarkupLine(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^(?:[-*•+]|\d{1,2}[.)])\s/.test(line) ||
    /^>/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line) ||
    /^\[[^\]]+\]/.test(line)
  );
}

/** Models sometimes wrap the body in a code fence despite being asked not to. */
function stripFences(source: string): string {
  return source.replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '');
}

function resolveDestination(
  destination: string,
  destinations: Destination[],
): { url: string; problem?: 'add-link' | 'unknown' } {
  const d = destination.replace(/^<|>$/g, '').trim();
  if (!d || /^(add[-_ ]?link|todo|tbc|tbd|none|#)$/i.test(d)) {
    return { url: '', problem: 'add-link' };
  }

  const byKey = destinations.find((x) => x.key.toLowerCase() === d.toLowerCase());
  if (byKey) return { url: byKey.url };

  if (/^https?:\/\//i.test(d)) {
    const url = trimUrl(d);
    // Exactly a link we offered — fine. An app link is checked against the
    // route list by validateLinks. Any other URL is one the model typed out
    // of nowhere, which is how a confident, broken link reaches a subscriber.
    if (destinations.some((x) => x.url === url)) return { url };
    const appHosts = new Set(
      destinations.filter((x) => x.source === 'app').map((x) => safeHost(x.url)),
    );
    if (appHosts.has(safeHost(url))) return { url };
    return { url: '', problem: 'unknown' };
  }

  if (d.startsWith('/')) {
    const app = destinations.find((x) => x.source === 'app' && x.key === appKey(d.replace(/\/$/, '') || '/'));
    if (app) return { url: app.url };
  }

  return { url: '', problem: 'unknown' };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

/**
 * Blocks back into the format, for showing the model an email it or another
 * step already wrote — the earlier emails in a sequence, or a block to revise.
 *
 * A button is written with its destination key where one matches, so a
 * round trip through the model does not turn a known link into a typed URL.
 */
export function blocksToMarkup(blocks: readonly GeneratableBlock[] | readonly { type: string }[], destinations: Destination[] = []): string {
  const keyFor = (url: string) => {
    if (!url) return ADD_LINK;
    return destinations.find((d) => d.url === url)?.key ?? url;
  };

  return (blocks as GeneratableBlock[])
    .map((block) => {
      switch (block.type) {
        case 'hero':
          return block.subheading ? `# ${block.heading}\n${block.subheading}` : `# ${block.heading}`;
        case 'heading':
          return `${block.level === 3 ? '###' : '##'} ${block.text}`;
        case 'paragraph':
          return block.text;
        case 'bulletList':
          return block.items.map((i) => `- ${i}`).join('\n');
        case 'cta':
          return `[button: ${block.label} -> ${keyFor(block.url)}]`;
        case 'image':
          return `[image: ${block.url} | ${block.alt}]`;
        case 'divider':
          return '---';
        case 'programCard':
          return `[program: ${block.programName} | ${block.description}]`;
        case 'statRow':
          return `[stats: ${block.stats.map((s) => `${s.value} = ${s.label}`).join(' | ')}]`;
        case 'quote':
          return [`> ${block.text}`, ...(block.attribution ? [`> — ${block.attribution}`] : [])].join('\n');
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}
