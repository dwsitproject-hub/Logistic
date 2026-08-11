/**
 * Dry-run / cleanup duplicate orphan UNPLANNED shipments when the same contract
 * already has a PLANNED (or later) execution row with a vessel assigned.
 *
 * Pattern: contract 1004029786 — PLANNED + KLM vessel + orphan UNPLANNED (vessel empty).
 *
 * Usage:
 *   npx ts-node src/scripts/cleanDuplicateUnplannedShipments.ts --dry-run
 *   npx ts-node src/scripts/cleanDuplicateUnplannedShipments.ts
 *   npx ts-node src/scripts/cleanDuplicateUnplannedShipments.ts --dry-run --contract 1004029786
 */
import { getClient } from '../database/connection';
import logger from '../utils/logger';

interface DuplicateRow {
  orphan_id: string;
  orphan_shipment_id: string | null;
  orphan_status: string | null;
  orphan_vessel: string | null;
  keeper_id: string;
  keeper_shipment_id: string | null;
  keeper_status: string | null;
  keeper_vessel: string | null;
  contract_id: string;
}

function parseArgs(): { dryRun: boolean; contract: string | null } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const contractIdx = args.indexOf('--contract');
  const contract =
    contractIdx >= 0 ? String(args[contractIdx + 1] ?? '').trim() || null : null;
  if (contractIdx >= 0 && !contract) {
    throw new Error('--contract requires a contract number');
  }
  return { dryRun, contract };
}

function buildSelectSql(contractFilter: string | null): string {
  const contractScope = contractFilter ? 'AND c.contract_id = $1' : '';
  return `
    WITH contract_shipments AS (
      SELECT
        s.id,
        s.shipment_id,
        s.status,
        NULLIF(TRIM(s.vessel_name), '') AS vessel_name,
        c.contract_id
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE 1=1 ${contractScope}
    ),
    orphans AS (
      SELECT *
      FROM contract_shipments o
      WHERE UPPER(COALESCE(o.status, '')) = 'UNPLANNED'
        AND o.vessel_name IS NULL
    ),
    keepers AS (
      SELECT *
      FROM contract_shipments k
      WHERE k.vessel_name IS NOT NULL
        AND UPPER(COALESCE(k.status, '')) IN ('PLANNED', 'AT_LOADING_PORT', 'SAILED', 'AT_DISCHARGE_PORT', 'COMPLETED')
    )
    SELECT
      o.id AS orphan_id,
      o.shipment_id AS orphan_shipment_id,
      o.status AS orphan_status,
      o.vessel_name AS orphan_vessel,
      k.id AS keeper_id,
      k.shipment_id AS keeper_shipment_id,
      k.status AS keeper_status,
      k.vessel_name AS keeper_vessel,
      o.contract_id
    FROM orphans o
    INNER JOIN keepers k ON k.contract_id = o.contract_id
    ORDER BY o.contract_id, o.shipment_id NULLS LAST`;
}

async function main(): Promise<void> {
  const { dryRun, contract } = parseArgs();
  const client = await getClient();
  try {
    const sql = buildSelectSql(contract);
    const params = contract ? [contract] : [];
    const res = await client.query<DuplicateRow>(sql, params);
    const rows = res.rows;

    if (rows.length === 0) {
      logger.info('No duplicate orphan UNPLANNED shipments found', { contract, dryRun });
      return;
    }

    logger.info(`Found ${rows.length} orphan UNPLANNED row(s) with keeper on same contract`, {
      dryRun,
      contract,
    });
    for (const row of rows) {
      logger.info('duplicate orphan UNPLANNED', row);
    }

    if (dryRun) {
      logger.info('Dry run — pass --apply to delete orphan rows and linked vessel_loading_ports');
      return;
    }

    await client.query('BEGIN');
    const orphanIds = [...new Set(rows.map((r) => r.orphan_id))];
    for (const orphanId of orphanIds) {
      await client.query('DELETE FROM vessel_loading_ports WHERE shipment_id = $1', [orphanId]);
      await client.query('DELETE FROM shipments WHERE id = $1', [orphanId]);
      logger.info('Deleted orphan UNPLANNED shipment', { orphanId });
    }
    await client.query('COMMIT');
    logger.info('Cleanup complete', { deleted: orphanIds.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  logger.error('cleanDuplicateUnplannedShipments failed', err);
  process.exit(1);
});
