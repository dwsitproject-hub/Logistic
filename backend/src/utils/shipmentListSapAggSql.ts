/** SAP aggregation CTEs for shipments list (page-scoped spd_keyed join). */

import {
  SAP_VESSEL_CODE_FROM_SK_SQL,
  SAP_VESSEL_NAME_FROM_SK_SQL,
  SAP_VESSEL_OWNER_FROM_SK_SQL,
} from './sapVesselFields';
import { buildShipmentListStoMetricsCte } from './shippingPerformanceStoMetricsSql';
import {
  SHIPMENT_LIST_SAP_PORTS_AGG_CTES,
  SHIPMENT_LIST_SAP_PORTS_AGG_STUB,
} from './shipmentListPortsSql';
import { sapStoNumberKeyExpr } from './shipmentStoTypeSql';

export const SHIPMENT_LIST_STO_METRICS_STUB = `
      sto_metrics AS (
        SELECT NULL::text AS sto_key,
          NULL::numeric AS contract_qty,
          NULL::numeric AS sto_qty,
          NULL::numeric AS received_qty,
          NULL::numeric AS delivered_qty,
          NULL::numeric AS planning_qty,
          NULL::numeric AS outstanding_qty_actual,
          NULL::numeric AS outstanding_qty_planning,
          NULL::text AS po_numbers,
          NULL::text AS contract_numbers
        WHERE false
      )`;

export const SHIPMENT_LIST_SPD_AGG_CTES_STUB = `
      spd_keyed AS (
        SELECT NULL::text AS sto_key, NULL::timestamptz AS created_at, NULL::jsonb AS data
        WHERE false
      ),
      contract_ext_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS contract_ext_no WHERE false
      ),
      po_numbers_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS po_numbers WHERE false
      ),
      sap_agg AS (
        SELECT NULL::text AS sto_key,
          NULL::numeric AS sto_quantity,
          NULL::numeric AS quantity_receive,
          NULL::numeric AS quantity_delivered_sap
        WHERE false
      ),
      sap_latest AS (
        SELECT NULL::text AS sto_key,
          NULL::text AS incoterm,
          NULL::text AS b2b_flag,
          NULL::text AS source_type,
          NULL::text AS vessel_name_sap,
          NULL::text AS vessel_code_sap,
          NULL::text AS vessel_owner_sap
        WHERE false
      ),
      ${SHIPMENT_LIST_STO_METRICS_STUB.trim()},
      ${SHIPMENT_LIST_SAP_PORTS_AGG_STUB}`;

