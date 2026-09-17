import fs from 'fs';
import path from 'path';
import pool from './connection';
import logger from '../utils/logger';
import { isTransientDbError, transientRetryDelayMs } from './transientDbError';

const MIGRATIONS_TABLE = 'schema_migrations';

const ensureMigrationsTable = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Backward/forward compatibility: some DBs may not have pgcrypto yet
  // (gen_random_uuid). Ensure it exists so the table definition is safe.
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
};

const tableExists = async (tableName: string): Promise<boolean> => {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1;`,
    [tableName]
  );
  return (res.rowCount ?? 0) > 0;
};

const getAppliedMigrationSet = async (): Promise<Set<string>> => {
  const res = await pool.query(`SELECT filename FROM ${MIGRATIONS_TABLE};`);
  return new Set(res.rows.map((r) => r.filename));
};

const markApplied = async (filename: string): Promise<void> => {
  await pool.query(
    `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING;`,
    [filename]
  );
};

const readSqlFiles = (migrationsDir: string): string[] => {
  if (!fs.existsSync(migrationsDir)) return [];

  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
};

const applySqlFile = async (filePath: string, filename: string): Promise<void> => {
  const sql = fs.readFileSync(filePath, 'utf-8');
  logger.info(`Applying migration: ${filename}`);

  await pool.query('BEGIN');
  try {
    await pool.query(sql);
    await markApplied(filename);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Total time startup will keep trying to reach the database before giving up.
 *
 * The previous budget was ~30s of attempt-counted backoff, and the transient test
 * only recognised ECONNREFUSED / 57P03 / 53300. A CPU-saturated database fails
 * differently: the pool gives up handing out a connection and `pg` raises a plain
 * Error with no code ("timeout exceeded when trying to connect"). That was treated
 * as permanent, so migrate() threw on the first attempt, the entrypoint exited, and
 * the container crash-looped - each restart opening a fresh burst of connections
 * into the database that was already struggling (staging, 2026-07-31: backend down
 * with health 000 while the database was up and reachable).
 *
 * A busy database is a wait-for condition, not a fatal one, so the budget is now
 * time-boxed and generous enough to ride out a CPU spike. It is deliberately finite:
 * if the database is genuinely unreachable the container must still fail visibly
 * rather than hang forever.
 */
const DB_STARTUP_WAIT_MS = Math.max(
  5_000,
  parseInt(process.env.DB_STARTUP_WAIT_MS || '180000'),
);

const withDbReady = async <T>(fn: () => Promise<T>): Promise<T> => {
  const deadline = Date.now() + DB_STARTUP_WAIT_MS;
  let attempt = 0;
  let lastErr: unknown;

  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;

      // Deterministic failures (bad SQL in a migration, constraint violations) must
      // fail fast - retrying cannot help and only loads a struggling server.
      if (!isTransientDbError(err)) break;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const delay = Math.min(transientRetryDelayMs(attempt), remaining);
      logger.warn(
        `DB not ready yet (attempt ${attempt}, ${Math.round(remaining / 1000)}s of budget left). Retrying in ${delay}ms...`,
        { code: (err as { code?: unknown })?.code, message: (err as { message?: unknown })?.message },
      );
      await sleep(delay);
    }
  }
  throw lastErr;
};

const migrate = async () => {
  try {
    logger.info('Starting database migration...');

    // Ensure pgcrypto exists early (needed by some migrations using gen_random_uuid())
    await withDbReady(() => pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`));
    await withDbReady(() => ensureMigrationsTable());

    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = readSqlFiles(migrationsDir);

    const applied = await withDbReady(() => getAppliedMigrationSet());

    // Backward compatibility: older DBs might already have the schema created
    // (via the previous schema.sql-only runner). If so, mark the initial migration as applied.
    const hasUsers = await withDbReady(() => tableExists('users'));
    const initialMigration = migrationFiles.find((f) => f.startsWith('001_'));
    if (hasUsers && initialMigration && !applied.has(initialMigration)) {
      logger.info(
        `Detected existing schema (users table exists). Marking ${initialMigration} as applied.`
      );
      await withDbReady(() => markApplied(initialMigration));
      applied.add(initialMigration);
    }

    for (const filename of migrationFiles) {
      if (applied.has(filename)) continue;
      await withDbReady(() => applySqlFile(path.join(migrationsDir, filename), filename));
    }

    logger.info('Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Database migration failed:', error);
    process.exit(1);
  }
};

migrate();

