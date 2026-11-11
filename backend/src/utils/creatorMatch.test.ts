import { describe, expect, it } from 'vitest';
import { matchCreatorForUser, type CreatorOption } from './creatorMatch';

const OPTIONS: CreatorOption[] = [
  { userId: '04124040143', name: 'VICKY' },
  { userId: '62237590905', name: 'DEWI SISWANTI' },
  { userId: '04126010289', name: 'NICOLE CELESTINA' },
  { userId: '62217595502', name: 'IRENA PERMATA SUCI' },
  { userId: '11111111111', name: 'BUDI SANTOSO' },
  { userId: '22222222222', name: 'SANTOSO BUDI' },
];

describe('matchCreatorForUser', () => {
  it('matches first.last in the e-mail to the SAP name, and a one-word name written twice', () => {
    expect(matchCreatorForUser({ email: 'vicky.vicky@energi-up.com' }, OPTIONS)?.userId).toBe('04124040143');
    expect(matchCreatorForUser({ email: 'dewi.siswanti@energi-up.com' }, OPTIONS)?.userId).toBe('62237590905');
    expect(matchCreatorForUser({ email: 'Nicole.Celestina@energi-up.com' }, OPTIONS)?.userId).toBe('04126010289');
  });
  it('falls back to the full name when the e-mail does not say it', () => {
    expect(matchCreatorForUser({ email: 'svc-mcp@energi-up.com', fullName: 'Dewi Siswanti' }, OPTIONS)?.userId).toBe('62237590905');
  });
  it('gives nothing when no one matches or when the e-mail says more or less than the name', () => {
    expect(matchCreatorForUser({ email: 'ryan.pohan@energi-up.com' }, OPTIONS)).toBeNull();
    expect(matchCreatorForUser({ email: 'dewi.siswanti.bontang@energi-up.com' }, OPTIONS)).toBeNull();
    expect(matchCreatorForUser({ email: 'irena.suci@energi-up.com' }, OPTIONS)).toBeNull();
    expect(matchCreatorForUser({ email: '' }, OPTIONS)).toBeNull();
    expect(matchCreatorForUser({}, [])).toBeNull();
  });
  it('gives nothing when two SAP users have the same words (never guesses)', () => {
    expect(matchCreatorForUser({ email: 'budi.santoso@energi-up.com' }, OPTIONS)).toBeNull();
  });
});