export const SHIPMENT_LIST_SPD_AGG_CTES_FULL = `
      spd_keyed AS (
        /*
         * Key SAP rows to the *page* sto_key.
         * Primary join: STO-based match (fast when STO exists).
         * Fallback join: contract_number ∈ shipment_page.contract_numbers (needed for
         * synthetic OP-SEA-* rows / SPD without STO). Must NOT pull SPD rows whose STO
         * differs from the page key — multi-STO contracts (contract_stos) otherwise
         * contaminate ports/qty (e.g. STO A showing loading port from STO B).
         */
        SELECT
          sp.sto_key,
          spd.created_at,
          spd.data
        FROM shipment_page sp
        INNER JOIN sap_processed_data spd
          ON (
            ${sapStoNumberKeyExpr('spd')} = TRIM(sp.sto_key::text)
            OR (
              spd.contract_number IS NOT NULL
              AND sp.contract_numbers IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM unnest(regexp_split_to_array(sp.contract_numbers, ',')) AS cn
                WHERE TRIM(cn) = TRIM(spd.contract_number::text)
              )
              AND (
                TRIM(sp.sto_key::text) ~ '^OP-'
                OR ${sapStoNumberKeyExpr('spd')} IS NULL
                OR ${sapStoNumberKeyExpr('spd')} = TRIM(sp.sto_key::text)
              )
            )
          )
        WHERE sp.sto_key IS NOT NULL AND TRIM(sp.sto_key::text) != ''
      ),
      contract_ext_agg AS (
        SELECT
          q.sto_key,
          STRING_AGG(DISTINCT q.v, ', ' ORDER BY q.v) AS contract_ext_no
        FROM (
          SELECT
            sk.sto_key,
            NULLIF(TRIM(COALESCE(
              sk.data->'raw'->>'Contract Ext No',
              sk.data->>'Contract Ext No'
            )), '') AS v
          FROM spd_keyed sk
        ) q
        WHERE q.v IS NOT NULL AND q.v != ''
        GROUP BY q.sto_key
      ),
      po_numbers_agg AS (
        SELECT
          q.sto_key,
          STRING_AGG(DISTINCT q.v, ', ' ORDER BY q.v) AS po_numbers
        FROM (
          SELECT
            sk.sto_key,
            NULLIF(TRIM(COALESCE(
              sk.data->'raw'->>'PO No',
              sk.data->'raw'->>'PO Number',
              sk.data->'raw'->>'PO No.',
              sk.data->'contract'->>'po_number',
              sk.data->>'PO No'
            )), '') AS v
          FROM spd_keyed sk
        ) q
        WHERE q.v IS NOT NULL AND q.v != ''
        GROUP BY q.sto_key
      ),
      sap_agg AS (
        SELECT
          sk.sto_key,
          SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk.data->'contract'->>'sto_quantity'), ''),
              NULLIF(TRIM(sk.data->'shipment'->>'sto_quantity'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'STO Quantity'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'sto quantity'), '')
              , ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ) AS sto_quantity,
          SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk.data->'raw'->>'Quantity Receive'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'Qty Receive'), '')
              , ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ) AS quantity_receive,
          SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk.data->'raw'->>'Quantity Delivered'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'Quantity Delivery'), '')
              , ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ) AS quantity_delivered_sap
        FROM spd_keyed sk
        WHERE sk.sto_key IS NOT NULL
        GROUP BY sk.sto_key
      ),
      sap_vessel_pick AS (
        SELECT DISTINCT ON (sk.sto_key)
          sk.sto_key,
          ${SAP_VESSEL_NAME_FROM_SK_SQL} AS vessel_name_sap,
          ${SAP_VESSEL_CODE_FROM_SK_SQL} AS vessel_code_sap,
          ${SAP_VESSEL_OWNER_FROM_SK_SQL} AS vessel_owner_sap
        FROM spd_keyed sk
        WHERE sk.sto_key IS NOT NULL
        ORDER BY
          sk.sto_key,
          (CASE
            WHEN ${SAP_VESSEL_NAME_FROM_SK_SQL} IS NOT NULL
             AND ${SAP_VESSEL_CODE_FROM_SK_SQL} IS NOT NULL
            THEN 0 ELSE 1 END),
          sk.created_at DESC NULLS LAST
      ),
      sap_latest AS (
        SELECT DISTINCT ON (sk.sto_key)
          sk.sto_key,
          COALESCE(sk.data->'contract'->>'incoterm', sk.data->>'Incoterm') AS incoterm,
          COALESCE(sk.data->'contract'->>'contract_type', sk.data->>'B2B Flag', sk.data->>'Contract Type') AS b2b_flag,
          COALESCE(sk.data->'contract'->>'source_type', sk.data->>'Source') AS source_type,
          vp.vessel_name_sap,
          vp.vessel_code_sap,
          vp.vessel_owner_sap
        FROM spd_keyed sk
        LEFT JOIN sap_vessel_pick vp ON vp.sto_key = sk.sto_key
        WHERE sk.sto_key IS NOT NULL
        ORDER BY sk.sto_key, sk.created_at DESC NULLS LAST
      )`;

export function shipmentListSpdAggCtes(skipSapJoin: boolean): string {
  if (skipSapJoin) return SHIPMENT_LIST_SPD_AGG_CTES_STUB;
  return `${SHIPMENT_LIST_SPD_AGG_CTES_FULL},
      ${buildShipmentListStoMetricsCte()},
      ${SHIPMENT_LIST_SAP_PORTS_AGG_CTES}`;
}
