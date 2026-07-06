/**
 * Global per-PO metrics for Shipment edit modal & PO eligibility (kg).
 * OS Actual = contract − incoterm fulfilled (qty_move). OS Plan = contract − SAP STO − all KLIP assignments.
 */

import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { STO_QTY_KG_PER_MT, sqlUserStoQtyAssignedToKgSql } from './userStoAssignmentQty';

const SPD_STO_QTY_KG = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'contract'->>'sto_quantity'), ''),
  NULLIF(TRIM(spd.data->'shipment'->>'sto_quantity'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'STO Quantity'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'sto quantity'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

/** SAP STO qty raw → kg (MT-scale values when much smaller than contract qty). */
export function sqlNormalizeSapStoQtyToKgSql(
  sapStoQtyExpr: string,
  contractQtyExpr: string,
): string {
  return `CASE
    WHEN COALESCE(${contractQtyExpr}, 0) > 0
      AND COALESCE(${sapStoQtyExpr}, 0) > 0
      AND COALESCE(${sapStoQtyExpr}, 0) <= COALESCE(${contractQtyExpr}, 0) / 100
    THEN COALESCE(${sapStoQtyExpr}, 0) * ${STO_QTY_KG_PER_MT}
    ELSE COALESCE(${sapStoQtyExpr}, 0)
  END`;
}

const SPD_PO_MATCH = (poExpr: string, spdAlias = 'spd') => `(
  ${poExpr} IS NULL
  OR NULLIF(TRIM(COALESCE(
    ${spdAlias}.po_number::text,
    ${spdAlias}.data->'raw'->>'PO No.',
    ${spdAlias}.data->'raw'->>'PO Number',
    ${spdAlias}.data->'contract'->>'po_number',
    ${spdAlias}.data->>'PO No.'
  )), '') = NULLIF(TRIM(${poExpr}::text), '')
)`;

/** Sum of SAP STO qty (kg) across distinct SAP STO numbers for a contract / PO line. */
export function sqlPoGlobalSapStoQtyKg(opts: {
  contractNumberExpr: string;
  poNumberExpr: string;
}): string {
  const { contractNumberExpr, poNumberExpr } = opts;
  return `COALESCE((
    SELECT SUM(latest.sto_kg)
    FROM (
      SELECT DISTINCT ON (
        NULLIF(TRIM(COALESCE(
          spd.sto_number::text,
          spd.data->'raw'->>'STO No.',
          spd.data->'raw'->>'STO Number',
          spd.data->'shipment'->>'sto_no',
          spd.data->'contract'->>'sto_no'
        )), '')
      )
        ${SPD_STO_QTY_KG} AS sto_kg
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM(${contractNumberExpr}::text)
        AND ${SPD_PO_MATCH(poNumberExpr)}
        AND ${SPD_STO_QTY_KG} IS NOT NULL
      ORDER BY
        NULLIF(TRIM(COALESCE(
          spd.sto_number::text,
          spd.data->'raw'->>'STO No.',
          spd.data->'raw'->>'STO Number',
          spd.data->'shipment'->>'sto_no',
          spd.data->'contract'->>'sto_no'
        )), ''),
        spd.created_at DESC NULLS LAST
    ) latest
    WHERE latest.sto_kg IS NOT NULL
  ), 0)::numeric`;
}

/** Sum of Shipment Plan Qty (kg) across all STO groups for a contract / PO line. */
export function sqlPoGlobalAssignedKg(opts: {
  contractNumberExpr: string;
  poNumberExpr: string;
  contractQtyExpr: string;
}): string {
  const { contractNumberExpr, poNumberExpr, contractQtyExpr } = opts;
  return `COALESCE((
    SELECT SUM(${sqlUserStoQtyAssignedToKgSql('u.sto_qty_assigned', contractQtyExpr)})
    FROM user_sto_contract_assignments u
    WHERE TRIM(u.contract_number) = TRIM(${contractNumberExpr}::text)
      AND COALESCE(u.po_number, '') = COALESCE(NULLIF(TRIM(${poNumberExpr}::text), ''), '')
  ), 0)::numeric`;
}

/** Shipment Plan Qty (kg) on one operational STO key for a contract / PO line. */
export function sqlPoStoAssignedKg(opts: {
  stoKeyExpr: string;
  contractNumberExpr: string;
  poNumberExpr: string;
  contractQtyExpr: string;
}): string {
  const { stoKeyExpr, contractNumberExpr, poNumberExpr, contractQtyExpr } = opts;
  return `COALESCE((
    SELECT ${sqlUserStoQtyAssignedToKgSql('u.sto_qty_assigned', contractQtyExpr)}
    FROM user_sto_contract_assignments u
    WHERE TRIM(u.sto_number::text) = TRIM(${stoKeyExpr}::text)
      AND TRIM(u.contract_number) = TRIM(${contractNumberExpr}::text)
      AND COALESCE(u.po_number, '') = COALESCE(NULLIF(TRIM(${poNumberExpr}::text), ''), '')
    LIMIT 1
  ), 0)::numeric`;
}

/** Global OS Qty (Plan) remaining for a PO (kg). */
export function sqlPoGlobalOutstandingPlanningKg(opts: {
  contractQtyExpr: string;
  contractNumberExpr: string;
  poNumberExpr: string;
}): string {
  const { contractQtyExpr, contractNumberExpr, poNumberExpr } = opts;
  const sap = sqlPoGlobalSapStoQtyKg({ contractNumberExpr, poNumberExpr });
  const assigned = sqlPoGlobalAssignedKg({
    contractNumberExpr,
    poNumberExpr,
    contractQtyExpr,
  });
  return `GREATEST(
    COALESCE(${contractQtyExpr}, 0)::numeric - (${sap}) - (${assigned}),
    0
  )::numeric`;
}

/**
 * OS Qty (Plan) budget for one row in the edit modal footer:
 * global remaining + assignment already on this STO (so footer = Σ this − Σ inputs).
 */
export function sqlPoOutstandingPlanningRowBudgetKg(opts: {
  contractQtyExpr: string;
  contractNumberExpr: string;
  poNumberExpr: string;
  stoKeyParam: string;
}): string {
  const sap = sqlPoGlobalSapStoQtyKg({
    contractNumberExpr: opts.contractNumberExpr,
    poNumberExpr: opts.poNumberExpr,
  });
  const assignedAll = sqlPoGlobalAssignedKg({
    contractNumberExpr: opts.contractNumberExpr,
    poNumberExpr: opts.poNumberExpr,
    contractQtyExpr: opts.contractQtyExpr,
  });
  const assignedSto = sqlPoStoAssignedKg({
    stoKeyExpr: `'${opts.stoKeyParam.replace(/'/g, "''")}'`,
    contractNumberExpr: opts.contractNumberExpr,
    poNumberExpr: opts.poNumberExpr,
    contractQtyExpr: opts.contractQtyExpr,
  });
  return `GREATEST(
    COALESCE(${opts.contractQtyExpr}, 0)::numeric
    - (${sap})
    - (${assignedAll})
    + (${assignedSto}),
    0
  )::numeric`;
}

/** Use sto key SQL expression instead of literal param. */
export function sqlPoOutstandingPlanningRowBudgetKgExpr(opts: {
  contractQtyExpr: string;
  contractNumberExpr: string;
  poNumberExpr: string;
  stoKeyExpr: string;
}): string {
  const sap = sqlPoGlobalSapStoQtyKg({
    contractNumberExpr: opts.contractNumberExpr,
    poNumberExpr: opts.poNumberExpr,
  });
  const assignedAll = sqlPoGlobalAssignedKg({
    contractNumberExpr: opts.contractNumberExpr,
    poNumberExpr: opts.poNumberExpr,
    contractQtyExpr: opts.contractQtyExpr,
  });
  const assignedSto = sqlPoStoAssignedKg({
    stoKeyExpr: opts.stoKeyExpr,
    contractNumberExpr: opts.contractNumberExpr,
    poNumberExpr: opts.poNumberExpr,
    contractQtyExpr: opts.contractQtyExpr,
  });
  return `GREATEST(
    COALESCE(${opts.contractQtyExpr}, 0)::numeric
    - (${sap})
    - (${assignedAll})
    + (${assignedSto}),
    0
  )::numeric`;
}

/** Global OS Actual (kg) — same incoterm rules as Contracts list. Requires qty_move CTE in scope. */
export function sqlPoGlobalOutstandingActualKg(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  contractNumberExpr: string;
}): string {
  return `${sqlContractGlobalOutstandingExpr(opts)}::numeric`;
}

/** Build qty_move CTE scoped to SEA contracts (for PO search / eligibility). */
export function buildSeaContractsQtyMoveCte(): string {
  return buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `
      SELECT c2.contract_id
      FROM contracts c2
      WHERE UPPER(COALESCE(NULLIF(TRIM(c2.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
    `,
  });
}

export const PO_GLOBAL_OUTSTANDING_PLANNING_EXPR = sqlPoGlobalOutstandingPlanningKg({
  contractQtyExpr: 'c.quantity_ordered',
  contractNumberExpr: 'c.contract_id',
  poNumberExpr: `COALESCE(c.po_number, '')`,
});

export const PO_GLOBAL_OUTSTANDING_ACTUAL_EXPR = sqlPoGlobalOutstandingActualKg({
  contractQtyExpr: 'c.quantity_ordered',
  incotermExpr: 'c.incoterm',
  contractNumberExpr: 'c.contract_id',
});
