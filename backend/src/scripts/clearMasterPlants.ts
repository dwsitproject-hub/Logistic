/**
 * Clear all rows in master_plants (staging / pre-upload cleanup).
 *
 * Usage (preview only — default):
 *   cd backend
 *   npx ts-node src/scripts/clearMasterPlants.ts
 *
 * Execute delete:
 *   npx ts-node src/scripts/clearMasterPlants.ts --confirm
 *
 * Uses DB_* from backend/.env (same as the API).
 */

import { getClient } from '../database/connection';

type PlantPreviewRow = {
  company_name: string;
  plant_code: string;
  plant_name: string | null;
  group_plant: string | null;
};

async function main() {
  const confirm = process.argv.includes('--confirm');
  const client = await getClient();

  try {
    const dbInfo = await client.query<{ db: string; host: string | null }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS host`,
    );
    const db = dbInfo.rows[0]?.db ?? 'unknown';
    const host = dbInfo.rows[0]?.host ?? process.env.DB_HOST ?? 'unknown';

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

    console.log(JSON.stringify({ database: db, host, master_plants_before: before }, null, 2));
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
  }
}

void main();
