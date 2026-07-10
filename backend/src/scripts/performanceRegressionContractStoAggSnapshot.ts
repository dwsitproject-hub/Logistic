/**
 * Regression: contract sto_agg snapshot vs live SQL must match (Layer H).
 * Run (Docker): docker exec klip-backend node dist/scripts/performanceRegressionContractStoAggSnapshot.js
 */
import { query } from '../database/connection';
import {
  ContractStoAggSnapshotService,
  isContractStoAggSnapshotFresh,
} from '../services/contractStoAggSnapshot.service';
import { buildStoAggCte } from '../utils/contractStoAggSql';
import logger from '../utils/logger';

const UAT_CONTRACTS = [
  '1004030657',
  '1364001990',
  '1014003049',
  '1014003019',
  '1004026972',
];

type StoRow = {
  contract_number: string;
  sto_numbers: string | null;
  total_sto_quantity: number | null;
  sto_count: number | null;
};

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function rowsEqual(a: StoRow, b: StoRow): string[] {
  const errors: string[] = [];
  if (str(a.sto_numbers) !== str(b.sto_numbers)) {
    errors.push(`${a.contract_number}.sto_numbers: live="${str(a.sto_numbers)}" snap="${str(b.sto_numbers)}"`);
  }
  if (num(a.total_sto_quantity) !== num(b.total_sto_quantity)) {
    errors.push(
      `${a.contract_number}.total_sto_quantity: live=${num(a.total_sto_quantity)} snap=${num(b.total_sto_quantity)}`,
    );
  }
  if (num(a.sto_count) !== num(b.sto_count)) {
    errors.push(`${a.contract_number}.sto_count: live=${num(a.sto_count)} snap=${num(b.sto_count)}`);
  }
  return errors;
}

async function loadLiveStoAgg(contractNumbers: string[]): Promise<Map<string, StoRow>> {
  if (contractNumbers.length === 0) return new Map();
  const liveCte = buildStoAggCte({
    kind: 'in_subquery',
    subquery: 'SELECT unnest($1::text[]) AS contract_id',
  });
  const res = await query(
    `
    WITH ${liveCte}
    SELECT contract_number, sto_numbers, total_sto_quantity, sto_count
    FROM sto_agg
    WHERE contract_number = ANY($1::text[])
    ORDER BY contract_number
    `,
    [contractNumbers],
  );
  const map = new Map<string, StoRow>();
  for (const row of res.rows) {
    const r = row as StoRow;
    map.set(String(r.contract_number), r);
  }
  return map;
}

async function loadSnapshotStoAgg(contractNumbers: string[]): Promise<Map<string, StoRow>> {
  if (contractNumbers.length === 0) return new Map();
  const res = await query(
    `
    SELECT contract_number, sto_numbers, total_sto_quantity, sto_count
    FROM contract_sto_agg_snapshot
    WHERE contract_number = ANY($1::text[])
    ORDER BY contract_number
    `,
    [contractNumbers],
  );
  const map = new Map<string, StoRow>();
  for (const row of res.rows) {
    const r = row as StoRow;
    map.set(String(r.contract_number), r);
  }
  return map;
}

async function pickSampleContracts(sampleSize: number): Promise<string[]> {
  const res = await query(
    `
    SELECT contract_number
    FROM contract_sto_agg_snapshot
    ORDER BY RANDOM()
    LIMIT $1
    `,
    [sampleSize],
  );
  const randomIds = res.rows.map((r) => String((r as { contract_number: string }).contract_number));
  return [...new Set([...UAT_CONTRACTS, ...randomIds])];
}

async function compareAllSnapshotRows(): Promise<string[]> {
  const liveCte = buildStoAggCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_number FROM contract_sto_agg_snapshot',
  });
  const res = await query(
    `
    WITH ${liveCte},
    mismatches AS (
      SELECT
        COALESCE(l.contract_number, s.contract_number) AS contract_number,
        l.sto_numbers AS live_sto_numbers,
        s.sto_numbers AS snap_sto_numbers,
        l.total_sto_quantity AS live_qty,
        s.total_sto_quantity AS snap_qty,
        l.sto_count AS live_count,
        s.sto_count AS snap_count
      FROM sto_agg l
      FULL OUTER JOIN contract_sto_agg_snapshot s ON s.contract_number = l.contract_number
      WHERE
        COALESCE(l.sto_numbers, '') IS DISTINCT FROM COALESCE(s.sto_numbers, '')
        OR COALESCE(l.total_sto_quantity, 0) IS DISTINCT FROM COALESCE(s.total_sto_quantity, 0)
        OR COALESCE(l.sto_count, 0) IS DISTINCT FROM COALESCE(s.sto_count, 0)
        OR l.contract_number IS NULL
        OR s.contract_number IS NULL
    )
    SELECT * FROM mismatches ORDER BY contract_number LIMIT 25
    `,
  );
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return `${r.contract_number}: qty ${r.live_qty}/${r.snap_qty}, count ${r.live_count}/${r.snap_count}`;
  });
}

async function main(): Promise<void> {
  const sampleSize = Number(process.env.STO_AGG_SNAPSHOT_SAMPLE_SIZE || 50);
  logger.info('Performance regression: contract sto_agg snapshot parity', { sampleSize });

  logger.info('Refreshing contract sto_agg snapshot...');
  const rowCount = await ContractStoAggSnapshotService.refreshAll();
  const fresh = await isContractStoAggSnapshotFresh();
  if (!fresh) {
    throw new Error('Snapshot meta still stale after refresh');
  }
  logger.info('Snapshot refreshed', { rowCount, fresh });

  const sampleIds = await pickSampleContracts(sampleSize);
  const [liveMap, snapMap] = await Promise.all([
    loadLiveStoAgg(sampleIds),
    loadSnapshotStoAgg(sampleIds),
  ]);

  const errors: string[] = [];
  for (const id of sampleIds) {
    const live = liveMap.get(id);
    const snap = snapMap.get(id);
    if (!live && !snap) continue;
    if (!live && snap) {
      errors.push(`${id}: missing live sto_agg row`);
      continue;
    }
    if (live && !snap) {
      errors.push(`${id}: missing snapshot row`);
      continue;
    }
    if (live && snap) {
      errors.push(...rowsEqual(live, snap));
    }
  }

  const globalMismatches = await compareAllSnapshotRows();
  if (globalMismatches.length > 0) {
    errors.push(...globalMismatches.map((m) => `global: ${m}`));
  }

  if (errors.length > 0) {
    logger.error('REGRESSION FAILED', { errorCount: errors.length, errors: errors.slice(0, 30) });
    process.exit(1);
  }

  logger.info('REGRESSION PASS: contract sto_agg snapshot matches live SQL', {
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
