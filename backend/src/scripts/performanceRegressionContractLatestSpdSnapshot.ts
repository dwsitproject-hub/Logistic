/**
 * Regression: contract latest_spd snapshot vs live SQL must match (Layer H).
 * Run (Docker): docker exec klip-backend node dist/scripts/performanceRegressionContractLatestSpdSnapshot.js
 */
import { query } from '../database/connection';
import {
  ContractLatestSpdSnapshotService,
  isContractLatestSpdSnapshotFresh,
} from '../services/contractLatestSpdSnapshot.service';
import { buildLatestSpdCte } from '../utils/contractLatestSpdSql';
import logger from '../utils/logger';

const UAT_CONTRACTS = [
  '1004030657',
  '1364001990',
  '1014003049',
  '1014003019',
  '1004026972',
];

async function findSampleMismatches(contractNumbers: string[]): Promise<string[]> {
  if (contractNumbers.length === 0) return [];
  const liveCte = buildLatestSpdCte({
    kind: 'in_subquery',
    subquery: 'SELECT unnest($1::text[]) AS contract_id',
  });
  const res = await query(
    `
    WITH ${liveCte},
    mismatches AS (
      SELECT
        COALESCE(l.contract_number, s.contract_number) AS contract_number,
        (l.data IS DISTINCT FROM s.data) AS data_diff,
        (l.created_at IS DISTINCT FROM s.spd_created_at) AS created_diff
      FROM latest_spd l
      FULL OUTER JOIN contract_latest_spd_snapshot s ON s.contract_number = l.contract_number
      WHERE COALESCE(l.contract_number, s.contract_number) = ANY($1::text[])
        AND (
          l.data IS DISTINCT FROM s.data
          OR l.created_at IS DISTINCT FROM s.spd_created_at
          OR l.contract_number IS NULL
          OR s.contract_number IS NULL
        )
    )
    SELECT * FROM mismatches ORDER BY contract_number
    `,
    [contractNumbers],
  );
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return `${r.contract_number}: data_diff=${r.data_diff} created_diff=${r.created_diff}`;
  });
}

async function pickSampleContracts(sampleSize: number): Promise<string[]> {
  const res = await query(
    `
    SELECT contract_number
    FROM contract_latest_spd_snapshot
    ORDER BY RANDOM()
    LIMIT $1
    `,
    [sampleSize],
  );
  const randomIds = res.rows.map((r) => String((r as { contract_number: string }).contract_number));
  return [...new Set([...UAT_CONTRACTS, ...randomIds])];
}

async function compareAllSnapshotRows(): Promise<string[]> {
  const liveCte = buildLatestSpdCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_number FROM contract_latest_spd_snapshot',
  });
  const res = await query(
    `
    WITH ${liveCte},
    mismatches AS (
      SELECT
        COALESCE(l.contract_number, s.contract_number) AS contract_number,
        l.created_at AS live_created_at,
        s.spd_created_at AS snap_created_at,
        (l.data IS DISTINCT FROM s.data) AS data_diff
      FROM latest_spd l
      FULL OUTER JOIN contract_latest_spd_snapshot s ON s.contract_number = l.contract_number
      WHERE
        l.data IS DISTINCT FROM s.data
        OR l.created_at IS DISTINCT FROM s.spd_created_at
        OR l.contract_number IS NULL
        OR s.contract_number IS NULL
    )
    SELECT * FROM mismatches ORDER BY contract_number LIMIT 25
    `,
  );
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return `${r.contract_number}: data_diff=${r.data_diff} created=${r.live_created_at}/${r.snap_created_at}`;
  });
}

async function main(): Promise<void> {
  const sampleSize = Number(process.env.LATEST_SPD_SNAPSHOT_SAMPLE_SIZE || 50);
  logger.info('Performance regression: contract latest_spd snapshot parity', { sampleSize });

  logger.info('Refreshing contract latest_spd snapshot...');
  const rowCount = await ContractLatestSpdSnapshotService.refreshAll();
  const fresh = await isContractLatestSpdSnapshotFresh();
  if (!fresh) {
    throw new Error('Snapshot meta still stale after refresh');
  }
  logger.info('Snapshot refreshed', { rowCount, fresh });

  const sampleIds = await pickSampleContracts(sampleSize);
  const sampleMismatches = await findSampleMismatches(sampleIds);
  const errors: string[] = [...sampleMismatches.map((m) => `sample: ${m}`)];
  const globalMismatches = await compareAllSnapshotRows();
  if (globalMismatches.length > 0) {
    errors.push(...globalMismatches.map((m) => `global: ${m}`));
  }

  if (errors.length > 0) {
    logger.error('REGRESSION FAILED', { errorCount: errors.length, errors: errors.slice(0, 30) });
    process.exit(1);
  }

  logger.info('REGRESSION PASS: contract latest_spd snapshot matches live SQL', {
    sampleChecked: sampleIds.length,
    snapshotRows: rowCount,
    uatContracts: UAT_CONTRACTS,
  });
  process.exit(0);
}

main().catch((err) => {
  logger.error('Regression script error', err);
  process.exit(1);
});
