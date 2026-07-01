/**
 * Global contract outstanding qty — same rules as Contracts list (`qty_move` CTE).
 */

import {
  sqlIncotermOutstandingCase,
  sqlParseSapNumeric,
  sqlQtyMoveIncotermDelivery,
  sqlSapQtyTruckingFromSpd,
  sqlSapQtyVesselFromSpd,
  sqlTransportModeFromContractAndJson,
} from './sapIncotermMetrics';

export type QtyMoveContractFilter =
  | { kind: 'join_scope'; scopeCteName: string }
  | { kind: 'in_subquery'; subquery: string };

function scopeJoin(filter: QtyMoveContractFilter, spdAlias = 'spd'): string {
  if (filter.kind === 'join_scope') {
    return `INNER JOIN ${filter.scopeCteName} cs ON cs.contract_id = ${spdAlias}.contract_number`;
  }
  return '';
}

function scopeWhere(filter: QtyMoveContractFilter, spdAlias = 'spd'): string {
  if (filter.kind === 'in_subquery') {
    return `AND ${spdAlias}.contract_number IN (${filter.subquery})`;
  }
  return '';
}

function contractOrderedCte(filter: QtyMoveContractFilter): string {
  if (filter.kind === 'join_scope') {
    return `
        contract_ordered AS (
          SELECT c.contract_id AS contract_number, MAX(c.quantity_ordered) AS quantity_ordered
          FROM contracts c
          INNER JOIN ${filter.scopeCteName} cs ON cs.contract_id = c.contract_id
          GROUP BY c.contract_id
        )`;
  }
  return `
        contract_ordered AS (
          SELECT c.contract_id AS contract_number, MAX(c.quantity_ordered) AS quantity_ordered
          FROM contracts c
          WHERE c.contract_id IN (${filter.subquery})
          GROUP BY c.contract_id
        )`;
}

function aggregateQtyField(fieldName: 'quantity_delivery_trucking' | 'quantity_delivery_vessel'): string {
  const sumField = fieldName === 'quantity_delivery_trucking' ? 'sum_trucking_adj' : 'sum_vessel_adj';
  const maxField = fieldName === 'quantity_delivery_trucking' ? 'max_trucking' : 'max_vessel';
  const col = fieldName === 'quantity_delivery_trucking' ? 'quantity_delivery_trucking' : 'quantity_delivery_vessel';
  return `CASE
              WHEN sto_count > 1 AND ${sumField} > quantity_ordered * 1.2 THEN ${maxField}
              ELSE ${sumField}
            END AS ${col}`;
}

