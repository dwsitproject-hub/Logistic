/**
 * Regression: contract qty_move snapshot vs live SQL must match (Layer H / §4 OS qty).
 * Run (Docker): docker exec klip-backend node dist/scripts/performanceRegressionContractQtySnapshot.js
 */
import { query } from '../database/connection';
import {
  ContractQtyMoveSnapshotService,
  isContractQtyMoveSnapshotFresh,
} from '../services/contractQtyMoveSnapshot.service';
import { buildQtyMoveCte } from '../utils/contractGlobalOutstandingSql';
import logger from '../utils/logger';

const UAT_CONTRACTS = [
  '1004030657',
  '1364001990',
  '1014003049',
  '1014003019',
  '1004026972',
];

const QTY_FIELDS = [
  'quantity_delivery_trucking',
  'quantity_delivery_vessel',
  'quantity_receive',
  'quantity_delivery',
] as const;

type QtyRow = Record<(typeof QTY_FIELDS)[number], number | null> & { contract_number: string };

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowsEqual(a: QtyRow, b: QtyRow): string[] {
  const errors: string[] = [];
  for (const field of QTY_FIELDS) {
    if (num(a[field]) !== num(b[field])) {
      errors.push(
        `${a.contract_number}.${field}: live=${num(a[field])} snap=${num(b[field])}`,
      );
    }
  }
  return errors;
}

async function loadLiveQtyMove(contractNumbers: string[]): Promise<Map<string, QtyRow>> {
  if (contractNumbers.length === 0) return new Map();
  const liveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT unnest($1::text[]) AS contract_id',
  });
  const res = await query(
    `
    WITH ${liveCte}
    SELECT
      qm.contract_number,
      qm.quantity_delivery_trucking,
      qm.quantity_delivery_vessel,
      qm.quantity_receive,
      qm.quantity_delivery
    FROM qty_move qm
    WHERE qm.contract_number = ANY($1::text[])
    ORDER BY qm.contract_number
    `,
    [contractNumbers],
  );
  const map = new Map<string, QtyRow>();
  for (const row of res.rows) {
    const r = row as QtyRow;
    map.set(String(r.contract_number), r);
  }
  return map;
}

async function loadSnapshotQtyMove(contractNumbers: string[]): Promise<Map<string, QtyRow>> {
  if (contractNumbers.length === 0) return new Map();
  const res = await query(
    `
    SELECT
      contract_number,
      quantity_delivery_trucking,
      quantity_delivery_vessel,
      quantity_receive,
      quantity_delivery
    FROM contract_qty_move_snapshot
    WHERE contract_number = ANY($1::text[])
    ORDER BY contract_number
    `,
    [contractNumbers],
  );
  const map = new Map<string, QtyRow>();
  for (const row of res.rows) {
    const r = row as QtyRow;
    map.set(String(r.contract_number), r);
  }
  return map;
}

async function pickSampleContracts(sampleSize: number): Promise<string[]> {
  const res = await query(
    `
    SELECT contract_number
    FROM contract_qty_move_snapshot
    ORDER BY RANDOM()
    LIMIT $1
    `,
    [sampleSize],
  );
  const randomIds = res.rows.map((r) => String((r as { contract_number: string }).contract_number));
  return [...new Set([...UAT_CONTRACTS, ...randomIds])];
}

async function compareAllSnapshotRows(): Promise<string[]> {
  const liveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_number FROM contract_qty_move_snapshot',
  });
  const res = await query(
    `
    WITH ${liveCte},
    mismatches AS (
      SELECT
        COALESCE(l.contract_number, s.contract_number) AS contract_number,
        l.quantity_delivery_trucking AS live_trucking,
        s.quantity_delivery_trucking AS snap_trucking,
        l.quantity_delivery_vessel AS live_vessel,
        s.quantity_delivery_vessel AS snap_vessel,
        l.quantity_receive AS live_receive,
        s.quantity_receive AS snap_receive,
        l.quantity_delivery AS live_delivery,
        s.quantity_delivery AS snap_delivery
      FROM qty_move l
      FULL OUTER JOIN contract_qty_move_snapshot s ON s.contract_number = l.contract_number
      WHERE
        COALESCE(l.quantity_delivery_trucking, 0) IS DISTINCT FROM COALESCE(s.quantity_delivery_trucking, 0)
        OR COALESCE(l.quantity_delivery_vessel, 0) IS DISTINCT FROM COALESCE(s.quantity_delivery_vessel, 0)
        OR COALESCE(l.quantity_receive, 0) IS DISTINCT FROM COALESCE(s.quantity_receive, 0)
        OR COALESCE(l.quantity_delivery, 0) IS DISTINCT FROM COALESCE(s.quantity_delivery, 0)
        OR l.contract_number IS NULL
        OR s.contract_number IS NULL
    )
    SELECT * FROM mismatches ORDER BY contract_number LIMIT 25
    `,
  );
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return `${r.contract_number}: trucking ${r.live_trucking}/${r.snap_trucking}, vessel ${r.live_vessel}/${r.snap_vessel}, receive ${r.live_receive}/${r.snap_receive}, delivery ${r.live_delivery}/${r.snap_delivery}`;
  });
}

async function main(): Promise<void> {
  const sampleSize = Number(process.env.QTY_SNAPSHOT_SAMPLE_SIZE || 50);
  logger.info('Performance regression: contract qty_move snapshot parity', { sampleSize });

  logger.info('Refreshing contract qty_move snapshot...');
  const rowCount = await ContractQtyMoveSnapshotService.refreshAll();
  const fresh = await isContractQtyMoveSnapshotFresh();
  if (!fresh) {
    throw new Error('Snapshot meta still stale after refresh');
  }
  logger.info('Snapshot refreshed', { rowCount, fresh });

  const sampleIds = await pickSampleContracts(sampleSize);
  const [liveMap, snapMap] = await Promise.all([
    loadLiveQtyMove(sampleIds),
    loadSnapshotQtyMove(sampleIds),
  ]);

  const errors: string[] = [];
  for (const id of sampleIds) {
    const live = liveMap.get(id);
    const snap = snapMap.get(id);
    if (!live && !snap) continue;
    if (!live) {
      errors.push(`${id}: missing live qty_move row`);
      continue;
    }
    if (!snap) {
      errors.push(`${id}: missing snapshot row`);
      continue;
    }
    errors.push(...rowsEqual(live, snap));
  }

  const globalMismatches = await compareAllSnapshotRows();
  if (globalMismatches.length > 0) {
    errors.push(...globalMismatches.map((m) => `global: ${m}`));
  }

  if (errors.length > 0) {
    logger.error('REGRESSION FAILED', { errorCount: errors.length, errors: errors.slice(0, 30) });
    process.exit(1);
  }

  logger.info('REGRESSION PASS: contract qty_move snapshot matches live SQL', {
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
