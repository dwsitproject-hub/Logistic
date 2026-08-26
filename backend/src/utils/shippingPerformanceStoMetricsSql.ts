/**
 * Shipping Performance — one-pass STO metrics (eligible PO sums, B2B child excluded).
 */

import { sqlUserStoQtyAssignedToKgSql } from './userStoAssignmentQty';
import {
  SHIPPING_PERF_STO_GROUP_KEY_EXPR,
  shippingPerfStoMetricsKeyExpr,
} from './shippingPerformanceStoSql';
import {
  sqlShipmentListOutstandingKgExpr,
} from './shipmentListQtySql';
import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';
import { sqlIsContractSapClosedForStoExpr } from './contractDeliveryStatus';
import { sqlPoStoSapQtyKg } from './contractPoGlobalMetricsSql';
import {
  sqlStoScopedDeliveredKgSql,
  sqlStoScopedReceiveKgSql,
} from './contractLogisticsStoDetailSql';

import {
  sqlB2bChildExcludeWhere,
  sqlB2bChildContractRowExcludeWhere,
  sqlB2bChildSpdDataExcludeWhere,
} from './b2bChildSql';

export {
  sqlB2bChildExcludeWhere,
  sqlB2bChildContractRowExcludeWhere,
  sqlB2bChildSpdDataExcludeWhere,
};

