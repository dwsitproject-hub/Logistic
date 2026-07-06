/**
 * Shipping Performance — one-pass STO metrics (eligible PO sums, B2B child excluded).
 */

import { sqlUserStoQtyAssignedToKgSql } from './userStoAssignmentQty';
import { SHIPPING_PERF_STO_GROUP_KEY_EXPR } from './shippingPerformanceStoSql';
import {
  sqlShipmentListOutstandingKgExpr,
} from './shipmentListQtySql';

const SPD_STO_EXPR = (spdAlias = 'spd') => `NULLIF(TRIM(COALESCE(
  ${spdAlias}.sto_number::text,
  ${spdAlias}.data->'raw'->>'STO No.',
  ${spdAlias}.data->'raw'->>'STO Number',
  ${spdAlias}.data->'shipment'->>'sto_no',
  ${spdAlias}.data->'contract'->>'sto_no'
)), '')`;

const SPD_RECEIVE_KG = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

const SPD_DELIVER_KG = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivered'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivery'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

const SPD_STO_QTY_KG = `NULLIF(regexp_replace(COALESCE(
  NULLIF(TRIM(spd.data->'contract'->>'sto_quantity'), ''),
  NULLIF(TRIM(spd.data->'shipment'->>'sto_quantity'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'STO Quantity'), ''),
  NULLIF(TRIM(spd.data->'raw'->>'sto quantity'), ''),
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

const B2B_CHILD_WHERE = (b2bAlias: string) => `NOT (
  UPPER(TRIM(COALESCE(${b2bAlias}.b2b_flag, ''))) = 'B2B'
  AND NULLIF(TRIM(COALESCE(${b2bAlias}.contract_reference_po, '')), '') IS NOT NULL
)`;

const SHIPPING_PERF_PERF_STO_KEYS_CTE = `
      perf_sto_keys AS (
        SELECT DISTINCT TRIM(sto_key::text) AS sto_key
        FROM ship_keys
        WHERE sto_key IS NOT NULL AND TRIM(sto_key::text) != ''
      )`;

/** Page-scoped STO keys for Shipments list (after shipment_page CTE). */
export const SHIPMENT_LIST_PERF_STO_KEYS_CTE = `
      perf_sto_keys AS (
        SELECT DISTINCT TRIM(sto_key::text) AS sto_key
        FROM shipment_page
        WHERE sto_key IS NOT NULL AND TRIM(sto_key::text) != ''
      )`;

/** CTEs: perf_sto_keys → sto_po_lines → sto_metrics. Join on sto_key. */
export function buildStoPoMetricsCte(perfStoKeysCteSql: string): string {
  const stoExpr = SPD_STO_EXPR('spd');
  return `
      ${perfStoKeysCteSql},
      latest_spd_b2b AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          UPPER(TRIM(COALESCE(
            spd.data->'contract'->>'contract_type',
            spd.data->>'B2B Flag',
            ''
          ))) AS b2b_flag,
          NULLIF(TRIM(COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          )), '') AS contract_reference_po
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      all_sto_contract_links AS (
        SELECT DISTINCT
          sto_key,
          contract_uuid,
          contract_id,
          po_number,
          contract_qty,
          incoterm,
          contract_sto_qty
        FROM (
          SELECT
            TRIM(cs.sto_number::text) AS sto_key,
            cc.id AS contract_uuid,
            cc.contract_id,
            cc.po_number,
            cc.quantity_ordered::numeric AS contract_qty,
            cc.incoterm,
            NULLIF(cc.sto_quantity, 0)::numeric AS contract_sto_qty
          FROM contract_stos cs
          INNER JOIN contracts cc ON cc.id = cs.contract_id
          WHERE cs.sto_number IS NOT NULL AND TRIM(cs.sto_number::text) != ''

          UNION ALL

          SELECT
            TRIM(cc.sto_number::text),
            cc.id,
            cc.contract_id,
            cc.po_number,
            cc.quantity_ordered::numeric,
            cc.incoterm,
            NULLIF(cc.sto_quantity, 0)::numeric
          FROM contracts cc
          WHERE cc.sto_number IS NOT NULL AND TRIM(cc.sto_number::text) != ''

          UNION ALL

          SELECT
            ${stoExpr},
            cc.id,
            cc.contract_id,
            cc.po_number,
            cc.quantity_ordered::numeric,
            cc.incoterm,
            NULLIF(cc.sto_quantity, 0)::numeric
          FROM sap_processed_data spd
          INNER JOIN contracts cc ON TRIM(cc.contract_id) = TRIM(spd.contract_number)
          WHERE ${stoExpr} IS NOT NULL

          UNION ALL

          SELECT
            TRIM(COALESCE(
              NULLIF(TRIM(sh.shipment_id), ''),
              NULLIF(TRIM(sh.operation_id), '')
            )) AS sto_key,
            cc.id,
            cc.contract_id,
            cc.po_number,
            cc.quantity_ordered::numeric,
            cc.incoterm,
            NULLIF(cc.sto_quantity, 0)::numeric
          FROM shipments sh
          INNER JOIN contracts cc ON cc.id = sh.contract_id
          WHERE COALESCE(sh.status, '') <> 'CANCELLED'
            AND TRIM(COALESCE(
              NULLIF(TRIM(sh.shipment_id), ''),
              NULLIF(TRIM(sh.operation_id), '')
            )) != ''
        ) raw_links
        WHERE sto_key IS NOT NULL AND TRIM(sto_key) != ''
      ),
      latest_spd_by_sto_contract AS (
        SELECT DISTINCT ON (${stoExpr}, spd.contract_number)
          ${stoExpr} AS sto_key,
          spd.contract_number,
          ${SPD_RECEIVE_KG} AS receive_kg,
          ${SPD_DELIVER_KG} AS delivery_kg,
          ${SPD_STO_QTY_KG} AS sto_qty_kg
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
          AND ${stoExpr} IS NOT NULL
        ORDER BY ${stoExpr}, spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      contract_sto_planning AS (
        SELECT
          TRIM(u.sto_number::text) AS sto_key,
          TRIM(u.contract_number) AS contract_id,
          COALESCE(NULLIF(TRIM(u.po_number::text), ''), '') AS po_number,
          SUM(
            ${sqlUserStoQtyAssignedToKgSql('u.sto_qty_assigned', 'cc.quantity_ordered')}
          )::numeric AS shipment_planning_kg
        FROM user_sto_contract_assignments u
        INNER JOIN contracts cc ON cc.contract_id = u.contract_number
          AND COALESCE(cc.po_number, '') = COALESCE(NULLIF(TRIM(u.po_number::text), ''), '')
        GROUP BY TRIM(u.sto_number::text), TRIM(u.contract_number), COALESCE(NULLIF(TRIM(u.po_number::text), ''), '')
      ),
      sto_po_lines AS (
        SELECT
          asp.sto_key,
          asp.contract_id,
          asp.po_number,
          asp.contract_qty,
          asp.incoterm,
          lspd.receive_kg,
          lspd.delivery_kg,
          COALESCE(
            NULLIF(lspd.sto_qty_kg, 0),
            asp.contract_sto_qty
          ) AS sto_qty_kg,
          csp.shipment_planning_kg
        FROM all_sto_contract_links asp
        INNER JOIN perf_sto_keys psk ON psk.sto_key = asp.sto_key
        LEFT JOIN latest_spd_b2b b2b ON b2b.contract_number = asp.contract_id
        LEFT JOIN latest_spd_by_sto_contract lspd
          ON lspd.sto_key = asp.sto_key
          AND TRIM(lspd.contract_number) = TRIM(asp.contract_id)
        LEFT JOIN contract_sto_planning csp
          ON csp.sto_key = asp.sto_key
          AND TRIM(csp.contract_id) = TRIM(asp.contract_id)
          AND csp.po_number = COALESCE(NULLIF(TRIM(asp.po_number::text), ''), '')
        WHERE ${B2B_CHILD_WHERE('b2b')}
      ),
      sto_metrics AS (
        SELECT
          po.sto_key,
          SUM(po.contract_qty)::numeric AS contract_qty,
          SUM(po.sto_qty_kg)::numeric AS sto_qty,
          SUM(po.receive_kg)::numeric AS received_qty,
          SUM(po.delivery_kg)::numeric AS delivered_qty,
          SUM(po.shipment_planning_kg)::numeric AS planning_qty,
          SUM((${sqlShipmentListOutstandingKgExpr({
            contractQtyExpr: 'po.contract_qty',
            incotermExpr: 'po.incoterm',
            receiveExpr: 'po.receive_kg',
            deliveryExpr: 'po.delivery_kg',
            clampAtZero: true,
          })})::numeric) AS outstanding_qty_actual,
          SUM((
            CASE
              WHEN po.contract_qty IS NULL THEN NULL
              WHEN po.sto_qty_kg IS NULL THEN NULL
              ELSE GREATEST(
                po.contract_qty::numeric
                - COALESCE(po.sto_qty_kg, 0)::numeric
                - COALESCE(po.shipment_planning_kg, 0)::numeric,
                0
              )
            END
          )::numeric) AS outstanding_qty_planning,
          STRING_AGG(DISTINCT NULLIF(TRIM(po.po_number::text), ''), ', ' ORDER BY NULLIF(TRIM(po.po_number::text), '')) AS po_numbers,
          STRING_AGG(DISTINCT po.contract_id, ', ' ORDER BY po.contract_id) AS contract_numbers
        FROM sto_po_lines po
        GROUP BY po.sto_key
      )`;
}

export function buildShippingPerfStoMetricsCte(): string {
  return buildStoPoMetricsCte(SHIPPING_PERF_PERF_STO_KEYS_CTE);
}

export function buildShipmentListStoMetricsCte(): string {
  return buildStoPoMetricsCte(SHIPMENT_LIST_PERF_STO_KEYS_CTE);
}

export { SHIPPING_PERF_STO_GROUP_KEY_EXPR };
