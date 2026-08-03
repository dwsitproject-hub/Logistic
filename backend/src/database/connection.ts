import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger';
import { isTransientDbError, transientRetryDelayMs } from './transientDbError';

dotenv.config();

const poolMax = parseInt(process.env.DB_POOL_MAX || '40', 10);
const poolConnectionTimeoutMs = parseInt(
  process.env.DB_POOL_CONNECTION_TIMEOUT_MS ||
    process.env.DB_CONNECTION_TIMEOUT_MS ||
    '10000',
  10,
);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'klip_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 40,
  idleTimeoutMillis: 30000,
  // Time allowed to acquire a pool slot AND finish the TCP + auth handshake.
  // 2s was written when Postgres was a container on the same Docker network
  // (sub-millisecond). On staging the DB is a separate VM (DB_HOST=172.28.92.60,
  // DB_PORT=5442), where a network hop plus any pool contention exceeds 2s and the
  // request fails with "Connection terminated due to connection timeout" - observed
  // on staging 2026-07-31. Env-overridable so a slow link can be tuned without a
  // code change; the default is generous rather than tight because the failure mode
  // of being too low is a user-visible 500, while being too high only delays an
  // error that was going to happen anyway.
  connectionTimeoutMillis:
    Number.isFinite(poolConnectionTimeoutMs) && poolConnectionTimeoutMs > 0
      ? poolConnectionTimeoutMs
      : 10000,
  // Keep idle sockets alive across the network hop. Without this, NAT / firewall
  // idle timeouts silently drop connections that the pool still believes are good;
  // the next use surfaces ECONNRESET on an idle client (see the 'error' handler).
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Disable PostgreSQL JIT compilation for this app's connections. The generated
  // list/report queries contain hundreds of expressions, which trips the JIT cost
  // thresholds and makes Postgres spend most of the query time LLVM-compiling them
  // on EVERY execution (measured: trucking list 11.7s -> 2.3s with jit off; JIT was
  // ~9.7s of it). JIT only changes how the executor evaluates expressions, never
  // query results or plans, so this is a pure latency win for our workload.
  options: '-c jit=off',
});

pool.on('connect', () => {
  logger.info('Database connected successfully');
});

/**
 * Idle-client error handler.
 *
 * This used to call process.exit(-1), which killed the whole API whenever a single
 * pooled connection died while idle. That was survivable when Postgres was a
 * container on the same Docker network, because an idle socket there effectively
 * never breaks. With the DB on a separate VM, the network path drops idle
 * connections routinely, so every drop took the entire backend down; Docker
 * restarted it and every in-flight request failed, login included (observed on
 * staging 2026-07-31: 79 connection-error log entries across idle-client errors,
 * connection timeouts and ECONNRESETs, plus a process restart 13 minutes after
 * deploy, with the DB itself healthy and reachable throughout).
 *
 * `pg` already removes the failed client from the pool and creates a fresh one on
 * the next checkout, so there is nothing for the process to recover from - exiting
 * bought no safety and cost availability. We log at error level so the volume stays
 * visible: a steady stream here means the network path is dropping connections and
 * is worth investigating, even though it no longer causes an outage.
 */
export const handleIdlePoolError = (err: Error): void => {
  logger.error('Unexpected error on idle client (connection dropped, pool will recover)', err);
};

pool.on('error', handleIdlePoolError);

export const QUERY_TRANSIENT_MAX_ATTEMPTS = 3;

/** Retry pool.query on transient connection failures (staging DB is a separate VM). */
export async function runPoolQueryWithRetry(
  run: () => Promise<QueryResult>,
  options?: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<QueryResult> {
  const maxAttempts = options?.maxAttempts ?? QUERY_TRANSIENT_MAX_ATTEMPTS;
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientDbError(error)) {
        throw error;
      }
      const delay = transientRetryDelayMs(attempt);
      logger.warn(
        `Transient DB error on query (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`,
        { message: (error as Error).message },
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

export const query = async (text: string, params?: any[]): Promise<QueryResult> => {
  const start = Date.now();
  try {
    const res = await runPoolQueryWithRetry(() => pool.query(text, params));
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Query error', { text, error });
    throw error;
  }
};

export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  // Checked-out clients can emit 'error' when the network drops mid-request; without a
  // listener Node treats it as fatal and the whole API exits (502 for every caller).
  client.on('error', (err) => {
    logger.error('Unexpected error on checked-out client (connection dropped)', err);
  });
  return client;
};

export default pool;

