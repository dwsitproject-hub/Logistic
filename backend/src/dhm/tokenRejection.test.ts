import { describe, expect, it } from 'vitest';
import { describeDhmRejection } from './client';

describe("DHM's reason for refusing a token", () => {
  /*
   * "DHM token failed (401)" alone looks the same for every cause. These are the cases the reason
   * has to tell apart, found while chasing a 401 on SIT on 2026-09-28.
   */
  it("passes DHM's own error message through", () => {
    expect(describeDhmRejection({ error: 'Application credentials required' })).toBe(
      ': Application credentials required',
    );
    expect(describeDhmRejection({ message: 'Invalid keys' })).toBe(': Invalid keys');
  });

  it('recognises the DHM portal answering instead of the API', () => {
    const html = '<!DOCTYPE html><html><head><title>DHM</title></head><body></body></html>';
    expect(describeDhmRejection(html)).toContain('DHM portal, not the API');
  });

  it('never repeats a private key, even if DHM were to echo one', () => {
    const echoed = describeDhmRejection({ error: 'bad key dhm_sk_0123456789abcdef' });
    expect(echoed).toContain('dhm_sk_***');
    expect(echoed).not.toContain('0123456789abcdef');
  });

  it('adds nothing when DHM gives no reason', () => {
    expect(describeDhmRejection(undefined)).toBe('');
    expect(describeDhmRejection({})).toBe('');
    expect(describeDhmRejection('   ')).toBe('');
  });
});
