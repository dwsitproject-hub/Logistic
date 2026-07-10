/**
 * Sync master_plants.group_plant from staging (or CSV export) into local DB.
 *
 * Match key: (company_name, plant_code) — same as master_plants unique constraint.
 *
 * Usage (preview — default dry run):
 *   cd backend
 *   npm run sync:master-plant-group-from-staging
 *
 * Apply to local DB:
 *   npm run sync:master-plant-group-from-staging:confirm
 *
 * From CSV (e.g. exported via scripts/sync-master-plant-group-from-staging.ps1):
 *   npm run sync:master-plant-group-from-file -- --file ../tmp/master-plant-group-staging.csv --confirm
 *
 * Env — local target (host scripts):
 *   Loads repo root .env then backend/.env (root wins for shared keys).
 *   DB_HOST=127.0.0.1  DB_PORT=5433  DB_USER=klip_user  DB_PASSWORD=...
 *
 * Env — staging source (--from-staging):
 *   STAGING_DB_HOST=172.28.92.57
 *   STAGING_DB_PORT=5433
 *   STAGING_DB_USER=postgres
 *   STAGING_DB_PASSWORD=postgres123
 *   STAGING_DB_NAME=klip_db
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Pool, type PoolClient } from 'pg';

const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'backend', '.env') });

type GroupPlantRow = {
  company_name: string;
  plant_code: string;
  group_plant: string;
};

type SyncStats = {
  staging_rows: number;
  local_updated: number;
  local_unchanged: number;
  staging_not_found_locally: number;
  local_cleared?: number;
};

function resolveLocalDbConfig() {
  let host = process.env.SCRIPT_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  let port = parseInt(process.env.SCRIPT_DB_PORT || process.env.DB_PORT || process.env.POSTGRES_PORT || '5433', 10);

  if (!process.env.SCRIPT_DB_HOST && (host === 'postgres' || host === 'klip-postgres')) {
    host = '127.0.0.1';
    port = parseInt(process.env.POSTGRES_PORT || '5433', 10);
  }

  return {
    host,
    port,
    database: process.env.DB_NAME || 'klip_db',
    user: process.env.DB_USER || 'klip_user',
    password: process.env.DB_PASSWORD,
  };
}

function resolveStagingDbConfig() {
  return {
    host: process.env.STAGING_DB_HOST || '172.28.92.57',
    port: parseInt(process.env.STAGING_DB_PORT || '5433', 10),
    database: process.env.STAGING_DB_NAME || 'klip_db',
    user: process.env.STAGING_DB_USER || 'postgres',
    password: process.env.STAGING_DB_PASSWORD || 'postgres123',
  };
}

function plantKey(companyName: string, plantCode: string): string {
  return `${companyName}\u0001${plantCode}`;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function loadRowsFromCsv(filePath: string): GroupPlantRow[] {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const rows: GroupPlantRow[] = [];
  let start = 0;
  const firstFields = parseCsvLine(lines[0]);
  const headerLooksLike =
    firstFields.length >= 3 &&
    firstFields[0].toLowerCase().includes('company') &&
    firstFields[1].toLowerCase().includes('plant');
  if (headerLooksLike) start = 1;

  for (let i = start; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 3) continue;
    const company_name = fields[0].trim();
    const plant_code = fields[1].trim();
    const group_plant = fields[2].trim();
    if (!company_name || !plant_code || !group_plant) continue;
    rows.push({ company_name, plant_code, group_plant });
  }
  return rows;
}

async function loadRowsFromStaging(): Promise<GroupPlantRow[]> {
  const cfg = resolveStagingDbConfig();
  const pool = new Pool({ ...cfg, connectionTimeoutMillis: 8000 });
  try {
    const res = await pool.query<GroupPlantRow>(
      `
      SELECT
        company_name,
        plant_code,
        TRIM(group_plant) AS group_plant
      FROM master_plants
      WHERE group_plant IS NOT NULL
        AND NULLIF(TRIM(group_plant), '') IS NOT NULL
      ORDER BY company_name, plant_code
      `,
    );
    return res.rows;
  } finally {
    await pool.end();
  }
}

async function applyRows(
  client: PoolClient,
  rows: GroupPlantRow[],
  confirm: boolean,
  mirror: boolean,
): Promise<SyncStats> {
  const stats: SyncStats = {
    staging_rows: rows.length,
    local_updated: 0,
    local_unchanged: 0,
    staging_not_found_locally: 0,
  };

  const stagingKeys = new Set<string>();

  for (const row of rows) {
    stagingKeys.add(plantKey(row.company_name, row.plant_code));

    const existing = await client.query<{ group_plant: string | null }>(
      `
      SELECT group_plant
      FROM master_plants
      WHERE company_name = $1 AND plant_code = $2
      LIMIT 1
      `,
      [row.company_name, row.plant_code],
    );

    if (existing.rowCount === 0) {
      stats.staging_not_found_locally += 1;
      continue;
    }

    const current = (existing.rows[0]?.group_plant ?? '').trim();
    if (current === row.group_plant) {
      stats.local_unchanged += 1;
      continue;
    }

    stats.local_updated += 1;
    if (confirm) {
      await client.query(
        `
        UPDATE master_plants
        SET group_plant = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_name = $2 AND plant_code = $3
        `,
        [row.group_plant, row.company_name, row.plant_code],
      );
    }
  }

  if (mirror) {
    const localWithGroup = await client.query<{ company_name: string; plant_code: string }>(
      `
      SELECT company_name, plant_code
      FROM master_plants
      WHERE group_plant IS NOT NULL
        AND NULLIF(TRIM(group_plant), '') IS NOT NULL
      `,
    );
    let cleared = 0;
    for (const local of localWithGroup.rows) {
      if (stagingKeys.has(plantKey(local.company_name, local.plant_code))) continue;
      cleared += 1;
      if (confirm) {
        await client.query(
          `
          UPDATE master_plants
          SET group_plant = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE company_name = $1 AND plant_code = $2
          `,
          [local.company_name, local.plant_code],
        );
      }
    }
    stats.local_cleared = cleared;
  }

  return stats;
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const mirror = process.argv.includes('--mirror');
  const fromStaging = process.argv.includes('--from-staging');
  const filePath = getArgValue('--file');

  let rows: GroupPlantRow[];
  let sourceLabel: string;

  if (filePath) {
    rows = loadRowsFromCsv(filePath);
    sourceLabel = `csv:${path.resolve(filePath)}`;
  } else if (fromStaging || !filePath) {
    const stagingCfg = resolveStagingDbConfig();
    console.log(
      JSON.stringify(
        {
          source: 'staging',
          connect: {
            host: stagingCfg.host,
            port: stagingCfg.port,
            database: stagingCfg.database,
            user: stagingCfg.user,
          },
        },
        null,
        2,
      ),
    );
    rows = await loadRowsFromStaging();
    sourceLabel = `staging:${stagingCfg.host}:${stagingCfg.port}`;
  } else {
    console.error('Provide --from-staging or --file <path.csv>');
    process.exitCode = 1;
    return;
  }

  const localCfg = resolveLocalDbConfig();
  const pool = new Pool(localCfg);
  const client = await pool.connect();

  try {
    console.log(
      JSON.stringify(
        {
          target: {
            host: localCfg.host,
            port: localCfg.port,
            database: localCfg.database,
            user: localCfg.user,
          },
          source: sourceLabel,
          staging_rows_loaded: rows.length,
          mode: confirm ? 'apply' : 'dry-run',
          mirror,
        },
        null,
        2,
      ),
    );

    if (rows.length > 0) {
      console.log('Sample staging rows (up to 10):');
      console.table(rows.slice(0, 10));
    }

    if (confirm) await client.query('BEGIN');
    const stats = await applyRows(client, rows, confirm, mirror);
    if (confirm) await client.query('COMMIT');

    console.log(JSON.stringify({ stats, status: confirm ? 'applied' : 'preview' }, null, 2));

    if (!confirm) {
      console.log('\nDry run only — local DB not changed.');
      console.log('Re-run with --confirm to apply group_plant updates.');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('syncMasterPlantGroupPlantFromStaging failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
