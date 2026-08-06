/**
 * SQL for Pre-Planned grouping eligibility pool (spec §4.1).
 */

import { groupPlantExpr } from './groupPlantSql';
import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

/**
 * True when the contract is an active member of an ACCEPTED pre-planned group
 * that has not yet been linked to a real shipment (Preplanned pipeline stage).
 */
export function contractInAcceptedUnlinkedPrePlannedGroupExistsSql(
  contractAlias = 'c',
): string {
  return `EXISTS (
    SELECT 1
    FROM pre_planned_group_members pgm
    INNER JOIN pre_planned_groups pg ON pg.id = pgm.group_id
    WHERE pgm.contract_id = ${contractAlias}.id
      AND pgm.released_at IS NULL
      AND pg.status = 'ACCEPTED'
      AND pg.shipment_id IS NULL
  )`;
}

export function buildPrePlannedEligibleContractsQuery(opts: {
  excludedPlants: string[];
  minOsMt: number;
}): { sql: string; params: unknown[] } {
  const plantExpr = groupPlantExpr('c.plant_code', 'c.company_name');
  const incotermExpr = contractEffectiveIncotermExpr('c');
  const outstandingKgExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr,
    contractNumberExpr: 'c.contract_id',
  });
  const minOsKg = opts.minOsMt * 1000;

  const excludedPlaceholders = opts.excludedPlants.map((_, i) => `$${i + 2}`).join(', ');

  const sql = `
    WITH ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_id FROM contracts c2' })}
    SELECT
      c.id,
      c.contract_id,
      c.buyer,
      c.supplier,
      c.product,
      c.incoterm,
      c.group_name,
      c.contract_date,
      c.delivery_start_date,
      c.delivery_end_date,
      c.plant_code,
      c.company_name,
      c.transport_mode,
      c.status,
      ${plantExpr} AS group_plant,
      (${outstandingKgExpr}) / 1000.0 AS os_mt,
      c.quantity_ordered / 1000.0 AS contract_qty_mt
    FROM contracts c
    WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
      AND UPPER(COALESCE(c.status, '')) NOT IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
      AND c.contract_date IS NOT NULL
      AND c.delivery_start_date IS NOT NULL
      AND c.delivery_end_date IS NOT NULL
      AND (${outstandingKgExpr}) > $1
      AND NOT EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id
          AND UPPER(COALESCE(s.status, '')) NOT IN ('UNPLANNED', 'CANCELLED')
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_stos cs
        WHERE cs.contract_id = c.id
          AND NULLIF(TRIM(cs.sto_number), '') IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pre_planned_group_members pgm
        INNER JOIN pre_planned_groups pg ON pg.id = pgm.group_id
        WHERE pgm.contract_id = c.id
          AND pgm.released_at IS NULL
          AND pg.status = 'ACCEPTED'
      )
      /* Also covers unlinked ACCEPTED (Preplanned) via the status check above. */
      AND ${plantExpr} NOT IN (${excludedPlaceholders})
    ORDER BY c.contract_date, c.contract_id
  `;

  return {
    sql,
    params: [minOsKg, ...opts.excludedPlants],
  };
}
