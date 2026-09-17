import { describe, expect, it } from 'vitest';
import { deriveUsernameFromEmail, normalizeEmail } from './userIdentity';

describe('userIdentity', () => {
  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Admin@KLIP.com  ')).toBe('admin@klip.com');
  });

  it('deriveUsernameFromEmail matches normalized email', () => {
    expect(deriveUsernameFromEmail('User@Example.com')).toBe('user@example.com');
  });
});
