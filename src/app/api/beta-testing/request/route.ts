import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { mailer as transporter, getFromAddress, isEmailConfigured } from '@/lib/email-service';
import { captureLead } from '@/lib/marketing/capture';
import { isPlausibleEmail } from '@/lib/marketing/subscribers';
import { promises as fs } from 'fs';
import path from 'path';

/** Escape a value for interpolation into HTML text content. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/**
 * Reads an HTML template from the public folder and replaces placeholders.
 *
 * Values are escaped, and substituted through a replacer FUNCTION rather than a
 * replacement string. Both matter: `name` arrives from an unauthenticated public
 * form and was interpolated raw into the confirmation email AND into the
 * notification sent to training@hybridx.club, so a submitter controlled markup
 * and links in a message that appears to come from our own system. The function
 * form additionally stops `$&`, `` $` `` and `$'` in the value being interpreted
 * by String.replace as capture-group references.
 */
async function getEmailTemplate(templateName: string, replacements: Record<string, string>) {
  try {
    const templatePath = path.join(process.cwd(), 'public', templateName);
    let html = await fs.readFile(templatePath, 'utf8');

    // Replace all occurrences of placeholders
    Object.entries(replacements).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      const safe = escapeHtml(value);
      html = html.replace(regex, () => safe);
    });

    return html;
  } catch (error) {
    console.error(`Error reading email template ${templateName}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Public form — rate-limit per IP so it can't be abused to send spam email.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rl = checkRateLimit(`beta-request:${ip}`, 60 * 60_000, 5); // 5 per hour
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    // Capped: `name` is interpolated into two emails, one of which goes to our
    // own inbox, and arrived unbounded from a public form.
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';

    // Validated rather than merely present: `email` is used as a recipient, a
    // reply-to and part of a subject line.
    if (!email || !isPlausibleEmail(email)) {
      return NextResponse.json(
        { error: 'A valid email is required' },
        { status: 400 }
      );
    }

    if (!isEmailConfigured()) {
      console.error('Email credentials not configured');
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 }
      );
    }

    // Send confirmation email to user
    const userTemplate = await getEmailTemplate('beta-tester-confirmation.html', {
      name: name || 'Athlete',
    });

    if (userTemplate) {
      await transporter.sendMail({
        from: getFromAddress(),
        to: email,
        subject: 'Android Beta Testing Request Received',
        html: userTemplate,
      });
      logger.log(`Beta testing confirmation email sent to ${email}`);
    }

    // Send notification email to admin
    const adminTemplate = await getEmailTemplate('beta-tester-admin-notification.html', {
      name: name || 'Unknown',
      email: email,
      timestamp: new Date().toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
      }),
    });

    if (adminTemplate) {
      await transporter.sendMail({
        from: getFromAddress('HybridX Beta Requests'),
        to: 'training@hybridx.club',
        subject: `New Android Beta Tester Request: ${email}`,
        html: adminTemplate,
        replyTo: email,
      });
      logger.log(`Beta testing admin notification sent for ${email}`);
    }

    // Persist the lead. Until now this endpoint emailed a confirmation and then
    // discarded the address, so every beta request it ever handled was lost.
    //
    // Recorded without marketing consent: asking to join the Android beta is a
    // request for that build, not agreement to receive campaigns. The address
    // is on the list and taggable; the send path will skip it until the person
    // opts in.
    await captureLead({
      email,
      name: name || undefined,
      route: 'beta-android',
      consentMethod: 'beta-request-form',
    });

    return NextResponse.json({
      success: true,
      message: 'Beta testing request submitted successfully',
    });

  } catch (error) {
    console.error('Error processing beta testing request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