export const LATEST_SPD_B2B_CTE = `
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
  return `
      ${perfStoKeysCteSql},
      ${LATEST_SPD_B2B_CTE},
      all_sto_contract_links AS (
        SELECT DISTINCT ON (sto_key, contract_id)
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
            ${shippingPerfStoMetricsKeyExpr('cc', 'sh')} AS sto_key,
            cc.id,
            cc.contract_id,
            cc.po_number,
            cc.quantity_ordered::numeric,
            cc.incoterm,
            NULLIF(cc.sto_quantity, 0)::numeric
          FROM shipments sh
          INNER JOIN contracts cc ON cc.id = sh.contract_id
          WHERE COALESCE(sh.status, '') <> 'CANCELLED'
            AND ${shippingPerfStoMetricsKeyExpr('cc', 'sh')} IS NOT NULL
        ) raw_links
        WHERE sto_key IS NOT NULL AND TRIM(sto_key) != ''
        ORDER BY sto_key, contract_id, contract_uuid
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
      sto_po_lines_raw AS (
        SELECT
          asp.sto_key,
          asp.contract_id,
          asp.po_number,
          asp.contract_qty,
          asp.incoterm,
          ${sqlStoScopedReceiveKgSql({
            contractNumberExpr: 'asp.contract_id',
            contractQtyExpr: 'asp.contract_qty',
            stoKeyExpr: 'asp.sto_key',
            poNumberExpr: 'asp.po_number',
          })} AS receive_kg,
          ${sqlStoScopedDeliveredKgSql({
            contractNumberExpr: 'asp.contract_id',
            contractQtyExpr: 'asp.contract_qty',
            stoKeyExpr: 'asp.sto_key',
            poNumberExpr: 'asp.po_number',
            incotermExpr: 'asp.incoterm',
          })} AS delivery_kg,
          COALESCE(
            NULLIF((${sqlPoStoSapQtyKg({
              contractNumberExpr: 'asp.contract_id',
              poNumberExpr: `COALESCE(NULLIF(TRIM(asp.po_number::text), ''), '')`,
              contractQtyExpr: 'asp.contract_qty',
              stoKeyExpr: 'asp.sto_key',
            })}), 0),
            asp.contract_sto_qty
          ) AS sto_qty_kg,
          csp.shipment_planning_kg
        FROM all_sto_contract_links asp
        INNER JOIN perf_sto_keys psk ON psk.sto_key = asp.sto_key
        LEFT JOIN latest_spd_b2b b2b ON b2b.contract_number = asp.contract_id
        LEFT JOIN contract_sto_planning csp
          ON csp.sto_key = asp.sto_key
          AND TRIM(csp.contract_id) = TRIM(asp.contract_id)
          AND csp.po_number = COALESCE(NULLIF(TRIM(asp.po_number::text), ''), '')
        WHERE ${sqlB2bChildExcludeWhere('b2b')}
      ),
      po_sto_counts AS (
        SELECT
          TRIM(contract_id) AS contract_id,
          TRIM(COALESCE(po_number::text, '')) AS po_number,
          COUNT(DISTINCT sto_key)::int AS sto_count_on_po
        FROM all_sto_contract_links
        GROUP BY TRIM(contract_id), TRIM(COALESCE(po_number::text, ''))
      ),
      sto_po_lines AS (
        SELECT
          raw.*,
          COALESCE(psc.sto_count_on_po, 1) AS sto_count_on_po,
          CASE
            WHEN COALESCE(psc.sto_count_on_po, 1) > 1
              THEN COALESCE(NULLIF(raw.sto_qty_kg, 0), raw.contract_qty)
            ELSE raw.contract_qty
          END AS os_base_kg
        FROM sto_po_lines_raw raw
        LEFT JOIN po_sto_counts psc
          ON psc.contract_id = TRIM(raw.contract_id)
         AND psc.po_number = TRIM(COALESCE(raw.po_number::text, ''))
      ),
      sto_shipment_klip AS (
        SELECT
          per_contract.sto_key,
          SUM(per_contract.klip_del)::numeric AS klip_delivery_kg,
          SUM(per_contract.klip_recv)::numeric AS klip_receive_kg,
          BOOL_AND(per_contract.is_closed) AS all_closed
        FROM (
          SELECT DISTINCT ON (raw.sto_key, raw.contract_id)
            raw.sto_key,
            raw.contract_id,
            raw.klip_del,
            raw.klip_recv,
            raw.is_closed
          FROM (
            SELECT
              ${shippingPerfStoMetricsKeyExpr('c', 's')} AS sto_key,
              TRIM(c.contract_id) AS contract_id,
              COALESCE(s.quantity_delivered_klip, 0)::numeric AS klip_del,
              COALESCE(s.actual_vessel_qty_receive, 0)::numeric AS klip_recv,
              (${sqlIsContractSapClosedForStoExpr('c', shippingPerfStoMetricsKeyExpr('c', 's'))}) AS is_closed,
              s.updated_at,
              s.created_at
            FROM shipments s
            INNER JOIN contracts c ON c.id = s.contract_id
            WHERE COALESCE(s.status, '') <> 'CANCELLED'
              AND ${shippingPerfStoMetricsKeyExpr('c', 's')} IS NOT NULL
          ) raw
          INNER JOIN perf_sto_keys psk ON psk.sto_key = raw.sto_key
          ORDER BY raw.sto_key, raw.contract_id, raw.updated_at DESC NULLS LAST, raw.created_at DESC NULLS LAST
        ) per_contract
        GROUP BY per_contract.sto_key
      ),
      sto_metrics AS (
        SELECT
          po.sto_key,
          SUM(po.contract_qty)::numeric AS contract_qty,
          SUM(po.sto_qty_kg)::numeric AS sto_qty,
          SUM(po.receive_kg)::numeric AS received_qty,
          SUM(po.delivery_kg)::numeric AS delivered_qty,
          SUM(po.shipment_planning_kg)::numeric AS planning_qty,
          MAX(po.sto_count_on_po)::int AS po_sto_count,
          (
            ${sqlShipmentListOutstandingKgExpr({
              contractQtyExpr: 'SUM(po.os_base_kg)',
              // Dominant / any incoterm on the STO — FOB/LCO use delivery; FRC/CIF use receive
              incotermExpr: `(ARRAY_AGG(po.incoterm ORDER BY po.contract_id))[1]`,
              receiveExpr: sqlShipmentResolvedReceiveKg(
                'COALESCE(BOOL_AND(sk.all_closed), FALSE)',
                // klip_* already SUM'd per STO; MAX avoids multiplying by PO lines
                'MAX(sk.klip_receive_kg)',
                'SUM(po.receive_kg)',
              ),
              deliveryExpr: sqlShipmentResolvedDeliveryKg(
                'COALESCE(BOOL_AND(sk.all_closed), FALSE)',
                'MAX(sk.klip_delivery_kg)',
                'SUM(po.delivery_kg)',
                'MAX(sk.klip_delivery_kg)',
              ),
              clampAtZero: false,
            })}
          )::numeric AS outstanding_qty_actual,
          SUM((
            CASE
              WHEN po.os_base_kg IS NULL THEN NULL
              WHEN po.sto_qty_kg IS NULL THEN NULL
              ELSE GREATEST(
                po.os_base_kg::numeric
                - COALESCE(po.sto_qty_kg, 0)::numeric
                - COALESCE(po.shipment_planning_kg, 0)::numeric,
                0
              )
            END
          )::numeric) AS outstanding_qty_planning,
          STRING_AGG(DISTINCT NULLIF(TRIM(po.po_number::text), ''), ', ' ORDER BY NULLIF(TRIM(po.po_number::text), '')) AS po_numbers,
          STRING_AGG(DISTINCT po.contract_id, ', ' ORDER BY po.contract_id) AS contract_numbers
        FROM sto_po_lines po
        LEFT JOIN sto_shipment_klip sk ON sk.sto_key = po.sto_key
        GROUP BY po.sto_key
      )`;
}

export function buildShippingPerfStoMetricsCte(): string {
  return buildStoPoMetricsCte(SHIPPING_PERF_PERF_STO_KEYS_CTE);
}

export function buildShipmentListStoMetricsCte(pageCte = 'shipment_page'): string {
  const perfStoKeysCte = `
      perf_sto_keys AS (
        SELECT DISTINCT TRIM(sto_key::text) AS sto_key
        FROM ${pageCte}
        WHERE sto_key IS NOT NULL AND TRIM(sto_key::text) != ''
      )`;
  return buildStoPoMetricsCte(perfStoKeysCte);
}

export { SHIPPING_PERF_STO_GROUP_KEY_EXPR };
