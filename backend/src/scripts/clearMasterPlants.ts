/**
 * Clear all rows in master_plants (staging / pre-upload cleanup).
 *
 * Usage (preview only — default):
 *   cd backend
 *   npm run cleanup:master-plants
 *
 * Execute delete:
 *   npm run cleanup:master-plants:confirm
 *
 * On the staging HOST (outside Docker), backend/.env often has DB_HOST=postgres.
 * This script auto-uses 127.0.0.1 and port 5433 (see docker-compose.backend.yml).
 * Override: SCRIPT_DB_HOST / SCRIPT_DB_PORT
 *
 * Or via Postgres container (no Node DB config needed):
 *   docker compose -f docker-compose.backend.yml exec postgres \
 *     psql -U postgres -d klip_db -c "TRUNCATE TABLE master_plants;"
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

type PlantPreviewRow = {
  company_name: string;
  plant_code: string;
  plant_name: string | null;
  group_plant: string | null;
};

function resolveScriptDbConfig() {
  let host = process.env.SCRIPT_DB_HOST || process.env.DB_HOST || 'localhost';
  let port = parseInt(process.env.SCRIPT_DB_PORT || process.env.DB_PORT || '5432', 10);

  // backend/.env on staging uses Docker service names — not resolvable from the host shell.
  if (!process.env.SCRIPT_DB_HOST && (host === 'postgres' || host === 'klip-postgres')) {
    host = '127.0.0.1';
    port = parseInt(process.env.POSTGRES_PORT || '5433', 10);
  }

  return {
    host,
    port,
    database: process.env.DB_NAME || 'klip_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  };
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const dbConfig = resolveScriptDbConfig();
  const pool = new Pool(dbConfig);
  const client = await pool.connect();

  try {
    console.log(
      JSON.stringify(
        {
          connect: {
            host: dbConfig.host,
            port: dbConfig.port,
            database: dbConfig.database,
            user: dbConfig.user,
          },
        },
        null,
        2,
      ),
    );

    const countRes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM master_plants`,
    );
    const before = countRes.rows[0]?.n ?? 0;

    const preview = await client.query<PlantPreviewRow>(
      `
      SELECT company_name, plant_code, plant_name, group_plant
      FROM master_plants
      ORDER BY company_name, plant_code
      LIMIT 15
      `,
    );

    console.log(JSON.stringify({ master_plants_before: before }, null, 2));
    if (preview.rows.length > 0) {
      console.log('Sample rows (up to 15):');
      console.table(preview.rows);
    }

    if (!confirm) {
      console.log('\nDry run only — no rows deleted.');
      console.log('Re-run with --confirm to TRUNCATE master_plants.');
      return;
    }

    if (before === 0) {
      console.log('master_plants is already empty. Nothing to do.');
      return;
    }

    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE master_plants');
    const afterRes = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM master_plants`,
    );
    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          deleted: before,
          master_plants_after: afterRes.rows[0]?.n ?? 0,
          status: 'ok',
        },
        null,
        2,
      ),
    );
    console.log('\nDone. You can upload the new Master Plant file from the UI.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('clearMasterPlants failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
