import fs from 'fs';
import path from 'path';
import pool from './connection';
import logger from '../utils/logger';

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

const withDbReady = async <T>(fn: () => Promise<T>): Promise<T> => {
  // On container restarts, Postgres can be "healthy" but still briefly refuse connections.
  // Retry for a short window to avoid failing the whole backend startup.
  const maxAttempts = 20; // ~30s worst case with backoff below
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      const transient =
        code === 'ECONNREFUSED' ||
        code === '57P03' || // cannot_connect_now
        code === '53300' || // too_many_connections
        msg.toLowerCase().includes('econnrefused');

      if (!transient || attempt === maxAttempts) break;

      const delay = Math.min(250 * Math.pow(1.35, attempt - 1), 2000);
      logger.warn(`DB not ready yet (attempt ${attempt}/${maxAttempts}). Retrying in ${Math.round(delay)}ms...`);
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

