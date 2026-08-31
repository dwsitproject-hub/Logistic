/**
 * Global contract outstanding qty — same rules as Contracts list (`qty_move` CTE).
 * FRC/LCO Open: when trucking WB daily actuals exist, delivery/receive prefer
 * Netto PKS / Netto EUP sums from trucking_daily_actuals (aligns with Trucking list).
 * Close → SAP (no WB overlay). SEA FOB/CIF Open: KLIP shipment actuals over SAP.
 */

import {
  SQL_SPD_CONTRACT_REFF_PO,
  sqlCoalesceB2bOriginParentOrChildQty,
} from './b2bOriginEndingSql';
import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import {
  sqlContractOutstandingFromFields,
  sqlParseSapNumeric,
  sqlQtyMoveIncotermDelivery,
  sqlSapQtyTruckingFromSpd,
  sqlSapQtyVesselFromSpd,
} from './sapIncotermMetrics';
import { sqlCoalesceSapRawQtyFields } from './sapQtyPlaceholderSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';
import {
  sqlWbActualDeliverySumKg,
  sqlWbActualReceiveSumKg,
} from './truckingWbActualSumSql';

export type QtyMoveContractFilter =
  | { kind: 'join_scope'; scopeCteName: string }
  | { kind: 'in_subquery'; subquery: string };

/**
 * Include in-scope contracts, their B2B children (Reff PO → origin PO), and
 * origins of in-scope children so parent overlay can SUM child qty even when
 * the child contract_id is outside the date/filter scope.
 */
function qtyMoveScopeCte(filter: QtyMoveContractFilter): string {
  const originIds =
    filter.kind === 'join_scope'
      ? `SELECT cs.contract_id FROM ${filter.scopeCteName} cs`
      : filter.subquery;
  const latestChildSpd = `
          SELECT DISTINCT ON (spd.contract_number)
            spd.contract_number,
            spd.data
          FROM sap_processed_data spd
          WHERE spd.contract_number IS NOT NULL
            AND TRIM(spd.contract_number) != ''
            AND ${SQL_SPD_CONTRACT_REFF_PO('spd.data')} IS NOT NULL
          ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST`;
  return `
        qty_move_scope AS (
          SELECT contract_id FROM (${originIds}) scoped_ids(contract_id)
          UNION
          SELECT DISTINCT ch.contract_id
          FROM contracts ch
          INNER JOIN (${latestChildSpd}) ch_spd ON ch_spd.contract_number = ch.contract_id
          WHERE ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} IN (
            SELECT NULLIF(TRIM(o.po_number::text), '')
            FROM contracts o
            WHERE o.contract_id IN (${originIds})
              AND NULLIF(TRIM(o.po_number::text), '') IS NOT NULL
          )
          UNION
          SELECT DISTINCT o.contract_id
          FROM contracts o
          INNER JOIN (${latestChildSpd}) ch_spd
            ON ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} = NULLIF(TRIM(o.po_number::text), '')
          WHERE ch_spd.contract_number IN (${originIds})
        )`;
}

