// src/lib/marketing/render.ts
//
// Blocks to email-safe HTML.
//
// One template owns every visual decision: colours, spacing, type scale, button
// shape, dark-mode behaviour. Nothing that generates content gets to touch any
// of it, which is what makes brand consistency structural rather than a matter
// of the model behaving itself.
//
// Constraints this is written against, all of which rule out ordinary web CSS:
//   - Outlook (Word rendering engine) ignores most CSS; layout must be tables.
//   - Gmail strips <style> blocks in several contexts, so styles are inline.
//   - Flexbox, grid and CSS variables are unusable.
//   - Images are blocked by default, so alt text and background colours matter.
//   - Dark mode is per-client and unreliable; the palette is chosen to stay
//     legible when a client inverts it.

import type { EmailBlock } from './blocks';

/**
 * The palette, mirroring the app's tokens (globals.css) resolved to hex, since
 * email cannot use CSS variables.
 */
const THEME = {
  bg: '#f4f4f5',
  surface: '#ffffff',
  text: '#171717',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#f9c31f',       // --accent: 45 95% 55%
  accentText: '#171717',   // --accent-foreground
  primary: '#171717',
  primaryText: '#fafafa',
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const CONTENT_WIDTH = 600;

/** Escape text for HTML. Every model-supplied string passes through this. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only allow http(s) URLs through.
 *
 * Model-supplied URLs end up in href and src attributes, so a `javascript:`
 * value would be an injection vector reaching thousands of inboxes. Anything
 * unparseable becomes '#'.
 */
export function safeUrl(url: string | undefined): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '#';
  } catch {
    return '#';
  }
}

