/**
 * Clear group_plant on all master_plants rows (staging / pre re-upload).
 *
 * Usage (preview only — default):
 *   cd backend
 *   npm run cleanup:master-plant-group
 *
 * Execute:
 *   npm run cleanup:master-plant-group:confirm
 *
 * On the staging HOST (outside Docker), backend/.env often has DB_HOST=postgres.
 * This script auto-uses 127.0.0.1 and port 5433 (see docker-compose.backend.yml).
 * Override: SCRIPT_DB_HOST / SCRIPT_DB_PORT
 *
 * Or via Postgres container:
 *   docker compose -f docker-compose.backend.yml exec postgres \
 *     psql -U postgres -d klip_db -c "UPDATE master_plants SET group_plant = NULL, updated_at = CURRENT_TIMESTAMP;"
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

type PlantPreviewRow = {
  company_name: string;
  plant_code: string;
  group_plant: string | null;
};

function resolveScriptDbConfig() {
  let host = process.env.SCRIPT_DB_HOST || process.env.DB_HOST || 'localhost';
  let port = parseInt(process.env.SCRIPT_DB_PORT || process.env.DB_PORT || '5432', 10);

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

    const beforeRes = await client.query<{ n: number }>(
      `
      SELECT COUNT(*)::int AS n
      FROM master_plants
      WHERE group_plant IS NOT NULL AND NULLIF(TRIM(group_plant), '') IS NOT NULL
      `,
    );
    const before = beforeRes.rows[0]?.n ?? 0;

    const preview = await client.query<PlantPreviewRow>(
      `
      SELECT company_name, plant_code, group_plant
      FROM master_plants
      WHERE group_plant IS NOT NULL AND NULLIF(TRIM(group_plant), '') IS NOT NULL
      ORDER BY company_name, plant_code
      LIMIT 15
      `,
    );

    console.log(JSON.stringify({ rows_with_group_plant_before: before }, null, 2));
    if (preview.rows.length > 0) {
      console.log('Sample rows with group_plant (up to 15):');
      console.table(preview.rows);
    }

    if (!confirm) {
      console.log('\nDry run only — group_plant not cleared.');
      console.log('Re-run with --confirm to set all group_plant to NULL.');
      return;
    }

    if (before === 0) {
      console.log('No group_plant values found. Nothing to do.');
      return;
    }

    await client.query('BEGIN');
    const updateRes = await client.query(
      `
      UPDATE master_plants
      SET group_plant = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE group_plant IS NOT NULL
         OR NULLIF(TRIM(group_plant), '') IS NOT NULL
      `,
    );
    const afterRes = await client.query<{ n: number }>(
      `
      SELECT COUNT(*)::int AS n
      FROM master_plants
      WHERE group_plant IS NOT NULL AND NULLIF(TRIM(group_plant), '') IS NOT NULL
      `,
    );
    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          cleared: updateRes.rowCount ?? before,
          rows_with_group_plant_after: afterRes.rows[0]?.n ?? 0,
          status: 'ok',
        },
        null,
        2,
      ),
    );
    console.log('\nDone. Upload Master Plant Excel from KLIP UI to fill group_plant.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('clearMasterPlantGroupPlant failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
