import nodemailer, { Transporter } from 'nodemailer';
import logger from '../utils/logger';

export interface SendEmailInput {
  to: string[];
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
    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject: input.subject,
      html: input.html,
    });
    logger.info('Email sent', { subject: input.subject, recipientCount: recipients.length });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { subject: input.subject, error });
    return false;
  }
}