/** A full-width row wrapping cell content, so every block shares one gutter. */
function row(content: string, paddingY = 12): string {
  return `<tr><td style="padding:${paddingY}px 32px;">${content}</td></tr>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.type) {
    case 'hero': {
      const image = block.imageUrl
        ? `<img src="${safeUrl(block.imageUrl)}" width="${CONTENT_WIDTH}" alt="" style="display:block;width:100%;max-width:${CONTENT_WIDTH}px;height:auto;border:0;" />`
        : '';
      const sub = block.subheading
        ? `<p style="margin:12px 0 0;font-size:16px;line-height:1.5;color:${THEME.muted};">${escapeHtml(block.subheading)}</p>`
        : '';
      return `${image ? `<tr><td style="padding:0;">${image}</td></tr>` : ''}${row(
        `<h1 style="margin:0;font-family:${FONT};font-size:28px;line-height:1.25;font-weight:700;color:${THEME.text};">${escapeHtml(block.heading)}</h1>${sub}`,
        24,
      )}`;
    }

    case 'heading': {
      const size = block.level === 3 ? 18 : 22;
      return row(
        `<h${block.level} style="margin:0;font-family:${FONT};font-size:${size}px;line-height:1.3;font-weight:700;color:${THEME.text};">${escapeHtml(block.text)}</h${block.level}>`,
        16,
      );
    }

    case 'paragraph':
      return row(
        `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${THEME.text};">${escapeHtml(block.text)}</p>`,
      );

    case 'bulletList':
      return row(
        `<ul style="margin:0;padding-left:20px;font-family:${FONT};font-size:16px;line-height:1.6;color:${THEME.text};">` +
          block.items.map((i) => `<li style="margin:0 0 8px;">${escapeHtml(i)}</li>`).join('') +
          `</ul>`,
      );

    case 'cta': {
      // Bulletproof button: a table with a background colour, because Outlook
      // ignores padding and border-radius on an anchor.
      const url = safeUrl(block.url);
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto;">
          <tr><td align="center" bgcolor="${THEME.accent}" style="border-radius:8px;">
            <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:16px;font-weight:700;color:${THEME.accentText};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>
          </td></tr>
        </table>`,
        16,
      );
    }

    case 'image': {
      const img = `<img src="${safeUrl(block.url)}" alt="${escapeHtml(block.alt)}" width="${CONTENT_WIDTH - 64}" style="display:block;width:100%;max-width:${CONTENT_WIDTH - 64}px;height:auto;border:0;border-radius:8px;" />`;
      return row(block.linkUrl ? `<a href="${safeUrl(block.linkUrl)}">${img}</a>` : img);
    }

    case 'divider':
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${THEME.border};font-size:0;line-height:0;">&nbsp;</td></tr></table>`,
        8,
      );

    case 'programCard': {
      const link = block.url
        ? `<p style="margin:12px 0 0;"><a href="${safeUrl(block.url)}" style="font-family:${FONT};font-size:14px;font-weight:700;color:${THEME.text};">View the programme &rarr;</a></p>`
        : '';
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${THEME.border};border-radius:12px;">
          <tr><td style="padding:20px;">
            <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${THEME.muted};">Training programme</p>
            <h3 style="margin:6px 0 0;font-family:${FONT};font-size:18px;font-weight:700;color:${THEME.text};">${escapeHtml(block.programName)}</h3>
            <p style="margin:8px 0 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${THEME.muted};">${escapeHtml(block.description)}</p>
            ${link}
          </td></tr>
        </table>`,
      );
    }

    case 'statRow': {
      // Equal-width cells rather than flex, which no mail client supports.
      const width = Math.floor(100 / block.stats.length);
      const cells = block.stats
        .map(
          (s) =>
            `<td width="${width}%" align="center" style="padding:12px 8px;">
              <p style="margin:0;font-family:${FONT};font-size:26px;font-weight:700;color:${THEME.text};">${escapeHtml(s.value)}</p>
              <p style="margin:4px 0 0;font-family:${FONT};font-size:13px;color:${THEME.muted};">${escapeHtml(s.label)}</p>
            </td>`,
        )
        .join('');
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${THEME.bg};border-radius:12px;"><tr>${cells}</tr></table>`,
      );
    }

    case 'quote': {
      const attribution = block.attribution
        ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:14px;color:${THEME.muted};">&mdash; ${escapeHtml(block.attribution)}</p>`
        : '';
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-left:3px solid ${THEME.accent};padding:4px 0 4px 16px;">
            <p style="margin:0;font-family:${FONT};font-size:17px;line-height:1.5;font-style:italic;color:${THEME.text};">${escapeHtml(block.text)}</p>
            ${attribution}
          </td></tr></table>`,
      );
    }

    // Trusted by construction: only reachable from hand-authored content and
    // migrated HXMailer campaigns, never from a generated draft.
    case 'rawHtml':
      return row(block.html);
  }
}

export interface RenderShellOptions {
  previewText?: string;
  /** Rendered into the footer. The send path appends the real unsubscribe link. */
  footerNote?: string;
}

/**
 * Wrap rendered blocks in the email shell.
 *
 * The preheader is a hidden element carrying the preview text an inbox shows
 * beside the subject; without it the client displays the first words of the
 * body, which is usually "View in browser" or a heading fragment.
 */
export function renderBlocks(blocks: EmailBlock[], options: RenderShellOptions = {}): string {
  const body = blocks.map(renderBlock).join('\n');

  const preheader = options.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${THEME.surface};">${escapeHtml(options.previewText)}</div>`
    : '';

  const footerNote = options.footerNote
    ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.5;color:${THEME.muted};">${escapeHtml(options.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>HYBRIDX</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:${THEME.bg};-webkit-font-smoothing:antialiased;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${THEME.bg};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${CONTENT_WIDTH}px;background:${THEME.surface};border-radius:16px;overflow:hidden;">
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:0.12em;color:${THEME.text};">HYBRIDX</p>
      </td></tr>
${body}
      <tr><td style="padding:24px 32px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-top:1px solid ${THEME.border};padding-top:20px;">
            ${footerNote}
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;color:${THEME.muted};">HYBRIDX</p>
          </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative built from the blocks, not by flattening the HTML. */
export function renderBlocksAsText(blocks: EmailBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'hero':
        parts.push(block.heading.toUpperCase());
        if (block.subheading) parts.push(block.subheading);
        break;
      case 'heading':
        parts.push(block.text.toUpperCase());
        break;
      case 'paragraph':
        parts.push(block.text);
        break;
      case 'bulletList':
        parts.push(block.items.map((i) => `  * ${i}`).join('\n'));
        break;
      case 'cta':
        parts.push(`${block.label}: ${safeUrl(block.url)}`);
        break;
      case 'image':
        if (block.alt) parts.push(`[${block.alt}]`);
        break;
      case 'divider':
        parts.push('---');
        break;
      case 'programCard':
        parts.push(
          `${block.programName}\n${block.description}${block.url ? `\n${safeUrl(block.url)}` : ''}`,
        );
        break;
      case 'statRow':
        parts.push(block.stats.map((s) => `${s.value} ${s.label}`).join('  |  '));
        break;
      case 'quote':
        parts.push(`"${block.text}"${block.attribution ? `\n  -- ${block.attribution}` : ''}`);
        break;
      case 'rawHtml':
        parts.push(block.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        break;
    }
  }

  return parts.filter(Boolean).join('\n\n');
}
