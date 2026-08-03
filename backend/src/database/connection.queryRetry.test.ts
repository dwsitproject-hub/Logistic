import { describe, it, expect, vi } from 'vitest';
import { runPoolQueryWithRetry } from './connection';

describe('runPoolQueryWithRetry', () => {
  it('retries on transient connection errors then succeeds', async () => {
    const transient = new Error('Connection terminated unexpectedly');
    const ok = { rows: [{ n: 1 }], rowCount: 1 } as never;
    const run = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(ok);

    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runPoolQueryWithRetry(run, { maxAttempts: 3, sleep });

    expect(result).toBe(ok);
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry deterministic SQL errors', async () => {
    const sqlErr = Object.assign(new Error('syntax error at or near "FROM"'), { code: '42601' });
    const run = vi.fn().mockRejectedValue(sqlErr);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runPoolQueryWithRetry(run, { maxAttempts: 3, sleep })).rejects.toBe(sqlErr);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
