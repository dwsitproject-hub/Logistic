import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
vi.mock('./logger', () => ({ default: { info: (...a: unknown[]) => info(...a) } }));

import { slowRequestLog } from './slowRequestLog';

function run(thresholdMs: number, waitMs: number) {
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  const req = { method: 'POST', originalUrl: '/api/commercial-documents/upload?x=1', user: { username: 'nicole' } };
  const next = vi.fn();
  slowRequestLog('commdocs', thresholdMs)(req as never, res as never, next);
  expect(next).toHaveBeenCalled();
  return new Promise<void>((resolve) => setTimeout(() => { res.emit('finish'); resolve(); }, waitMs));
}

describe('slowRequestLog', () => {
  beforeEach(() => info.mockReset());
  it('says nothing for a request under the threshold', async () => {
    await run(500, 5);
    expect(info).not.toHaveBeenCalled();
  });
  it('logs a slow request with its duration, status, user and no query string', async () => {
    await run(20, 40);
    expect(info).toHaveBeenCalledTimes(1);
    const [message, data] = info.mock.calls[0];
    expect(message).toBe('commdocs slow request');
    expect(data).toMatchObject({ method: 'POST', path: '/api/commercial-documents/upload', status: 200, user: 'nicole' });
    expect(data.ms).toBeGreaterThanOrEqual(20);
  });
});
