import nodemailer from 'nodemailer';
import { promises as fs } from 'fs';
import path from 'path';

// Transactional email transport.
//
// Prefers Brevo (SMTP relay) when configured — sending from an authenticated
// domain (SPF/DKIM/DMARC) is what keeps verification/coaching emails out of
// spam. Falls back to the legacy Gmail SMTP so nothing breaks until the Brevo
// credentials are added.
const transporter = process.env.BREVO_SMTP_KEY
  ? nodemailer.createTransport({
      host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
      port: Number(process.env.BREVO_SMTP_PORT) || 587,
      secure: false, // STARTTLS on port 587
      auth: {
        user: process.env.BREVO_SMTP_USER, // Brevo SMTP login (e.g. xxxxxx@smtp-brevo.com)
        pass: process.env.BREVO_SMTP_KEY,  // Brevo SMTP key
      },
    })
  : nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

/** Whether an email transport is configured (Brevo or the Gmail fallback). */
export function isEmailConfigured(): boolean {
  if (process.env.BREVO_SMTP_KEY && process.env.BREVO_SMTP_USER) return true;
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/**
 * The From header. Uses EMAIL_FROM (a sender verified on your domain in Brevo,
 * e.g. "noreply@hybridx.club") when set; otherwise falls back to the Gmail
 * account. Display name defaults to EMAIL_FROM_NAME and can be overridden.
 */
export function getFromAddress(nameOverride?: string): string {
  const name = nameOverride || process.env.EMAIL_FROM_NAME || 'HybridX Training';
  const address = process.env.EMAIL_FROM || process.env.GMAIL_USER || '';
  return `"${name}" <${address}>`;
}

/** Shared transactional email transport (Brevo when configured, else Gmail). */
export const mailer = transporter;

/**
 * Reads an HTML template from the public folder and replaces placeholders
 */
async function getEmailTemplate(templateName: string, replacements: Record<string, string>) {
  try {
    const templatePath = path.join(process.cwd(), 'public', templateName);
    let html = await fs.readFile(templatePath, 'utf8');

    // Replace all occurrences of placeholders
    Object.entries(replacements).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, value);
    });

    return html;
  } catch (error) {
    console.error(`Error reading email template ${templateName}:`, error);
    return null;
  }
}

/**
 * Sends a welcome email to a new user
 */
export async function sendWelcomeEmail(email: string, name?: string) {
  try {
    if (!isEmailConfigured()) {
      console.warn('Email credentials not configured, skipping welcome email');
      return;
    }

    const html = await getEmailTemplate('new-user-email.html', {
      name: name || 'Athlete',
      // Add other replacements if the template supports them
    });

    if (!html) {
      throw new Error('Could not load email template');
    }

    await transporter.sendMail({
      from: getFromAddress(),
      to: email,
      subject: 'Welcome to the HybridX.club Community!',
      html: html,
    });

    console.log(`Welcome email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return { success: false, error };
  }
}





/**
 * Sends the account email-verification message through our own transport
 * (Brevo/Gmail) rather than Firebase's default sender, so it lands in the inbox.
 * The verification link is generated server-side via the Admin SDK and passed in.
 */
export async function sendVerificationEmail(email: string, verifyLink: string, name?: string) {
  try {
    if (!isEmailConfigured()) {
      console.warn('Email credentials not configured, skipping verification email');
      return { success: false, error: 'email-not-configured' };
    }

    const safeName = name || 'Athlete';
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #111;">
        <h1 style="font-size: 22px; margin: 0 0 16px;">Confirm your email</h1>
        <p style="font-size: 15px; line-height: 1.5;">Hi ${safeName}, welcome to HybridX! Please confirm your email address to secure your account and receive your coaching updates.</p>
        <p style="margin: 28px 0;">
          <a href="${verifyLink}" style="background:#111; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-size:15px; display:inline-block;">Verify my email</a>
        </p>
        <p style="font-size: 13px; color:#555; line-height: 1.5;">If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${verifyLink}" style="color:#2563eb; word-break: break-all;">${verifyLink}</a>
        </p>
        <p style="font-size: 12px; color:#999; margin-top: 28px;">If you didn't create a HybridX account, you can safely ignore this email.</p>
      </div>
    `;

    await transporter.sendMail({
      from: getFromAddress(),
      to: email,
      subject: 'Confirm your HybridX email',
      html,
    });

    console.log(`Verification email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return { success: false, error };
  }
}

/**
 * Sends a password-reset link through our own transport, for the same inbox
 * placement reason as the verification email. The link is generated
 * server-side with the Admin SDK and passed in.
 */
export async function sendPasswordResetEmail(email: string, resetLink: string, name?: string) {
  try {
    if (!isEmailConfigured()) {
      console.warn('Email credentials not configured, skipping password reset email');
      return { success: false, error: 'email-not-configured' };
    }

    const safeName = name || 'Athlete';
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #111;">
        <h1 style="font-size: 22px; margin: 0 0 16px;">Reset your password</h1>
        <p style="font-size: 15px; line-height: 1.5;">Hi ${safeName}, someone asked to reset the password for your HybridX account. Choose a new one and your plan will be right where you left it.</p>
        <p style="margin: 28px 0;">
          <a href="${resetLink}" style="background:#111; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-size:15px; display:inline-block;">Choose a new password</a>
        </p>
        <p style="font-size: 13px; color:#555; line-height: 1.5;">If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetLink}" style="color:#2563eb; word-break: break-all;">${resetLink}</a>
        </p>
        <p style="font-size: 12px; color:#999; margin-top: 28px;">If you didn't ask for this, you can ignore this email — your password won't change.</p>
      </div>
    `;

    await transporter.sendMail({
      from: getFromAddress(),
      to: email,
      subject: 'Reset your HybridX password',
      html,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return { success: false, error };
  }
}
