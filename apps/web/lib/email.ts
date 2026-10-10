/**
 * Email driver for FitFusion AI (verification + password-reset emails).
 *
 * - `EMAIL_DRIVER=console` (default): logs the email and returns
 *   `{sent:true, driver:'console'}`. Honest for development.
 * - `EMAIL_DRIVER=smtp`: without SMTP config returns
 *   `{sent:false, reason:'not_configured'}` — no fake sends, ever.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  sent: boolean;
  driver: string;
  reason?: string;
}

function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM || 'FitFusion AI <no-reply@example.com>';
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const driver = (process.env.EMAIL_DRIVER || 'console').toLowerCase();

  if (driver === 'console') {
    console.log(
      `[email:console] from=${emailFrom()} to=${input.to} subject=${input.subject}`,
    );
    console.log(input.text ?? input.html);
    return { sent: true, driver: 'console' };
  }

  if (driver === 'smtp') {
    const configured = Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
    );
    if (!configured) {
      return { sent: false, driver: 'smtp', reason: 'not_configured' };
    }
    // No SMTP transport is wired in this build — report honestly rather
    // than pretending the mail was sent.
    return {
      sent: false,
      driver: 'smtp',
      reason: 'smtp transport not implemented in this build',
    };
  }

  return { sent: false, driver, reason: 'not_configured' };
}

export function verificationEmailHtml(name: string | null, link: string): string {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return `<p>${greeting}</p><p>Please verify your FitFusion AI email address by clicking the link below. It expires in 24 hours.</p><p><a href="${link}">Verify my email</a></p><p>If you didn't create an account, you can ignore this email.</p>`;
}

export function passwordResetEmailHtml(
  name: string | null,
  link: string,
): string {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return `<p>${greeting}</p><p>We received a request to reset your FitFusion AI password. Click the link below to choose a new one. It expires in 1 hour.</p><p><a href="${link}">Reset my password</a></p><p>If you didn't request this, you can ignore this email.</p>`;
}

export function verificationLink(token: string): string {
  return `${appUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
}

export function passwordResetLink(token: string): string {
  return `${appUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`;
}
