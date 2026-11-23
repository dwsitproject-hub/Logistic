import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_FEATURES, EMAIL_MASTER_KEY, emailBlockedReason, isEmailFeatureEnabled, switchValue, type EmailFeatureId } from './emailFeatures';
import { findIntegration, findSetting, validateSettingValue } from '../integrations/registry';

const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...args: unknown[]) => sendMailMock(...args), verify: async () => true }) },
}));

const IDS = Object.keys(EMAIL_FEATURES) as EmailFeatureId[];
const reader = (values: Record<string, string>) => (key: string) => values[key];

describe('the switches of the emails KLIP sends', () => {
  it('reads true and false (any case) and otherwise the default', () => {
    expect(switchValue('true', false)).toBe(true);
    expect(switchValue(' FALSE ', true)).toBe(false);
    expect(switchValue(undefined, true)).toBe(true);
    expect(switchValue('', false)).toBe(false);
    expect(switchValue('maybe', true)).toBe(true);
  });

  it('keeps what KLIP did before the switches: the four old kinds are on, the Submit to Jetty mail stays off until switched on', () => {
    for (const id of ['eta_reminder', 'sap_import_report', 'invitation', 'password_reset'] as const) {
      expect(isEmailFeatureEnabled(id, reader({})), id).toBe(true);
    }
    expect(isEmailFeatureEnabled('jps_submit', reader({}))).toBe(false);
    expect(isEmailFeatureEnabled('jps_submit', reader({ JPS_NOTIFY_ENABLED: 'true' }))).toBe(true);
  });

  it('the master switch stops every kind, and is named first as the reason', () => {
    const off = reader({ [EMAIL_MASTER_KEY]: 'false', JPS_NOTIFY_ENABLED: 'true' });
    for (const id of IDS) expect(emailBlockedReason(id, off), id).toBe('master_off');
  });

  it('one feature off stops only that kind', () => {
    const read = reader({ EMAIL_ETA_REMINDER_ENABLED: 'false' });
    expect(emailBlockedReason('eta_reminder', read)).toBe('feature_off');
    expect(emailBlockedReason('invitation', read)).toBeNull();
    expect(emailBlockedReason('password_reset', read)).toBeNull();
  });
});

describe('the switches are settings of Integrations > Email', () => {
  const email = findIntegration('email')!;

  it('lists the master switch and one switch per kind, with the same default the code uses', () => {
    expect(email).toBeTruthy();
    expect(findSetting(email, EMAIL_MASTER_KEY)?.defaultValue).toBe('true');
    for (const id of IDS) {
      const def = findSetting(email, EMAIL_FEATURES[id].key);
      expect(def, id).toBeTruthy();
      expect(def?.kind).toBe('boolean');
      expect(def?.defaultValue, id).toBe(String(EMAIL_FEATURES[id].defaultOn));
      expect(def?.requiresRestart ?? false, `${id} takes effect at once`).toBe(false);
    }
  });

  it('the Submit to Jetty switch left the JPS panel (same key, one place)', () => {
    expect(findSetting(findIntegration('jps')!, 'JPS_NOTIFY_ENABLED')).toBeUndefined();
    expect(findSetting(email, 'JPS_NOTIFY_ENABLED')).toBeTruthy();
  });

  it('accepts true and false, nothing else', () => {
    const def = findSetting(email, EMAIL_MASTER_KEY)!;
    expect(validateSettingValue(def, 'false')).toBeNull();
    expect(validateSettingValue(def, 'yes')).not.toBeNull();
  });

  it('a migration refiles a value already saved for the Submit to Jetty switch under Email', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '272_email_switch_moves_to_email_integration.sql'), 'utf8');
    expect(sql).toContain("SET integration = 'email'");
    expect(sql).toContain("setting_key = 'JPS_NOTIFY_ENABLED'");
  });
});

describe('sendEmail honours the switches', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ accepted: ['a@x.com'], rejected: [], response: '250 OK', messageId: '<id>' });
    process.env.SMTP_HOST = 'mail.test';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.EMAIL_FROM = 'noreply@test';
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_INVITATION_ENABLED;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const mail = { to: ['a@x.com'], subject: 'S', html: '<p>x</p>' };

  it('sends a kind that is on', async () => {
    const { sendEmail } = await import('./email.service');
    expect(await sendEmail({ ...mail, feature: 'invitation' })).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a kind that is off, and never reaches the mail server', async () => {
    process.env.EMAIL_INVITATION_ENABLED = 'false';
    const { sendEmail } = await import('./email.service');
    expect(await sendEmail({ ...mail, feature: 'invitation' })).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
    // another kind is not held back
    expect(await sendEmail({ ...mail, feature: 'password_reset' })).toBe(true);
  });

  it('does not send anything while the master switch is off, but a test mail without a feature still goes', async () => {
    process.env.EMAIL_ENABLED = 'false';
    const { sendEmail } = await import('./email.service');
    expect(await sendEmail({ ...mail, feature: 'password_reset' })).toBe(false);
    expect(await sendEmail({ ...mail, feature: 'jps_submit' })).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(await sendEmail(mail)).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('the daily ETA reminder is skipped, with the reason, before it reads a single contract', async () => {
    process.env.EMAIL_ENABLED = 'false';
    const { runContractEtaReminderJob } = await import('./contractEtaReminder.service');
    const result = await runContractEtaReminderJob();
    expect(result.sent).toBe(false);
    expect(result.skipReason).toBe('email_master_off');
  });
});
