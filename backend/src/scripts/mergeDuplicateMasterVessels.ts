/**
 * Merge duplicate master_vessels rows that share the same normalized_vessel_name.
 * Moves non-survivor vessel codes into master_vessel_code_aliases.
 *
 * Usage: npx ts-node src/scripts/mergeDuplicateMasterVessels.ts [--dry-run]
 */
import { query } from '../database/connection';
import { normalizeVesselName } from '../utils/vesselNameNormalize';
import { isProvisionalVesselCode } from '../utils/masterVesselCodeResolve';

interface MasterRow {
  id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  code_status: string;
  updated_at: string;
}

function survivorScore(row: MasterRow): number {
  let score = 0;
  if (row.code_status === 'OFFICIAL' && !isProvisionalVesselCode(row.vessel_code)) score += 100;
  if (row.vessel_name.length > 10) score += 10;
  return score;
}

function pickSurvivor(rows: MasterRow[]): MasterRow {
  return rows.slice().sort((a, b) => {
    const diff = survivorScore(b) - survivorScore(a);
    if (diff !== 0) return diff;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const dupGroups = await query(
    `SELECT normalized_vessel_name, array_agg(id::text ORDER BY updated_at DESC) AS ids, count(*)::int AS cnt
     FROM master_vessels
     GROUP BY normalized_vessel_name
     HAVING count(*) > 1`,
  );

  let mergedGroups = 0;
  let aliasesAdded = 0;
  let deletedRows = 0;

  for (const group of dupGroups.rows as Array<{ normalized_vessel_name: string; ids: string[]; cnt: number }>) {
    const norm = group.normalized_vessel_name;
    const rowsResult = await query(
      `SELECT id, vessel_code, vessel_name, normalized_vessel_name, code_status, updated_at
       FROM master_vessels
       WHERE normalized_vessel_name = $1`,
      [norm],
    );
    const rows = rowsResult.rows as MasterRow[];
    const survivor = pickSurvivor(rows);
    const duplicates = rows.filter((r) => r.id !== survivor.id);

    console.log(`\nMerge group "${norm}" (${rows.length} rows) → survivor ${survivor.vessel_code} (${survivor.id})`);

    for (const dup of duplicates) {
      console.log(`  - duplicate ${dup.vessel_code} (${dup.id})`);
      if (!dryRun) {
        await query(
          `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
           VALUES ($1, upper(trim($2)), 'merge_script', false)
           ON CONFLICT (vessel_code) DO UPDATE SET
             master_vessel_id = EXCLUDED.master_vessel_id,
             updated_at = CURRENT_TIMESTAMP`,
          [survivor.id, dup.vessel_code],
        );
        aliasesAdded += 1;

        await query(
          `UPDATE shipments SET master_vessel_id = $1, updated_at = CURRENT_TIMESTAMP
           WHERE master_vessel_id = $2 OR upper(trim(vessel_code)) = upper(trim($3))`,
          [survivor.id, dup.id, dup.vessel_code],
        );

        await query(`DELETE FROM master_vessels WHERE id = $1`, [dup.id]);
        deletedRows += 1;
      }
    }

    if (!dryRun) {
      await query(
        `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
         VALUES ($1, upper(trim($2)), 'db_existing', true)
         ON CONFLICT (vessel_code) DO UPDATE SET
           master_vessel_id = EXCLUDED.master_vessel_id,
           is_primary = true,
           updated_at = CURRENT_TIMESTAMP`,
        [survivor.id, survivor.vessel_code],
      );

      const longestName = rows.reduce(
        (best, r) => (r.vessel_name.length > best.length ? r.vessel_name : best),
        survivor.vessel_name,
      );
      await query(
        `UPDATE master_vessels SET
           vessel_name = $1,
           normalized_vessel_name = $2,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [longestName, normalizeVesselName(longestName), survivor.id],
      );
    }

    mergedGroups += 1;
  }

  console.log(
    `\nDone${dryRun ? ' (dry-run)' : ''}: groups=${mergedGroups}, aliases=${aliasesAdded}, deleted=${deletedRows}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
