import { describe, expect, it } from 'vitest';
import { buildInvitationEmail, buildPasswordResetEmail, buildSetPasswordUrl } from './authEmail.service';

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
