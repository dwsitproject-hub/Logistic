import { query } from '../database/connection';
import { sqlContractExecutionOutstandingKgExpr } from '../utils/contractExecutionOutstandingSql';
import { resolveContractsQtyMoveCte } from './contractQtyMoveSnapshot.service';
import {
  isShipmentActiveStage,
  shipmentActiveStageRank,
} from '../utils/shipmentActiveStageRank';

/**
 * Make Shipping Performance's aggregates count what Shipments counts.
 *
 * THE PROBLEM, measured rather than argued. Shipments values a CONTRACT's outstanding once any of
 * its shipments reaches an active stage, and places all of it on the furthest stage. This page
 * gives each STO a SHARE of its PO's outstanding. When a contract's other STOs are completed, or
 * fall outside the period or the site, their share is never counted here - so the same slice read
 * 79,914 MT against 81,583 on Shipments (CPO / BONTANG / YTD, production 2026-09-21), the last
 * 1,661 MT of a 31,832 MT gap.
 *
 * WHY NOT A REMAINDER ROW, which was the first plan. Reconciling per contract needs each row's
 * outstanding split across the contracts it carries, and a merged STO row can carry several. Any
 * split is an invention: a diagnosis that divided evenly produced ten contracts "over-counted" by
 * exactly the same few values (684, 634, 3,833 MT), which was the even split showing through, not
 * the data. A remainder computed against an invented split moves the arbitrariness rather than
 * removing it.
 *
 * WHAT THIS DOES INSTEAD. Each contract's outstanding is placed, whole, on the one row carrying
 * its furthest active stage - the rule Shipments already applies (sqlShipmentActiveStageRankExpr,
 * shared, not copied). Every contract lands on exactly one row, so:
 *   - the total equals Shipments by construction, not by subtraction
 *   - the drilldown stays additive: no contract straddles two nodes
 *   - nothing is apportioned, so no split has to be invented
 *
 * ONLY `outstanding_qty_aggregate` is rewritten. That field means "the value to use in
 * aggregates", and the frontend prefers it. `outstanding_qty` is untouched, so the view table
 * still shows each STO's own outstanding - the column Ryan asked to keep as OS Qty.
 */

/** Rows must expose these; everything else on the row is left alone. */
export type ContractGrainOsRow = Record<string, unknown> & {
  contract_number?: unknown;
  status?: unknown;
  outstanding_qty_aggregate?: unknown;
  is_unplanned_backlog?: unknown;
};

export function contractNumbersOf(row: ContractGrainOsRow): string[] {
  return String(row.contract_number ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * The contract's outstanding, valued exactly as the Shipments execution arm values it.
 * Returns kg keyed by contract number; contracts with nothing outstanding are simply absent.
 */
export async function loadContractExecutionOutstandingKg(
  contractNumbers: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(contractNumbers.map((c) => c.trim()).filter(Boolean))];
  if (ids.length === 0) return out;

  /*
   * in_subquery, not the default join_scope: there is no contract_scope CTE here. The expression
   * reads `FROM qty_move qm`, so without this CTE the query fails at runtime with 42P01 while
   * every string assertion still passes - the gap that took this page down once before.
   */
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT c_s.contract_id FROM contracts c_s WHERE c_s.contract_id = ANY($1::text[])',
  });
  const result = await query(
    `WITH ${qtyMoveCte}
     SELECT c.contract_id,
            (${sqlContractExecutionOutstandingKgExpr('c.contract_id')})::numeric AS os_kg
     FROM contracts c
     WHERE c.contract_id = ANY($1::text[])`,
    [ids],
  );
  for (const row of result.rows as Record<string, unknown>[]) {
    const kg = Number(row.os_kg) || 0;
    if (kg > 0) out.set(String(row.contract_id), kg);
  }
  return out;
}

/**
 * Place each contract's outstanding on its furthest-active-stage row and clear it everywhere else.
 *
 * Backlog rows are left exactly as they are: they already carry a whole contract's outstanding,
 * they have no shipment and therefore no stage, and both pages already agree on that arm to the
 * MT because both call contractBacklogCoreWhereSql.
 */
export function applyContractGrainOutstanding<T extends ContractGrainOsRow>(
  rows: T[],
  contractOsKg: Map<string, number>,
): T[] {
  const winnerByContract = new Map<string, { row: T; rank: number }>();

  for (const row of rows) {
    if (row.is_unplanned_backlog === true) continue;
    const rank = shipmentActiveStageRank(row.status as string | null | undefined);
    if (!isShipmentActiveStage(row.status as string | null | undefined)) continue;
    for (const contract of contractNumbersOf(row)) {
      if (!contractOsKg.has(contract)) continue;
      const held = winnerByContract.get(contract);
      // Strictly greater, so the first row seen wins a tie and the result does not depend on
      // row order changing between runs.
      if (!held || rank > held.rank) winnerByContract.set(contract, { row, rank });
    }
  }

  const awarded = new Map<T, number>();
  for (const [contract, { row }] of winnerByContract) {
    awarded.set(row, (awarded.get(row) ?? 0) + (contractOsKg.get(contract) ?? 0));
  }

  for (const row of rows) {
    if (row.is_unplanned_backlog === true) continue;
    row.outstanding_qty_aggregate = awarded.get(row) ?? 0;
  }
  return rows;
}
