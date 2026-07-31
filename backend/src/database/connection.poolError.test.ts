/**
 * The idle-client error handler must never terminate the process.
 *
 * Regression guard for the staging outage on 2026-07-31: the handler called
 * process.exit(-1), so a single idle connection dropped by the network path between
 * the backend VM and the DB VM took the whole API down and made logins fail
 * intermittently. `pg` recovers the pool on its own; the handler only needs to log.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('handleIdlePoolError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('logs the error and does not exit the process', async () => {
    const { handleIdlePoolError } = await import('./connection');
    const logger = (await import('../utils/logger')).default;

    // Fail loudly rather than actually exiting if the guard ever regresses.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code}) called - the API must survive an idle client error`);
      }) as never);

    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    expect(() => handleIdlePoolError(err)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);

    // The dropped connection must stay visible in the logs, with the cause attached.
    const [message, passedErr] = (logger.error as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(String(message)).toMatch(/idle client/i);
    expect(passedErr).toBe(err);
  });

  it('survives repeated drops, as happens when the network path reaps idle sockets', async () => {
    const { handleIdlePoolError } = await import('./connection');
    const logger = (await import('../utils/logger')).default;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    for (let i = 0; i < 25; i += 1) {
      handleIdlePoolError(new Error(`drop ${i}`));
    }

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(25);
  });
});
