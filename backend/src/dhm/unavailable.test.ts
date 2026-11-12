import { describe, expect, it } from 'vitest';
import { dhmUnavailableError } from './unavailable';

describe('dhmUnavailableError', () => {
  it('keeps the words the Integrations page knows and adds the reason', () => {
    expect(dhmUnavailableError(new Error('DHM token failed (401)'))).toBe('DHM unavailable: DHM token failed (401)');
    expect(dhmUnavailableError(new Error('connect ETIMEDOUT 10.0.0.1:443'))).toBe('DHM unavailable: connect ETIMEDOUT 10.0.0.1:443');
  });
  it('is one short line whatever the error holds', () => {
    const text = dhmUnavailableError(new Error(`a\n  b\n${'x'.repeat(500)}`));
    expect(text.includes('\n')).toBe(false);
    expect(text.length).toBeLessThanOrEqual('DHM unavailable: '.length + 160);
  });
  it('still says "DHM unavailable" when there is nothing to add', () => {
    expect(dhmUnavailableError(undefined)).toBe('DHM unavailable');
    expect(dhmUnavailableError(new Error('  '))).toBe('DHM unavailable');
  });
});