export function buildQtyMoveCte(filter: QtyMoveContractFilter): string {
  const join = scopeJoin(filter);
  const extraWhere = scopeWhere(filter);
  const qtyTrucking = sqlSapQtyTruckingFromSpd('spd');
  const qtyVessel = sqlSapQtyVesselFromSpd('spd');

  return `
      qty_move AS (
        WITH latest_per_sto AS (
          SELECT DISTINCT ON (spd.contract_number, spd.sto_number)
            spd.contract_number,
            spd.sto_number,
            ${qtyTrucking} AS quantity_delivery_trucking,
            ${qtyVessel} AS quantity_delivery_vessel,
            ${sqlParseSapNumeric(`
              spd.data->'raw'->>'Quantity Receive',
              spd.data->'raw'->>'Qty Receive'
            `)} AS quantity_receive
          FROM sap_processed_data spd
          ${join}
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            ${extraWhere}
            AND spd.sto_number IS NOT NULL AND TRIM(spd.sto_number::text) != ''
          ORDER BY spd.contract_number, spd.sto_number, spd.created_at DESC NULLS LAST
        ),
        latest_no_sto AS (
          SELECT DISTINCT ON (spd.contract_number)
            spd.contract_number,
            ${qtyTrucking} AS quantity_delivery_trucking,
            ${qtyVessel} AS quantity_delivery_vessel,
            ${sqlParseSapNumeric(`
              spd.data->'raw'->>'Quantity Receive',
              spd.data->'raw'->>'Qty Receive'
            `)} AS quantity_receive
          FROM sap_processed_data spd
          ${join}
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            ${extraWhere}
            AND (spd.sto_number IS NULL OR TRIM(spd.sto_number::text) = '')
            AND NOT EXISTS (
              SELECT 1 FROM sap_processed_data spd2
              WHERE spd2.contract_number = spd.contract_number
                AND spd2.sto_number IS NOT NULL AND TRIM(spd2.sto_number::text) != ''
            )
          ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
        ),
        ${contractOrderedCte(filter)},
        sto_metrics AS (
          SELECT
            l.contract_number,
            co.quantity_ordered,
            COUNT(*)::int AS sto_count,
            COALESCE(SUM(l.quantity_delivery_trucking) FILTER (WHERE l.quantity_delivery_trucking IS NOT NULL), 0) AS sum_trucking_raw,
            COALESCE(SUM(l.quantity_delivery_vessel) FILTER (WHERE l.quantity_delivery_vessel IS NOT NULL), 0) AS sum_vessel_raw,
            COALESCE(SUM(l.quantity_receive) FILTER (WHERE l.quantity_receive IS NOT NULL), 0) AS sum_receive_raw
          FROM latest_per_sto l
          JOIN contract_ordered co ON co.contract_number = l.contract_number
          GROUP BY l.contract_number, co.quantity_ordered
        ),
        deduped AS (
          SELECT
            l.contract_number,
            COALESCE(SUM(l.quantity_delivery_trucking) FILTER (
              WHERE l.quantity_delivery_trucking IS NOT NULL
                AND NOT (
                  sm.sto_count > 1
                  AND sm.sum_trucking_raw > sm.quantity_ordered * 1.2
                  AND l.quantity_delivery_trucking >= sm.quantity_ordered * 0.95
                )
            ), 0)::numeric AS sum_trucking_adj,
            COALESCE(SUM(l.quantity_delivery_vessel) FILTER (
              WHERE l.quantity_delivery_vessel IS NOT NULL
                AND NOT (
                  sm.sto_count > 1
                  AND sm.sum_vessel_raw > sm.quantity_ordered * 1.2
                  AND l.quantity_delivery_vessel >= sm.quantity_ordered * 0.95
                )
            ), 0)::numeric AS sum_vessel_adj,
            COALESCE(SUM(l.quantity_receive) FILTER (
              WHERE l.quantity_receive IS NOT NULL
                AND NOT (
                  sm.sto_count > 1
                  AND sm.sum_receive_raw > sm.quantity_ordered * 1.2
                  AND l.quantity_receive >= sm.quantity_ordered * 0.95
                )
            ), 0)::numeric AS sum_receive_adj,
            COALESCE(MAX(l.quantity_delivery_trucking), 0)::numeric AS max_trucking,
            COALESCE(MAX(l.quantity_delivery_vessel), 0)::numeric AS max_vessel,
            COALESCE(MAX(l.quantity_receive), 0)::numeric AS max_receive,
            sm.quantity_ordered,
            sm.sto_count
          FROM latest_per_sto l
          JOIN sto_metrics sm ON sm.contract_number = l.contract_number
          GROUP BY l.contract_number, sm.quantity_ordered, sm.sto_count
        ),
        sto_result AS (
          SELECT
            contract_number,
            ${aggregateQtyField('quantity_delivery_trucking')},
            ${aggregateQtyField('quantity_delivery_vessel')},
            CASE
              WHEN sto_count > 1 AND sum_receive_adj > quantity_ordered * 1.2 THEN max_receive
              ELSE sum_receive_adj
            END AS quantity_receive
          FROM deduped
        )
        SELECT
          COALESCE(sr.contract_number, ns.contract_number) AS contract_number,
          CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_delivery_trucking ELSE ns.quantity_delivery_trucking END AS quantity_delivery_trucking,
          CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_delivery_vessel ELSE ns.quantity_delivery_vessel END AS quantity_delivery_vessel,
          CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_receive ELSE ns.quantity_receive END AS quantity_receive,
          COALESCE(
            NULLIF(
              CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_delivery_vessel ELSE ns.quantity_delivery_vessel END,
              0
            ),
            NULLIF(
              CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_delivery_trucking ELSE ns.quantity_delivery_trucking END,
              0
            )
          ) AS quantity_delivery
        FROM sto_result sr
        FULL OUTER JOIN latest_no_sto ns ON ns.contract_number = sr.contract_number
      )`;
}

export const CONTRACTS_QTY_MOVE_CTE = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });

export function sqlContractGlobalOutstandingExpr(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  contractNumberExpr: string;
}): string {
  const { contractQtyExpr, incotermExpr, contractNumberExpr } = opts;
  const transportExpr = `(SELECT ${sqlTransportModeFromContractAndJson('c.transport_mode', 'spd.data')}
    FROM contracts c
    LEFT JOIN LATERAL (
      SELECT spd.data FROM sap_processed_data spd
      WHERE spd.contract_number = c.contract_id
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) spd ON true
    WHERE c.contract_id = ${contractNumberExpr}
    LIMIT 1)`;
  return sqlIncotermOutstandingCase({
    contractQtyExpr,
    incotermExpr,
    truckingQtyExpr: `(SELECT qm.quantity_delivery_trucking FROM qty_move qm WHERE qm.contract_number = ${contractNumberExpr})`,
    vesselQtyExpr: `(SELECT qm.quantity_delivery_vessel FROM qty_move qm WHERE qm.contract_number = ${contractNumberExpr})`,
    transportExpr,
  });
}

export { sqlQtyMoveIncotermDelivery };
