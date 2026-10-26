import { afterEach, describe, expect, it, vi } from 'vitest';
import { authEmailAppFrom, buildInvitationEmail, buildPasswordResetEmail, buildSetPasswordUrl } from './authEmail.service';

describe('buildSetPasswordUrl', () => {
  it('points at the set-password page with the token in the query', () => {
    expect(buildSetPasswordUrl('abc_DEF-1', 'https://klip.example.test')).toBe(
      'https://klip.example.test/set-password?token=abc_DEF-1',
    );
  });

  it('does not double the slash of a base URL that ends with one', () => {
    expect(buildSetPasswordUrl('t', 'https://klip.example.test/')).toBe('https://klip.example.test/set-password?token=t');
  });

  it('encodes a token with reserved characters', () => {
    expect(buildSetPasswordUrl('a+b/c', 'https://k.test')).toBe('https://k.test/set-password?token=a%2Bb%2Fc');
  });
});

describe('auth e-mails', () => {
  const link = 'https://klip.example.test/set-password?token=abc';

  it('the invitation greets the user, carries the link and states how long it lasts', () => {
    const mail = buildInvitationEmail({ fullName: 'Sari Dewi', link });
    expect(mail.subject).toMatch(/set your password/i);
    expect(mail.html).toContain('Hi Sari Dewi');
    expect(mail.html).toContain(link);
    expect(mail.html).toContain('72 hours');
  });

  it('the reset e-mail carries the link and says the old password stays if it was not requested', () => {
    const mail = buildPasswordResetEmail({ fullName: null, link });
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.html).toContain('Hi there');
    expect(mail.html).toContain(link);
    expect(mail.html).toContain('60 minutes');
    expect(mail.html).toMatch(/current password stays/);
  });

  it('escapes a name that carries markup', () => {
    const mail = buildInvitationEmail({ fullName: '<script>alert(1)</script>', link });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('escapes the link it prints into the page', () => {
    const mail = buildPasswordResetEmail({ fullName: 'A', link: 'https://k.test/set-password?token=a&b="x"' });
    expect(mail.html).not.toContain('token=a&b="x"');
    expect(mail.html).toContain('token=a&amp;b=&quot;x&quot;');
  });
});

describe('Commercial Documents links', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honours app=commercial only when COMMDOCS_URL is configured', () => {
    vi.stubEnv('COMMDOCS_URL', '');
    expect(authEmailAppFrom('commdocs')).toBe('klip');
    vi.stubEnv('COMMDOCS_URL', 'https://docs.example.test/');
    expect(authEmailAppFrom('commdocs')).toBe('commdocs');
    expect(authEmailAppFrom('commercial')).toBe('commdocs');
    expect(authEmailAppFrom('https://evil.test')).toBe('klip');
    expect(authEmailAppFrom(undefined)).toBe('klip');
  });

  it('names the Commercial Documents app instead of KLIP', () => {
    const link = 'https://docs.example.test/set-password?token=abc';
    const invite = buildInvitationEmail({ fullName: 'A', link, app: 'commdocs' });
    expect(invite.subject).toBe('Your Commercial Documents account is ready - set your password');
    expect(invite.html).not.toContain('KLIP');
    const reset = buildPasswordResetEmail({ fullName: 'A', link, app: 'commdocs' });
    expect(reset.subject).toBe('Reset your Commercial Documents password');
    expect(reset.html).not.toContain('KLIP');
  });
});
