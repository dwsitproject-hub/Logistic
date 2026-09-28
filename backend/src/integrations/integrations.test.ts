import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSecretBoxConfigured, openSecret, sealSecret, SecretBoxError } from './secretBox';
import {
  findIntegration,
  findSetting,
  secretHint,
  validateCrossField,
  validateSettingValue,
  type SettingDef,
} from './registry';
import {
  hasIntegrationOverride,
  integrationEnv,
  onIntegrationSettingsChanged,
  replaceIntegrationOverrides,
} from './integrationEnv';
import { IntegrationSettingsError, saveIntegrationSettings } from './settingsStore';

const HEX_KEY = crypto.randomBytes(32).toString('hex');
const PUB = 'dhm_pk_fake0000000000000000000000000000000000';
const PRIV = 'dhm_sk_fake1111111111111111111111111111111111112222';

function def(integration: 'dhm' | 'jps', key: string): SettingDef {
  const i = findIntegration(integration);
  const d = i && findSetting(i, key);
  if (!d) throw new Error(`no such setting ${key}`);
  return d;
}

describe('secretBox', () => {
  const saved = process.env.INTEGRATION_SECRETS_KEY;
  beforeEach(() => {
    process.env.INTEGRATION_SECRETS_KEY = HEX_KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.INTEGRATION_SECRETS_KEY;
    else process.env.INTEGRATION_SECRETS_KEY = saved;
  });

  it('round-trips a secret', () => {
    const sealed = sealSecret(PRIV, 'dhm:DHM_PRIVATE_KEY');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(PRIV);
    expect(openSecret(sealed, 'dhm:DHM_PRIVATE_KEY')).toBe(PRIV);
  });

  it('accepts the key as base64 as well as hex', () => {
    process.env.INTEGRATION_SECRETS_KEY = Buffer.from(HEX_KEY, 'hex').toString('base64');
    expect(isSecretBoxConfigured()).toBe(true);
    expect(openSecret(sealSecret('x', 'c'), 'c')).toBe('x');
  });

  it('uses a fresh IV, so the same secret never seals to the same text', () => {
    expect(sealSecret(PRIV, 'c')).not.toBe(sealSecret(PRIV, 'c'));
  });

  it('refuses to seal without a usable master key', () => {
    delete process.env.INTEGRATION_SECRETS_KEY;
    expect(isSecretBoxConfigured()).toBe(false);
    expect(() => sealSecret(PRIV, 'c')).toThrow(SecretBoxError);
    process.env.INTEGRATION_SECRETS_KEY = 'too-short';
    expect(isSecretBoxConfigured()).toBe(false);
  });

  it('will not open a value moved to another row', () => {
    // DHM's private key copied into the JPS_API_KEY row must fail, not become the JPS key.
    const sealed = sealSecret(PRIV, 'dhm:DHM_PRIVATE_KEY');
    expect(() => openSecret(sealed, 'jps:JPS_API_KEY')).toThrow(SecretBoxError);
  });

  it('will not open a tampered value, or one sealed under another master key', () => {
    const sealed = sealSecret(PRIV, 'c');
    const parts = sealed.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    expect(() => openSecret([parts[0], parts[1], parts[2], ct.toString('base64')].join(':'), 'c')).toThrow(
      SecretBoxError,
    );
    process.env.INTEGRATION_SECRETS_KEY = crypto.randomBytes(32).toString('hex');
    expect(() => openSecret(sealed, 'c')).toThrow(SecretBoxError);
  });

  it('never echoes the secret in an error', () => {
    const sealed = sealSecret(PRIV, 'c');
    try {
      openSecret(sealed, 'other');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(PRIV);
    }
  });
});

