import { sendEmail } from './email.service';
import { commercialDocsUrl, frontendUrl } from './sessionAuth.service';
import { INVITE_TTL_HOURS, RESET_TTL_MINUTES } from './authToken.service';

/** E-mails that carry a set-password link. Wording is English, like the rest of the UI. */

/**
 * Which front end a link opens: both apps share this backend and its users. 'commercial' is honoured only when COMMERCIAL_DOCS_URL
 * is configured, and the host always comes from the server's env - a request can pick the app, never the URL.
 */
export type AuthEmailApp = 'klip' | 'commercial';

export function authEmailAppFrom(value: unknown): AuthEmailApp {
  return value === 'commercial' && commercialDocsUrl() ? 'commercial' : 'klip';
}

function appBaseUrl(app: AuthEmailApp): string {
  return (app === 'commercial' && commercialDocsUrl()) || frontendUrl();
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSetPasswordUrl(token: string, baseUrl: string = frontendUrl()): string {
  return `${baseUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(token)}`;
}

function layout(title: string, bodyHtml: string, link: string, buttonLabel: string, footnote: string): string {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
      <tr><td>
        <h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h2>
        ${bodyHtml}
        <p style="margin:24px 0;">
          <a href="${safeLink}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;">${escapeHtml(buttonLabel)}</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">If the button does not work, copy this link into your browser:<br><a href="${safeLink}" style="color:#2563eb;word-break:break-all;">${safeLink}</a></p>
        <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(footnote)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildInvitationEmail(input: { fullName: string | null; link: string; app?: AuthEmailApp }): {
  subject: string;
  html: string;
} {
  const name = escapeHtml(input.fullName?.trim() || 'there');
  const product = input.app === 'commercial' ? 'Commercial Documents' : 'KLIP';
  const longProduct = input.app === 'commercial' ? 'Commercial Documents' : 'KLIP (KPN Logistics Intelligence Platform)';
  return {
    subject: `Your ${product} account is ready - set your password`,
    html: layout(
      `Welcome to ${product}`,
      `<p style="margin:0 0 12px;">Hi ${name},</p>
        <p style="margin:0;">An administrator created a ${longProduct} account for this e-mail address. Click the button below to choose your password and sign in for the first time.</p>`,
      input.link,
      'Set my password',
      `This link works once and expires in ${INVITE_TTL_HOURS} hours. If you did not expect this e-mail, you can ignore it.`,
    ),
  };
}

export function buildPasswordResetEmail(input: { fullName: string | null; link: string; app?: AuthEmailApp }): {
  subject: string;
  html: string;
} {
  const name = escapeHtml(input.fullName?.trim() || 'there');
  const product = input.app === 'commercial' ? 'Commercial Documents' : 'KLIP';
  return {
    subject: `Reset your ${product} password`,
    html: layout(
      'Reset your password',
      `<p style="margin:0 0 12px;">Hi ${name},</p>
        <p style="margin:0;">We received a request to reset the password of your ${product} account. Click the button below to choose a new one.</p>`,
      input.link,
      'Reset my password',
      `This link works once and expires in ${RESET_TTL_MINUTES} minutes. If you did not ask for this, ignore this e-mail - your current password stays as it is.`,
    ),
  };
}

export async function sendInvitationEmail(
  user: { email: string; fullName: string | null },
  token: string,
  app: AuthEmailApp = 'klip',
): Promise<boolean> {
  const mail = buildInvitationEmail({ fullName: user.fullName, link: buildSetPasswordUrl(token, appBaseUrl(app)), app });
  return sendEmail({ to: [user.email], subject: mail.subject, html: mail.html });
}

export async function sendPasswordResetEmail(
  user: { email: string; fullName: string | null },
  token: string,
  app: AuthEmailApp = 'klip',
): Promise<boolean> {
  const mail = buildPasswordResetEmail({ fullName: user.fullName, link: buildSetPasswordUrl(token, appBaseUrl(app)), app });
  return sendEmail({ to: [user.email], subject: mail.subject, html: mail.html });
}
