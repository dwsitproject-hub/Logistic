/**
 * Every kind of email KLIP sends, with the switch that turns it on or off (Integrations > Email).
 *
 * One master switch (EMAIL_ENABLED) stops all of them; each feature also has its own. The switches are ordinary integration settings, so an ADMIN changes them from the app and they
 * take effect at once (nothing is read at boot). A switch nobody ever saved falls back to the feature's default, which is what KLIP did before the switches existed: the first four were
 * always on (the mail simply went when SMTP was set up), the Submit to Jetty mail was already opt-in.
 *
 * The gate lives in sendEmail (services/email.service.ts): a caller names its feature, and a mail whose feature is off is not sent. A test mail an administrator asks for in Integrations names
 * no feature, so it still goes: it is a deliberate check of the mail server, not one of these.
 */
import { integrationEnv } from '../integrations/integrationEnv';

export type EmailFeatureId = 'eta_reminder' | 'sap_import_report' | 'invitation' | 'password_reset' | 'jps_submit';

export interface EmailFeatureDef {
  id: EmailFeatureId;
  /** The integration setting that holds the switch. */
  key: string;
  label: string;
  /** What the switch reads while nobody has saved it. */
  defaultOn: boolean;
}

export const EMAIL_MASTER_KEY = 'EMAIL_ENABLED';

export const EMAIL_FEATURES: Record<EmailFeatureId, EmailFeatureDef> = {
  eta_reminder: { id: 'eta_reminder', key: 'EMAIL_ETA_REMINDER_ENABLED', label: 'Contract ETA reminder', defaultOn: true },
  sap_import_report: { id: 'sap_import_report', key: 'EMAIL_SAP_IMPORT_REPORT_ENABLED', label: 'SAP auto-import report', defaultOn: true },
  invitation: { id: 'invitation', key: 'EMAIL_INVITATION_ENABLED', label: 'User invitation', defaultOn: true },
  password_reset: { id: 'password_reset', key: 'EMAIL_PASSWORD_RESET_ENABLED', label: 'Password reset', defaultOn: true },
  // Kept under its original name: it was the first of these switches (Integrations > JPS), and a value already saved keeps working.
  jps_submit: { id: 'jps_submit', key: 'JPS_NOTIFY_ENABLED', label: 'Email after Submit to Jetty', defaultOn: false },
};

/** 'true' / 'false' (any case) are answers; anything else, including nothing, means "not decided" and the default applies. */
export function switchValue(raw: string | null | undefined, defaultOn: boolean): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return defaultOn;
}

export type EmailBlockedReason = 'master_off' | 'feature_off';

type Reader = (key: string) => string | undefined;

/** Why a feature's mail would not be sent right now, or null when it would be. The master switch is judged first. */
export function emailBlockedReason(id: EmailFeatureId, read: Reader = integrationEnv): EmailBlockedReason | null {
  if (!switchValue(read(EMAIL_MASTER_KEY), true)) return 'master_off';
  const feature = EMAIL_FEATURES[id];
  if (!switchValue(read(feature.key), feature.defaultOn)) return 'feature_off';
  return null;
}

export function isEmailFeatureEnabled(id: EmailFeatureId, read: Reader = integrationEnv): boolean {
  return emailBlockedReason(id, read) === null;
}
