/**
 * Classification guard. The costly mistakes are in both directions:
 *
 * - Missing a genuinely transient failure makes startup treat a busy database as
 *   fatal and crash-loop the container (staging, 2026-07-31).
 * - Treating a deterministic failure as transient retries a statement that can never
 *   succeed, burning CPU on an already-saturated server.
 */

import { describe, it, expect } from 'vitest';
import { isTransientDbError, transientRetryDelayMs } from './transientDbError';

describe('isTransientDbError', () => {
  it('treats pool connection-timeout errors as transient even though pg sets no code', () => {
    // This is the exact shape pg raises when the pool cannot hand out a connection,
    // i.e. what happens when the database is CPU-saturated. It has NO `code`.
    expect(isTransientDbError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(
      isTransientDbError(new Error('Connection terminated due to connection timeout')),
    ).toBe(true);
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  it('treats socket-level and connection-class failures as transient', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE']) {
      expect(isTransientDbError(Object.assign(new Error('socket'), { code }))).toBe(true);
    }
    for (const code of ['08000', '08006', '08004']) {
      expect(isTransientDbError(Object.assign(new Error('conn'), { code }))).toBe(true);
    }
  });

  it('treats server startup, recovery and connection exhaustion as transient', () => {
    expect(isTransientDbError(Object.assign(new Error('x'), { code: '57P03' }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error('x'), { code: '53300' }))).toBe(true);
    expect(isTransientDbError(new Error('the database system is in recovery mode'))).toBe(true);
    expect(isTransientDbError(new Error('the database system is starting up'))).toBe(true);
  });

  it('does NOT retry deterministic SQL errors - this is the CPU-loop guard', () => {
    // 42P18: the exact class behind the 2026-07-27 incident (untyped parameter $50).
    // Retrying it could never succeed and re-parses a huge statement every time.
    expect(
      isTransientDbError(
        Object.assign(new Error('could not determine data type of parameter $50'), {
          code: '42P18',
        }),
      ),
    ).toBe(false);
    // 42P01: the alias-scoping class ("invalid reference to FROM-clause entry").
    expect(
      isTransientDbError(
        Object.assign(new Error('invalid reference to FROM-clause entry for table "t"'), {
          code: '42P01',
        }),
      ),
    ).toBe(false);
    // Constraint violations and statement timeouts are not connection problems.
    expect(isTransientDbError(Object.assign(new Error('dup'), { code: '23505' }))).toBe(false);
    expect(
      isTransientDbError(
        Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        }),
      ),
    ).toBe(false);
  });

  it('handles junk input without throwing', () => {
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError({})).toBe(false);
    expect(isTransientDbError('ECONNREFUSED')).toBe(false); // a bare string is not an error object
  });
});

describe('transientRetryDelayMs', () => {
  it('grows exponentially and honours the cap', () => {
    const noJitter = () => 1;
    expect(transientRetryDelayMs(1, { random: noJitter })).toBe(250);
    expect(transientRetryDelayMs(2, { random: noJitter })).toBe(500);
    expect(transientRetryDelayMs(3, { random: noJitter })).toBe(1000);
    expect(transientRetryDelayMs(20, { random: noJitter })).toBe(5000); // capped
  });

  it('always yields a positive delay so a retry never hot-spins', () => {
    // Full jitter can return ~0; the floor is what stops a busy-loop against a
    // struggling database.
    expect(transientRetryDelayMs(1, { random: () => 0 })).toBeGreaterThanOrEqual(50);
    expect(transientRetryDelayMs(10, { random: () => 0 })).toBeGreaterThanOrEqual(50);
  });

  it('spreads retries across the window, which is what defuses a reconnect storm', () => {
    // Ten clients that lost their connection simultaneously must not all retry at the
    // same instant (staging 2026-07-30: 14 connections inside 50ms, all rejected).
    const delays = new Set(
      Array.from({ length: 10 }, (_, i) => transientRetryDelayMs(5, { random: () => i / 10 })),
    );
    expect(delays.size).toBeGreaterThan(5);
  });
});
