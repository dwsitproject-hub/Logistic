import { describe, expect, it } from 'vitest';
import { boundJson, inferJpsCallKind, stoKeyFromReference } from './callLog';

describe('boundJson', () => {
  it('stores a small body as it is and nothing as null', () => {
    expect(boundJson({ a: 1 })).toBe('{"a":1}');
    expect(boundJson(null)).toBeNull();
    expect(boundJson(undefined)).toBeNull();
  });

  it('keeps the start of a body over the cap instead of dropping it', () => {
    const big = { text: 'x'.repeat(40_000) };
    const parsed = JSON.parse(boundJson(big) as string);
    expect(parsed.truncated).toBe(true);
    expect(parsed.chars).toBeGreaterThan(40_000);
    expect(String(parsed.preview).length).toBe(32_000);
  });

  it('survives a body that cannot be serialised', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(JSON.parse(boundJson(loop) as string)).toEqual({ unserializable: true });
  });
});

describe('inferJpsCallKind', () => {
  it('names a call from its shape', () => {
    expect(inferJpsCallKind('POST', '/shipping-instructions')).toBe('submit');
    expect(inferJpsCallKind('patch', '/shipping-instructions/7')).toBe('amend');
    expect(inferJpsCallKind('PATCH', '/shipping-instructions')).toBe('amend');
    expect(inferJpsCallKind('GET', '/shipping-instructions/7')).toBe('poll');
    expect(inferJpsCallKind('GET', '/shipping-instructions')).toBe('recover');
    expect(inferJpsCallKind('GET', '/terms')).toBe('test');
    expect(inferJpsCallKind('GET', '/agents')).toBe('other');
    expect(inferJpsCallKind(undefined, undefined)).toBe('other');
  });
});

describe('stoKeyFromReference', () => {
  it('reads the STO key back out of KLIP-<sto>-R<n>', () => {
    expect(stoKeyFromReference('KLIP-OP-1004031960-46588213-R1')).toBe('OP-1004031960-46588213');
    expect(stoKeyFromReference('KLIP-1006020016-R11')).toBe('1006020016');
  });

  it('answers null for anything else', () => {
    expect(stoKeyFromReference('something else')).toBeNull();
    expect(stoKeyFromReference(undefined)).toBeNull();
  });
});
