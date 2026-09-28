import fs from 'fs';
import pool from './connection';
import logger from '../utils/logger';

/**
 * Applying ONE migration file, split out of migrate.ts so it can be exercised on its own: migrate.ts
 * runs every migration and exits the process as soon as it is imported.
 */
export const MIGRATIONS_TABLE = 'schema_migrations';

export const markApplied = async (
  filename: string,
  executor: { query: typeof pool.query } = pool,
): Promise<void> => {
  await executor.query(
    `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING;`,
    [filename]
  );
};

export const applySqlFile = async (filePath: string, filename: string): Promise<void> => {
  const sql = fs.readFileSync(filePath, 'utf-8');
  logger.info(`Applying migration: ${filename}`);

  /*
   * One dedicated connection for the whole migration.
   *
   * This used to issue BEGIN, the migration and COMMIT as three separate pool.query calls - and the
   * pool (up to 40 connections) is free to serve each call from a different one. BEGIN could open a
   * transaction on connection A while the migration ran autocommitted on connection B, and a
   * ROLLBACK after a failure landed on a connection holding nothing: a half-applied, unrecorded
   * migration that the next boot would run again. The row marking it applied could land outside
   * its own transaction the same way. It worked in practice because the pool tends to hand back the
   * connection it just got - which is luck, not a guarantee. Migrations 155, 159 and 160 all note
   * "deliberately NOT CONCURRENTLY: applySqlFile wraps every migration in BEGIN/COMMIT", so their
   * authors were relying on exactly the guarantee this now actually provides.
   *
   * The connection also carries the notice listener: RAISE NOTICE from a migration used to vanish,
   * because the pool does not forward notices. A migration that reports what it changed (190 does:
   * "contracts=1, sap_processed_data=1, ...") is now readable in the deploy log.
   */
  const client = await pool.connect();
  const onNotice = (msg: { message?: string }) => {
    logger.info(`[${filename}] ${msg.message ?? ''}`);
  };
  client.on('notice', onNotice);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await markApplied(filename, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.removeListener('notice', onNotice);
    client.release();
  }
};