function contractOrderedCte(): string {
  return `
        contract_ordered AS (
          SELECT c.contract_id AS contract_number, MAX(c.quantity_ordered) AS quantity_ordered
          FROM contracts c
          INNER JOIN qty_move_scope cs ON cs.contract_id = c.contract_id
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

/**
 * FRC/LCO Open contracts with WB daily actuals — separate delivery (Netto PKS)
 * and receive (Netto EUP) sums across non-cancelled trucking ops. Close contracts
 * omitted so SAP wins. CANCELLED ops excluded so Contracts qty matches Trucking list.
 *
 * Gates align with Trucking list resolved qty (Open + WB column kg > 0):
 * - Incoterm via contractEffectiveIncotermExpr (DB || SAP), same as Trucking page scope
 * - No LAND% filter — Trucking page is FRC/LCO-scoped and resolves WB without transport_mode
 * - Delivery overlay only when Netto PKS sum > 0; receive overlay only when Netto EUP sum > 0
 *
 * Expressions use sqlWbActualDeliverySumKg / sqlWbActualReceiveSumKg (catalog-scoped).
 */
function truckingWbOverlayCte(): string {
  const grClosed = sqlIsContractSapClosedExpr('c');
  const effectiveIncoterm = contractEffectiveIncotermExpr('c');
  const wbDeliveryPerOp = sqlWbActualDeliverySumKg('t.id');
  const wbReceivePerOp = sqlWbActualReceiveSumKg('t.id');

  return `
        trucking_wb_overlay AS (
          SELECT
            c.contract_id AS contract_number,
            COALESCE(SUM(${wbDeliveryPerOp}), 0)::numeric AS wb_delivery_qty_kg,
            COALESCE(SUM(${wbReceivePerOp}), 0)::numeric AS wb_receive_qty_kg
          FROM contracts c
          INNER JOIN qty_move_scope cs ON cs.contract_id = c.contract_id
          INNER JOIN trucking_operations t ON t.contract_id = c.id
          WHERE ${effectiveIncoterm} IN ('FRC', 'LCO')
            AND NOT (${grClosed})
            AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
          GROUP BY c.contract_id
          HAVING BOOL_OR(
            EXISTS (
              SELECT 1 FROM trucking_daily_actuals da
              WHERE da.trucking_operation_id = t.id
            )
          )
        )`;
}

/**
 * SEA FOB/CIF Open contracts with KLIP shipment actuals — override SAP vessel
 * delivery with SUM(shipments.quantity_delivered_klip). Receive still uses
 * actual_vessel_qty_receive when present (legacy KLIP receive).
 * Mirror trucking: Open + actual → KLIP; Close (and Open without actual) stay on SAP.
 */
function shipmentKlipOverlayCte(): string {
  const grClosed = sqlIsContractSapClosedExpr('c');

  return `
        shipment_klip_overlay AS (
          SELECT
            c.contract_id AS contract_number,
            NULLIF(SUM(COALESCE(s.quantity_delivered_klip, 0)), 0)::numeric AS klip_delivery_kg,
            NULLIF(SUM(COALESCE(s.actual_vessel_qty_receive, 0)), 0)::numeric AS klip_receive_kg
          FROM contracts c
          INNER JOIN qty_move_scope cs ON cs.contract_id = c.contract_id
          INNER JOIN shipments s ON s.contract_id = c.id
          WHERE UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF', 'CFR')
            AND NOT (${grClosed})
            AND COALESCE(s.status, '') <> 'CANCELLED'
          GROUP BY c.contract_id
          HAVING SUM(COALESCE(s.quantity_delivered_klip, 0)) > 0
              OR SUM(COALESCE(s.actual_vessel_qty_receive, 0)) > 0
        )`;
}

export function buildQtyMoveCte(filter: QtyMoveContractFilter): string {
  const join = 'INNER JOIN qty_move_scope cs ON cs.contract_id = spd.contract_number';
  const qtyTrucking = sqlSapQtyTruckingFromSpd('spd');
  const qtyVessel = sqlSapQtyVesselFromSpd('spd');
  const parentIsOrigin = `(roll.origin_po IS NOT NULL AND ${SQL_SPD_CONTRACT_REFF_PO('p_spd.data')} IS NULL)`;
  const overlayTrucking = sqlCoalesceB2bOriginParentOrChildQty(
    'r.quantity_delivery_trucking',
    'roll.sum_delivery_trucking',
    parentIsOrigin,
  );
  const overlayVessel = sqlCoalesceB2bOriginParentOrChildQty(
    'r.quantity_delivery_vessel',
    'roll.sum_delivery_vessel',
    parentIsOrigin,
  );
  const overlayReceive = sqlCoalesceB2bOriginParentOrChildQty(
    'r.quantity_receive',
    'roll.sum_receive',
    parentIsOrigin,
  );

  return `
      qty_move AS (
        WITH ${qtyMoveScopeCte(filter)},
        latest_per_sto AS (
          SELECT DISTINCT ON (spd.contract_number, spd.sto_number)
            spd.contract_number,
            spd.sto_number,
            ${qtyTrucking} AS quantity_delivery_trucking,
            ${qtyVessel} AS quantity_delivery_vessel,
            ${sqlParseSapNumeric(sqlCoalesceSapRawQtyFields([
              `spd.data->'raw'->>'Quantity Receive'`,
              `spd.data->'raw'->>'Qty Receive'`,
            ]))} AS quantity_receive
          FROM sap_processed_data spd
          ${join}
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            AND spd.sto_number IS NOT NULL AND TRIM(spd.sto_number::text) != ''
          ORDER BY spd.contract_number, spd.sto_number, spd.created_at DESC NULLS LAST
        ),
        latest_no_sto AS (
          SELECT DISTINCT ON (spd.contract_number)
            spd.contract_number,
            ${qtyTrucking} AS quantity_delivery_trucking,
            ${qtyVessel} AS quantity_delivery_vessel,
            ${sqlParseSapNumeric(sqlCoalesceSapRawQtyFields([
              `spd.data->'raw'->>'Quantity Receive'`,
              `spd.data->'raw'->>'Qty Receive'`,
            ]))} AS quantity_receive
          FROM sap_processed_data spd
          ${join}
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            AND (spd.sto_number IS NULL OR TRIM(spd.sto_number::text) = '')
            AND NOT EXISTS (
              SELECT 1 FROM sap_processed_data spd2
              WHERE spd2.contract_number = spd.contract_number
                AND spd2.sto_number IS NOT NULL AND TRIM(spd2.sto_number::text) != ''
            )
          ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
        ),
        ${contractOrderedCte()},
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
        ),
        qty_move_sap AS (
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
        ),
        ${truckingWbOverlayCte()},
        ${shipmentKlipOverlayCte()},
        qty_move_resolved AS (
          SELECT
            COALESCE(s.contract_number, w.contract_number, sk.contract_number) AS contract_number,
            CASE
              WHEN w.wb_delivery_qty_kg > 0 THEN w.wb_delivery_qty_kg
              ELSE s.quantity_delivery_trucking
            END AS quantity_delivery_trucking,
            CASE
              WHEN sk.klip_delivery_kg IS NOT NULL THEN sk.klip_delivery_kg
              ELSE s.quantity_delivery_vessel
            END AS quantity_delivery_vessel,
            CASE
              WHEN sk.klip_receive_kg IS NOT NULL THEN sk.klip_receive_kg
              WHEN w.wb_receive_qty_kg > 0 THEN w.wb_receive_qty_kg
              ELSE s.quantity_receive
            END AS quantity_receive,
            COALESCE(
              NULLIF(
                CASE
                  WHEN sk.klip_delivery_kg IS NOT NULL THEN sk.klip_delivery_kg
                  ELSE s.quantity_delivery_vessel
                END,
                0
              ),
              NULLIF(
                CASE
                  WHEN w.wb_delivery_qty_kg > 0 THEN w.wb_delivery_qty_kg
                  ELSE s.quantity_delivery_trucking
                END,
                0
              )
            ) AS quantity_delivery
          FROM qty_move_sap s
          FULL OUTER JOIN trucking_wb_overlay w ON w.contract_number = s.contract_number
          FULL OUTER JOIN shipment_klip_overlay sk ON sk.contract_number = COALESCE(s.contract_number, w.contract_number)
        ),
        b2b_child_qty_rollup AS (
          SELECT
            ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} AS origin_po,
            SUM(r.quantity_delivery_trucking) AS sum_delivery_trucking,
            SUM(r.quantity_delivery_vessel) AS sum_delivery_vessel,
            SUM(r.quantity_receive) AS sum_receive
          FROM qty_move_resolved r
          INNER JOIN (
            SELECT DISTINCT ON (spd.contract_number)
              spd.contract_number,
              spd.data
            FROM sap_processed_data spd
            INNER JOIN qty_move_scope qs ON qs.contract_id = spd.contract_number
            WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
              AND ${SQL_SPD_CONTRACT_REFF_PO('spd.data')} IS NOT NULL
            ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
          ) ch_spd ON ch_spd.contract_number = r.contract_number
          WHERE ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')} IS NOT NULL
          GROUP BY ${SQL_SPD_CONTRACT_REFF_PO('ch_spd.data')}
        )
        SELECT
          o.contract_number,
          o.quantity_delivery_trucking,
          o.quantity_delivery_vessel,
          o.quantity_receive,
          COALESCE(
            NULLIF(o.quantity_delivery_vessel, 0),
            NULLIF(o.quantity_delivery_trucking, 0)
          ) AS quantity_delivery
        FROM (
          SELECT
            r.contract_number,
            ${overlayTrucking} AS quantity_delivery_trucking,
            ${overlayVessel} AS quantity_delivery_vessel,
            ${overlayReceive} AS quantity_receive
          FROM qty_move_resolved r
          LEFT JOIN contracts pc ON pc.contract_id = r.contract_number
          LEFT JOIN (
            SELECT DISTINCT ON (spd.contract_number)
              spd.contract_number,
              spd.data
            FROM sap_processed_data spd
            INNER JOIN qty_move_scope qs ON qs.contract_id = spd.contract_number
            WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
          ) p_spd ON p_spd.contract_number = r.contract_number
          LEFT JOIN b2b_child_qty_rollup roll
            ON roll.origin_po = NULLIF(TRIM(pc.po_number::text), '')
        ) o
      )`;
}

export const CONTRACTS_QTY_MOVE_CTE = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });

/** Fast read path: join pre-computed snapshot scoped to list CTE (same columns as qty_move). */
export function buildQtyMoveFromSnapshotCte(scopeCteName = 'contract_scope'): string {
  return `
      qty_move AS (
        SELECT
          s.contract_number,
          s.quantity_delivery_trucking,
          s.quantity_delivery_vessel,
          s.quantity_receive,
          s.quantity_delivery
        FROM contract_qty_move_snapshot s
        INNER JOIN ${scopeCteName} cs ON cs.contract_id = s.contract_number
      )`;
}

/** SQL to refresh snapshot rows using live qty_move logic (all contracts). */
export function buildContractQtyMoveSnapshotRefreshSql(): string {
  return `
    WITH ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_id FROM contracts' })}
    INSERT INTO contract_qty_move_snapshot (
      contract_number,
      quantity_delivery_trucking,
      quantity_delivery_vessel,
      quantity_receive,
      quantity_delivery,
      refreshed_at
    )
    SELECT
      qm.contract_number,
      COALESCE(qm.quantity_delivery_trucking, 0),
      COALESCE(qm.quantity_delivery_vessel, 0),
      COALESCE(qm.quantity_receive, 0),
      COALESCE(qm.quantity_delivery, 0),
      NOW()
    FROM qty_move qm
    WHERE qm.contract_number IS NOT NULL
    ON CONFLICT (contract_number) DO UPDATE SET
      quantity_delivery_trucking = EXCLUDED.quantity_delivery_trucking,
      quantity_delivery_vessel = EXCLUDED.quantity_delivery_vessel,
      quantity_receive = EXCLUDED.quantity_receive,
      quantity_delivery = EXCLUDED.quantity_delivery,
      refreshed_at = EXCLUDED.refreshed_at`;
}

/** Refresh snapshot for specific contract numbers (after SAP row / WB upload). */
export function buildContractQtyMoveSnapshotUpsertSql(): string {
  return `
    WITH ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_id FROM contracts WHERE contract_id = ANY($1)' })}
    INSERT INTO contract_qty_move_snapshot (
      contract_number,
      quantity_delivery_trucking,
      quantity_delivery_vessel,
      quantity_receive,
      quantity_delivery,
      refreshed_at
    )
    SELECT
      qm.contract_number,
      COALESCE(qm.quantity_delivery_trucking, 0),
      COALESCE(qm.quantity_delivery_vessel, 0),
      COALESCE(qm.quantity_receive, 0),
      COALESCE(qm.quantity_delivery, 0),
      NOW()
    FROM qty_move qm
    WHERE qm.contract_number IS NOT NULL
    ON CONFLICT (contract_number) DO UPDATE SET
      quantity_delivery_trucking = EXCLUDED.quantity_delivery_trucking,
      quantity_delivery_vessel = EXCLUDED.quantity_delivery_vessel,
      quantity_receive = EXCLUDED.quantity_receive,
      quantity_delivery = EXCLUDED.quantity_delivery,
      refreshed_at = EXCLUDED.refreshed_at`;
}

export function sqlContractGlobalOutstandingExpr(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  contractNumberExpr: string;
}): string {
  const { contractQtyExpr, incotermExpr, contractNumberExpr } = opts;
  const qmReceive = `(SELECT qm.quantity_receive FROM qty_move qm WHERE qm.contract_number = ${contractNumberExpr})`;
  // Incoterm Quantity Delivery (trucking vs vessel). Transport from contracts only —
  // do not correlate sap_processed_data here (this expr is used in list/OS membership).
  const transportExpr = `(SELECT UPPER(TRIM(COALESCE(c.transport_mode, ''))) FROM contracts c WHERE c.contract_id = ${contractNumberExpr} LIMIT 1)`;
  const qmDelivery = sqlQtyMoveIncotermDelivery(incotermExpr, contractNumberExpr, transportExpr);
  return sqlContractOutstandingFromFields({
    contractQtyExpr,
    incotermExpr,
    receiveExpr: qmReceive,
    deliveryExpr: qmDelivery,
    clampAtZero: true,
  });
}

export { sqlQtyMoveIncotermDelivery };
