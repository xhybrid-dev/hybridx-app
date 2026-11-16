// src/lib/marketing/draft-prompt.ts
//
// The drafting prompt, the repair prompt, and the input shape they are built
// from.
//
// This lives here rather than in the flow because draft-email.ts is a
// 'use server' module, where every export must be an async function. A pure
// string builder exported from there is a build error, and making it async to
// satisfy the rule would publish it as a network-callable Server Action — a
// wider surface than a prompt builder has any business having.
//
// How the prompt is built
// -----------------------
// The model writes the email as a short Markdown-like document (see
// email-markup.ts), not as JSON blocks. The prompt therefore spends its words
// on what makes an email good — one job, one reader, one action — and on one
// worked example of the format, rather than on a field-by-field schema
// explanation and a page of prohibitions. The fact-checker and the repair pass
// carry the hard rules; the prompt carries the craft.

import { z } from 'zod';
import { HYBRIDX_BRAND_CONTEXT } from '@/ai/brand-context';
import { MERGE_TOKEN_HINT } from '@/lib/marketing/blocks';
import { ADD_LINK, type Destination } from '@/lib/marketing/email-markup';
import type { ValidationIssue } from '@/lib/marketing/validate';

export const draftEmailInputSchema = z.object({
  brief: z.string().describe('What this email must achieve.'),
  journeyGoal: z.string().optional().describe('The wider goal of the sequence.'),
  audienceDescription: z.string().optional(),
  /** Subjects of the other emails in the sequence, so this one does not repeat them. */
  siblingSubjects: z.array(z.string()).optional(),
  /**
   * The earlier emails in the sequence, in full (subject plus body in the
   * email format). Subjects alone let the model avoid a repeated subject line
   * but not a repeated argument — three emails in a row opened on the same
   * point because none of them could see what the last one said.
   */
  siblingEmails: z
    .array(z.object({ subject: z.string(), body: z.string() }))
    .optional(),
  position: z.string().optional().describe('e.g. "email 2 of 3, sent 3 days in".'),
});

export type DraftEmailInput = z.infer<typeof draftEmailInputSchema>;

export interface DraftPromptContext {
  /** formatKnowledgeForDraft output. */
  facts: string;
  destinations: Destination[];
}

/** The model's raw answer, before parsing. */
export interface DraftModelOutput {
  angle: string;
  subject: string;
  previewText: string;
  body: string;
}

function destinationList(destinations: Destination[]): string {
  const brief = destinations.filter((d) => d.source === 'brief');
  const app = destinations.filter((d) => d.source === 'app');
  const lines: string[] = [];
  if (brief.length) {
    lines.push('From the brief (use these for whatever the brief is promoting):');
    lines.push(...brief.map((d) => `- ${d.key} → ${d.url}`));
  }
  lines.push('Pages in the HYBRIDX app:');
  lines.push(...app.map((d) => `- ${d.key} → ${d.url}`));
  lines.push(
    `- ${ADD_LINK} → the brief names something to link to but gives no URL; the reviewer will add it`,
  );
  return lines.join('\n');
}

const FORMAT_GUIDE = `## How to write the body
Write the body as a short plain-text document using only these conventions:

# Headline
One supporting line, directly under the headline with no blank line between.

Body paragraphs are plain text. Separate paragraphs with a blank line.

## Section heading
(### for a smaller sub-heading)

- bullet point
- bullet point

> A quote from someone real, only if the brief supplies one
> — Their name

---
(a divider)

[button: Two to four words -> destination]
[program: Exact Programme Name | One sentence on why it suits this reader]
[stats: value = label | value = label]

Rules for the format:
- The first line is the "# Headline". Use "#" only once.
- No bold, italics, HTML, emoji bullets or inline links. Body text cannot hold
  links; the button carries the link.
- [button: …] must end with "-> " and one destination key from the list below,
  exactly as written. Never type out a URL.
- [program: …] only with a programme name copied exactly from the facts.
- [stats: …] only with figures that appear in the facts or the brief, two or
  three of them. If you have none, leave stats out — most emails should.`;

