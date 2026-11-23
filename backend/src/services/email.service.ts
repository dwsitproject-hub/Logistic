import nodemailer, { Transporter } from 'nodemailer';
import logger from '../utils/logger';
import { emailBlockedReason, type EmailFeatureId } from './emailFeatures';

export interface SendEmailInput {
  /**
   * The kind of mail this is (services/emailFeatures.ts). A mail whose feature is switched off in Integrations > Email is not sent. Leave it out for a mail an administrator asked for
   * on purpose, such as a test of the mail server: it is never held back by those switches.
   */
  feature?: EmailFeatureId;
  to: string[];
  /** Copied recipients; optional. */
  cc?: string[];
  /** Files to attach, read from disk by the mailer when it sends. */
  attachments?: Array<{ filename: string; path: string }>;
  subject: string;
  html: string;
}

let cachedTransporter: Transporter | null = null;
let cachedTransporterKey: string | null = null;

/**
 * Lazily builds (and caches) the SMTP transporter from env vars. Re-built if the
 * relevant env vars change (e.g. hot-reload in dev), otherwise reused across sends.
 */
function getTransporter(): Transporter | null {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASSWORD || '';
  const rejectUnauthorized =
    String(process.env.SMTP_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false';

  const key = JSON.stringify({ host, port, secure, user, rejectUnauthorized });
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized },
  });
  cachedTransporterKey = key;
  return cachedTransporter;
}

/**
 * Sends an HTML email. Never throws — logs and returns false on any failure (missing SMTP
 * config, transport error, etc.) so callers (e.g. cron jobs) never crash the process.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  if (input.feature) {
    const blocked = emailBlockedReason(input.feature);
    if (blocked) {
      logger.info('sendEmail: not sent, this kind of email is switched off (Integrations > Email)', { feature: input.feature, reason: blocked, subject: input.subject });
      return false;
    }
  }
  const recipients = input.to.map((addr) => addr.trim()).filter(Boolean);
  if (recipients.length === 0) {
    logger.warn('sendEmail: no recipients provided, skipping', { subject: input.subject });
    return false;
  }

  const transporter = getTransporter();
  if (!transporter) {
    logger.warn('sendEmail: SMTP_HOST is not configured, skipping email send', {
      subject: input.subject,
    });
    return false;
  }

  const from = String(process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim();

  try {
    const info = await transporter.sendMail({
      from,
      to: recipients.join(', '),
      ...(input.cc && input.cc.length > 0 ? { cc: input.cc.map((addr) => addr.trim()).filter(Boolean).join(', ') } : {}),
      subject: input.subject,
      html: input.html,
      ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    });
    // What the mail server ANSWERED, not only that the call returned: an accepted message can still be filtered or bounced later, and a partly refused one
    // (rejected addresses) is otherwise indistinguishable from a delivered one. The addresses are counted, not listed.
    logger.info('Email sent', {
      subject: input.subject,
      recipientCount: recipients.length,
      ccCount: input.cc?.length ?? 0,
      attachmentCount: input.attachments?.length ?? 0,
      acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : undefined,
      rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : undefined,
      serverResponse: typeof info?.response === 'string' ? info.response.slice(0, 200) : undefined,
      messageId: info?.messageId,
    });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { subject: input.subject, error });
    return false;
  }
}

/**
 * Whether the mail server accepts KLIP's login, without sending anything (nodemailer verify: connect, TLS, AUTH). For Integrations > Email > Test connection.
 * The answer carries the server's code and wording, never a credential.
 */
export async function verifySmtpConnection(): Promise<{ ok: boolean; message: string }> {
  const transporter = getTransporter();
  if (!transporter) return { ok: false, message: 'SMTP_HOST is not configured (backend .env).' };
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  try {
    await transporter.verify();
    return { ok: true, message: `The mail server accepted KLIP's login (${host}:${port}, ${secure ? 'TLS from the start' : 'STARTTLS'}). Nothing was sent.` };
  } catch (error) {
    const e = error as { code?: string; responseCode?: number; response?: string; message?: string };
    const detail = [e.code, e.responseCode, e.response || e.message].filter((part) => part != null && part !== '').join(' ');
    return { ok: false, message: `${host}:${port}: ${detail || 'the connection failed'}`.slice(0, 300) };
  }
}
