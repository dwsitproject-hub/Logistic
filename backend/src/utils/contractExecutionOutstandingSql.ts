import { sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';

/**
 * A contract's outstanding, exactly as the Shipments execution OS values it.
 *
 * WHY THIS EXISTS. Shipping Performance sums each STO's SHARE of a PO's outstanding; Shipments
 * takes the CONTRACT's outstanding once any of its shipments reaches an active stage. When a
 * contract's other STOs are completed, or fall outside the period or the site, their share is
 * never counted on Shipping Performance and the contract comes up short - 1,661 MT across
 * CPO / BONTANG / YTD on production, 2026-09-21, the last of a 31,832 MT gap.
 *
 * Closing that means Shipping Performance needs the contract figure, and the one thing it must not
 * do is compute its own version of it. A first diagnosis used the BACKLOG arm's formula
 * (sqlBacklogRemainingOsJoinExpr) as a stand-in and reported 5,162 MT where the real residual is
 * 1,661 - right in shape, wrong by 3x in size. That is what a near-enough copy buys.
 *
 * So this lifts the two rules the execution arm applies per contract, unchanged:
 *
 *   quantity   sqlContractGlobalOutstandingExpr, with the CONTRACT's own quantity_ordered and its
 *              OWN incoterm - not the STO group's. The group's incoterm selects the wrong delivery
 *              column: four trucking contracts were once valued off the vessel column that way.
 *   SAP closed a contract whose own GR says Close carries no outstanding, whatever its STO group
 *              says. 1004029445, 1004030942 and 1004030943 kept contributing 608 MT before this
 *              was tested per contract.
 *
 * REQUIRES a `qty_move` CTE in the surrounding query - sqlContractGlobalOutstandingExpr reads
 * `FROM qty_move qm`. Splice resolveContractsQtyMoveCte() in, or the query fails with 42P01 at
 * runtime while every string assertion still passes.
 */
export function sqlContractExecutionOutstandingKgExpr(contractNumberExpr: string): string {
  const ownQty = `(SELECT c_q.quantity_ordered FROM contracts c_q WHERE c_q.contract_id = ${contractNumberExpr} LIMIT 1)`;
  const ownIncoterm = `COALESCE(NULLIF(TRIM((
    SELECT c_i.incoterm FROM contracts c_i WHERE c_i.contract_id = ${contractNumberExpr} LIMIT 1
  )), ''), '')`;
  const outstanding = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: ownQty,
    incotermExpr: ownIncoterm,
    contractNumberExpr,
  });
  const sapClosed = `EXISTS (
    SELECT 1 FROM contracts c_closed
    WHERE c_closed.contract_id = ${contractNumberExpr}
      AND ${sqlIsContractSapClosedExpr('c_closed')}
  )`;
  return `CASE WHEN ${sapClosed} THEN 0::numeric ELSE (${outstanding})::numeric END`;
}
