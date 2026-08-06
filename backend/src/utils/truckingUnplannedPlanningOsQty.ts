import { query } from '../database/connection';
import {
  buildQtyMoveCte,
  sqlContractGlobalOutstandingExpr,
} from './contractGlobalOutstandingSql';
import {
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingQuantityDeliveredCoalesce,
  sqlTruckingQuantityReceiveCoalesce,
} from './truckingQuantitySql';

export type UnplannedPlanningOsQtyValidation =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      failureKind: 'less' | 'greater' | 'missing_os';
      totalPlanningKg: number;
      outstandingKg: number;
    };

/** ±1 MT — daily planning templates use whole MT; OS Qty in DB may have sub-MT precision. */
const KG_TOLERANCE = 1000;

export function formatPlanningQtyKgLabel(kg: number): string {
  if (!Number.isFinite(kg)) return '0';
  if (Number.isInteger(kg)) return String(kg);
  return String(Math.round(kg * 100) / 100);
}

export function formatPlanningQtyMtLabel(kg: number): string {
  if (!Number.isFinite(kg)) return '0';
  const mt = kg / 1000;
  return mt.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false });
}

export function sumPlanningEntriesKg(entries: Array<{ qtyMt: number | null | undefined }>): number {
  let sum = 0;
  for (const entry of entries) {
    if (entry.qtyMt == null || !Number.isFinite(entry.qtyMt)) continue;
    sum += Math.round(entry.qtyMt * 100) / 100;
  }
  return sum;
}

export function validatePlanningTotalAgainstOutstandingKg(
  totalPlanningKg: number,
  outstandingKg: number | null | undefined,
  options?: { allowLess?: boolean },
): UnplannedPlanningOsQtyValidation {
  if (outstandingKg === null || outstandingKg === undefined || !Number.isFinite(outstandingKg)) {
    return {
      ok: false,
      reason: 'Outstanding Qty is unavailable for this PO (incoterm may not support OS Qty)',
      failureKind: 'missing_os',
      totalPlanningKg,
      outstandingKg: 0,
    };
  }

  const diff = totalPlanningKg - outstandingKg;
  if (Math.abs(diff) <= KG_TOLERANCE) {
    return { ok: true };
  }

  if (diff < 0) {
    if (options?.allowLess) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `Total daily planning qty (${formatPlanningQtyMtLabel(totalPlanningKg)} MT) is less than Outstanding Qty (${formatPlanningQtyMtLabel(outstandingKg)} MT)`,
      failureKind: 'less',
      totalPlanningKg,
      outstandingKg,
    };
  }

  return {
    ok: false,
    reason: `Total daily planning qty (${formatPlanningQtyMtLabel(totalPlanningKg)} MT) exceeds Outstanding Qty (${formatPlanningQtyMtLabel(outstandingKg)} MT)`,
    failureKind: 'greater',
    totalPlanningKg,
    outstandingKg,
  };
}

/** KLIP OS Qty actual (kg) for open contract backlog / unplanned rows. */
export async function fetchContractOutstandingQtyKg(contractUuid: string): Promise<number | null> {
  const subquery = `SELECT c.contract_id FROM contracts c WHERE c.id = $1::uuid`;
  const qtyMoveCte = buildQtyMoveCte({ kind: 'in_subquery', subquery });
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });

  const result = await query(
    `WITH ${qtyMoveCte}
     SELECT ${outstandingExpr} AS outstanding_kg
     FROM contracts c
     WHERE c.id = $1::uuid
     LIMIT 1`,
    [contractUuid],
  );

  const raw = (result.rows[0] as { outstanding_kg?: unknown } | undefined)?.outstanding_kg;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** OS Qty actual (kg) for planned/in-progress trucking operation rows. */
export async function fetchTruckingOperationOutstandingQtyKg(
  truckingOperationId: string,
): Promise<number | null> {
  const outstandingExpr = sqlTruckingOutstandingQtyByIncoterm(
    sqlTruckingQuantityDeliveredCoalesce(),
    sqlTruckingQuantityReceiveCoalesce(),
  );
  const result = await query(
    `SELECT ${outstandingExpr} AS outstanding_kg
     FROM trucking_operations t
     INNER JOIN contracts c ON c.id = t.contract_id
     WHERE t.id = $1::uuid
     LIMIT 1`,
    [truckingOperationId],
  );
  const raw = (result.rows[0] as { outstanding_kg?: unknown } | undefined)?.outstanding_kg;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Contract quantity_ordered (kg) fallback when OS Qty is unavailable. */
export async function fetchContractQuantityOrderedKg(contractUuid: string): Promise<number | null> {
  const result = await query(
    `SELECT quantity_ordered FROM contracts WHERE id = $1::uuid LIMIT 1`,
    [contractUuid],
  );
  const raw = (result.rows[0] as { quantity_ordered?: unknown } | undefined)?.quantity_ordered;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Max kg for daily planning rows (modal, calendar, bulk CSV).
 * Prefer OS Qty; fall back to contract qty. Do not use raw SAP quantity_delivered (often MT-scale).
 */
export async function resolveTruckingPlanningMaxQtyKg(contractUuid: string): Promise<number | null> {
  const outstanding = await fetchContractOutstandingQtyKg(contractUuid);
  if (outstanding !== null && Number.isFinite(outstanding)) return outstanding;
  return fetchContractQuantityOrderedKg(contractUuid);
}
