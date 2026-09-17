/**
 * Is this database error worth retrying?
 *
 * "Transient" means the statement/connection failed for a reason that may clear on
 * its own: the server is starting, recovering, out of connection slots, or the
 * network path or a saturated server made us give up before we got a connection.
 *
 * Everything else - syntax errors, type errors, constraint violations, invalid
 * references, a broken migration - is deterministic. Retrying those burns CPU on a
 * server that is already struggling and can never succeed, so they must fail fast.
 * That distinction is the whole point of this module: it is deliberately a
 * whitelist, and anything unrecognised is treated as permanent.
 *
 * Why the message matching matters as much as the codes: when a pool cannot hand
 * out a connection in time, `pg` raises a plain `Error` with NO `code` property
 * ("timeout exceeded when trying to connect", "Connection terminated due to
 * connection timeout"). Classifying on `err.code` alone therefore misses exactly
 * the case that occurs when the database is CPU-saturated - which on 2026-07-31
 * made backend startup treat a busy database as a fatal error and crash-loop the
 * container while the database itself was healthy.
 */

/** SQLSTATE codes and libpq/Node syscall codes that may clear on retry. */
const TRANSIENT_CODES = new Set([
  // Node / socket level
  'ECONNREFUSED', // server not accepting connections yet
  'ECONNRESET', // connection dropped mid-flight (idle reaping, restart)
  'ETIMEDOUT', // network path timed out
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EAI_AGAIN', // transient DNS failure
  // PostgreSQL SQLSTATE - class 08, connection exception
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  // PostgreSQL SQLSTATE - class 57, operator intervention
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (includes "the database system is in recovery mode")
  // Resource
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
]);

/**
 * Message fragments for failures `pg` reports without a usable `code`.
 * Matched case-insensitively against the error message.
 */
const TRANSIENT_MESSAGE_FRAGMENTS = [
  'timeout exceeded when trying to connect', // pool could not hand out a connection
  'connection terminated due to connection timeout',
  'connection terminated unexpectedly',
  'connection terminated',
  'terminating connection due to administrator command',
  'the database system is starting up',
  'the database system is in recovery mode',
  'econnrefused',
  'econnreset',
  'etimedout',
  'server closed the connection unexpectedly',
];

export function isTransientDbError(err: unknown): boolean {
  if (!err) return false;

  const code = String((err as { code?: unknown })?.code ?? '').trim();
  if (code && TRANSIENT_CODES.has(code)) return true;

  const message = String((err as { message?: unknown })?.message ?? '').toLowerCase();
  if (!message) return false;

  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/**
 * Backoff with full jitter.
 *
 * Jitter is not decoration here: without it, every connection the pool lost at the
 * same moment retries at the same moment, which is how a database restart turned
 * into a reconnect storm (14 connections inside 50 ms, all rejected, observed on
 * staging 2026-07-30). Spreading retries randomly across the window converts that
 * spike into a trickle the recovering server can absorb.
 */
export function transientRetryDelayMs(
  attempt: number,
  options?: { baseMs?: number; capMs?: number; random?: () => number },
): number {
  const baseMs = options?.baseMs ?? 250;
  const capMs = options?.capMs ?? 5000;
  const random = options?.random ?? Math.random;

  const exponential = Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), capMs);
  // Full jitter, floored so a retry always yields the event loop and never hot-spins.
  return Math.max(50, Math.round(random() * exponential));
}