const EXAMPLE = `## Example (for shape and tone only — never reuse its words or facts)
This is the structure of a good activation email. Your email will be about
something else; copy how it works, not what it says.

angle: The reader signed up but has not trained yet; get them to do one short first session today.
subject: Your first session takes 35 minutes
previewText: No plan to read first. Open the app and press start.
body:
# Your first session takes 35 minutes
No setup, no plan to study first.

Hi [First Name],

Most people who sign up and never train are not short on motivation. They are waiting for the right moment to start a twelve-week plan. There isn't one, so start smaller.

Today's session is already in your plan. It is short, it is scaled to you, and it tells your coach what to adjust for next week.

## What happens after it
- Your plan adjusts to how the session actually went
- Your coach notices what was hard and eases or pushes from there
- You stop wondering whether you are doing the right thing

[button: Start today's session -> dashboard]

See you on the start line,
The HYBRIDX team`;

const CRAFT = `## What makes a HYBRIDX email good
- One job. The email exists to get one reader to take one action. Every
  paragraph earns its place by moving them toward the button.
- Start with the reader, not the brand. Open on their situation, their race,
  their week — then show how this helps.
- Be specific to HYROX and hybrid training: stations, compromised running,
  race day, the final 1km. Specific detail is what makes it believable.
- Short paragraphs: one to three sentences. Most emails are 120 to 250 words
  of body text. Use a section heading only when the email genuinely has two or
  more parts; a short email needs none.
- Bullets for three to five parallel points, not for a whole argument.
- The button repeats the promise in the reader's terms ("Start today's
  session", not "Click here" or "Learn more").
- Sign off as a person or "The HYBRIDX team". Merge tokens are welcome where
  they read naturally; ${MERGE_TOKEN_HINT}
- Subject: under 60 characters, specific, honest about what is inside. No
  exclamation marks, no fake "Re:", no ALL CAPS words except HYROX and HYBRIDX.
- Preview text: one short sentence that adds to the subject, never repeats it.`;

/** The full drafting prompt. */
export function buildDraftPrompt(input: DraftEmailInput, context: DraftPromptContext): string {
  const earlier = input.siblingEmails?.length
    ? `## Earlier emails in this sequence
The reader has already received these. Do not repeat their argument, opening,
examples or subject line — build on them, and take a different angle.

${input.siblingEmails
  .map((e, i) => `### Earlier email ${i + 1}\nsubject: ${e.subject}\n${e.body}`)
  .join('\n\n')}
`
    : input.siblingSubjects?.length
      ? `## Earlier emails in this sequence\nDo not repeat these angles or subject lines:\n${input.siblingSubjects.map((s) => `- ${s}`).join('\n')}\n`
      : '';

  return `You are the senior lifecycle copywriter for HYBRIDX. You write emails
athletes actually read: short, specific, and built around one action.

${HYBRIDX_BRAND_CONTEXT}

${context.facts}

## What to promote
The brief decides what this email is about. It may be the app, a book, a
digital product, an event or something else. Write about what the brief names.
Do not steer an email about another product toward the app, do not add the
free trial or app pricing unless the brief asks for them, and do not describe
a non-app product as part of the app. Use a product's title, price, format and
contents only as the brief gives them.

${CRAFT}

${FORMAT_GUIDE}

## Destinations for the button
${destinationList(context.destinations)}

${EXAMPLE}

## Your answer
Return four fields:
- angle: one sentence — who this reader is right now and the single action this email gets them to take.
- subject
- previewText
- body: the email in the format above.

${input.journeyGoal ? `## Sequence goal\n${input.journeyGoal}\n\n` : ''}${input.audienceDescription ? `## Audience\n${input.audienceDescription}\n\n` : ''}${input.position ? `## Position\nThis is ${input.position}.\n\n` : ''}${earlier}
## This email's brief
${input.brief}`;
}

/**
 * Ask the model to fix its own draft.
 *
 * Every problem the parser or fact-checker can name precisely — a programme
 * that does not exist, a price that is wrong, a button pointing nowhere — is
 * one the model can fix given the exact message. Doing that before a person
 * sees the draft is the difference between a reviewer reading copy and a
 * reviewer doing repairs.
 */
export function buildRepairPrompt(
  originalPrompt: string,
  previous: DraftModelOutput,
  problems: ValidationIssue[],
): string {
  return `${originalPrompt}

## Your previous draft
angle: ${previous.angle}
subject: ${previous.subject}
previewText: ${previous.previewText}
body:
${previous.body}

## Problems found in that draft
${problems.map((p) => `- ${p.found}: ${p.message}`).join('\n')}

## Fix it
Return the whole email again, with every problem above fixed. Keep everything
that was not a problem: same angle, same structure, same wording wherever it
was fine. Do not shorten the email to make a problem go away — fix the line
that has it. If a fact you wanted is not in the facts or the brief, remove the
claim rather than replacing it with another one.`;
}