describe('registry validation', () => {
  it('rejects the public key pasted as the private key, and says which is which', () => {
    const problem = validateSettingValue(def('dhm', 'DHM_PRIVATE_KEY'), PUB);
    expect(problem).toContain('dhm_sk_');
    expect(problem).toContain('dhm_pk_');
  });

  it('accepts a well-formed key pair', () => {
    expect(validateSettingValue(def('dhm', 'DHM_PRIVATE_KEY'), PRIV)).toBeNull();
    expect(validateSettingValue(def('dhm', 'DHM_PUBLIC_KEY'), PUB)).toBeNull();
  });

  it('catches the identical pair even when each value is well-formed on its own', () => {
    expect(validateCrossField('dhm', { DHM_PUBLIC_KEY: PUB, DHM_PRIVATE_KEY: PUB })).toHaveLength(1);
    expect(validateCrossField('dhm', { DHM_PUBLIC_KEY: PUB, DHM_PRIVATE_KEY: PRIV })).toHaveLength(0);
  });

  it('rejects rather than silently clamps a value below its minimum', () => {
    expect(validateSettingValue(def('jps', 'JPS_MIN_POLL_INTERVAL_MS'), '1000')).toContain('60000');
    expect(validateSettingValue(def('jps', 'JPS_MIN_POLL_INTERVAL_MS'), '300000')).toBeNull();
  });

  it('checks each kind', () => {
    expect(validateSettingValue(def('jps', 'JPS_ENABLED'), 'yes')).not.toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_ENABLED'), 'true')).toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_SWEEP_CRON'), 'every 15 min')).not.toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_SWEEP_CRON'), '*/15 * * * *')).toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_API_BASE_URL'), 'ftp://x')).not.toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_API_BASE_URL'), 'http://172.28.92.56:3080/api/v1/integrations')).toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_PORT_ID'), '1.5')).not.toBeNull();
  });

  it('rejects a key carrying an invisible character from a chat app', () => {
    // Zero-width space: not matched by \s, prefix still fine, length one longer - and DHM says 401.
    const zeroWidth = `dhm_sk_abc${String.fromCharCode(0x200b)}def`;
    expect(validateSettingValue(def('dhm', 'DHM_PRIVATE_KEY'), zeroWidth)).toContain('invisible');
    const nbsp = `dhm_sk_abc${String.fromCharCode(0xa0)}def`;
    expect(validateSettingValue(def('dhm', 'DHM_PRIVATE_KEY'), nbsp)).not.toBeNull();
    expect(validateSettingValue(def('dhm', 'DHM_PRIVATE_KEY'), 'dhm_sk_abcdef0123')).toBeNull();
  });

  it('rejects empty values and stray whitespace', () => {
    expect(validateSettingValue(def('jps', 'JPS_API_KEY'), '')).not.toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_API_KEY'), ' abc')).not.toBeNull();
    expect(validateSettingValue(def('jps', 'JPS_API_KEY'), 'ab c')).not.toBeNull();
  });

  it('hints at a secret without revealing it', () => {
    const hint = secretHint(def('dhm', 'DHM_PRIVATE_KEY'), PRIV);
    expect(hint).toBe(`dhm_sk_...${PRIV.slice(-4)} (${PRIV.length})`);
    expect(hint).not.toContain(PRIV.slice(7, -4));
    // No known prefix: only the tail and the length.
    expect(secretHint(def('jps', 'JPS_API_KEY'), 'abcdefghijkl')).toBe('...ijkl (12)');
    // Too short to show any of it.
    expect(secretHint(def('jps', 'JPS_API_KEY'), 'abcd')).toBe('... (4)');
  });
});

describe('integrationEnv', () => {
  afterEach(() => replaceIntegrationOverrides(new Map()));

  it('reads process.env when nothing is saved, so deploying it changes nothing', () => {
    process.env.JPS_REGION_SITE = 'BONTANG';
    expect(integrationEnv('JPS_REGION_SITE')).toBe('BONTANG');
    expect(hasIntegrationOverride('JPS_REGION_SITE')).toBe(false);
  });

  it('prefers a saved value over process.env', () => {
    process.env.JPS_REGION_SITE = 'BONTANG';
    replaceIntegrationOverrides(new Map([['JPS_REGION_SITE', 'KIJING']]));
    expect(integrationEnv('JPS_REGION_SITE')).toBe('KIJING');
  });

  it('tells every listener, even when one of them throws', () => {
    const second = vi.fn();
    const offA = onIntegrationSettingsChanged(() => {
      throw new Error('boom');
    });
    const offB = onIntegrationSettingsChanged(second);
    replaceIntegrationOverrides(new Map());
    expect(second).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});

describe('saving validates everything before writing anything', () => {
  const actor = { id: '00000000-0000-0000-0000-000000000001' };
  const saved = process.env.INTEGRATION_SECRETS_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.INTEGRATION_SECRETS_KEY;
    else process.env.INTEGRATION_SECRETS_KEY = saved;
  });

  async function problemsOf(promise: Promise<void>): Promise<string[]> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof IntegrationSettingsError) return error.problems;
      throw error;
    }
    throw new Error('expected the save to be rejected');
  }

  it('rejects the exact mistake of 2026-09-28: the public key in both fields', async () => {
    process.env.INTEGRATION_SECRETS_KEY = HEX_KEY;
    const problems = await problemsOf(
      saveIntegrationSettings('dhm', { values: { DHM_PUBLIC_KEY: PUB, DHM_PRIVATE_KEY: PUB } }, actor),
    );
    expect(problems.some((p) => p.includes('must begin with dhm_sk_'))).toBe(true);
    expect(problems.some((p) => p.includes('identical'))).toBe(true);
  });

  it('refuses a secret when the server has no master key', async () => {
    delete process.env.INTEGRATION_SECRETS_KEY;
    const problems = await problemsOf(
      saveIntegrationSettings('dhm', { values: { DHM_PRIVATE_KEY: PRIV } }, actor),
    );
    expect(problems.some((p) => p.includes('INTEGRATION_SECRETS_KEY'))).toBe(true);
  });

  it('rejects unknown integrations and settings that belong to another one', async () => {
    expect(await problemsOf(saveIntegrationSettings('sap', { values: {} }, actor))).toHaveLength(1);
    const problems = await problemsOf(
      saveIntegrationSettings('dhm', { values: { JPS_API_KEY: 'abc' } }, actor),
    );
    expect(problems.some((p) => p.includes('not a DHM'))).toBe(true);
  });

  it('will not save and revert the same key at once', async () => {
    const problems = await problemsOf(
      saveIntegrationSettings('jps', { values: { JPS_REGION_SITE: 'BONTANG' }, revert: ['JPS_REGION_SITE'] }, actor),
    );
    expect(problems.some((p) => p.includes('both saved and reverted'))).toBe(true);
  });
});
