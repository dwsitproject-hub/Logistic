import { describe, expect, it } from 'vitest';
import { createStepTimer, stampRequestStart } from './stepTimer';

describe('stepTimer', () => {
  it('records each step and a total, in a Server-Timing header', () => {
    const t = createStepTimer();
    t.mark('recv');
    t.mark('checks');
    t.mark('db');
    const s = t.summary();
    expect(Object.keys(s)).toEqual(['recv', 'checks', 'db', 'total']);
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(t.header()).toMatch(/^recv;dur=[\d.]+, checks;dur=[\d.]+, db;dur=[\d.]+, total;dur=[\d.]+$/);
  });
  it('the first step counts from the stamp the middleware left, not from when the timer was made', async () => {
    const res = { locals: {} as Record<string, unknown> };
    stampRequestStart({}, res, () => undefined);
    expect(typeof res.locals.requestStartNs).toBe('bigint');
    await new Promise((r) => setTimeout(r, 25));
    const t = createStepTimer(res.locals.requestStartNs as bigint);
    t.mark('recv');
    expect(t.summary().recv).toBeGreaterThanOrEqual(20);
  });
});
