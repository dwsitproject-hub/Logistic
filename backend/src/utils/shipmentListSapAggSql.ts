/** SAP aggregation CTEs for shipments list (page-scoped spd_keyed join). */

import {
  SAP_VESSEL_CODE_FROM_SK_SQL,
  SAP_VESSEL_NAME_FROM_SK_SQL,
  SAP_VESSEL_OWNER_FROM_SK_SQL,
} from './sapVesselFields';
import { buildShipmentListStoMetricsCte, sqlB2bChildSpdDataExcludeWhere } from './shippingPerformanceStoMetricsSql';
import { sqlB2bChildSpdDataIsChild } from './b2bChildSql';
import {
  SHIPMENT_LIST_SAP_PORTS_AGG_CTES,
  SHIPMENT_LIST_SAP_PORTS_AGG_STUB,
} from './shipmentListPortsSql';
import { sapStoNumberKeyExpr } from './shipmentStoTypeSql';
import { sqlSapIncotermFromJsonb, sqlSapSourceTypeFromJsonb } from './sapSourceTypeSql';

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
        SELECT NULL::text AS sto_key, NULL::timestamptz AS created_at, NULL::uuid AS spd_id, NULL::jsonb AS data
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
      /*
       * Page contract numbers, split ONCE per page row.
       *
       * shipment_page.contract_numbers is a comma-separated list. The old spd_keyed join
       * tested it with EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(...))) inside an
       * OR'd join condition, so Postgres could not hash or index either side and fell back to
       * a nested loop over the whole of sap_processed_data - re-running the regex split for
       * every (page row x SAP row) pair. Measured on a copy of staging: 25 page rows x 9,797
       * SAP rows, 244,832 rows discarded by the join filter and the split executed 244,587
       * times, for 17.6s of a 27.6s query (64%).
       *
       * Splitting first turns that into a plain equality any index can serve. DISTINCT keeps
       * the EXISTS semantics of the original: at most one row per (sto_key, contract_number),
       * so a duplicated entry in the CSV cannot duplicate a SAP row downstream.
       */
      shipment_page_contracts AS (
        SELECT DISTINCT
          sp.sto_key,
          TRIM(cn) AS contract_number
        FROM shipment_page sp
        CROSS JOIN unnest(regexp_split_to_array(sp.contract_numbers, ',')) AS cn
        WHERE sp.contract_numbers IS NOT NULL
          AND sp.sto_key IS NOT NULL AND TRIM(sp.sto_key::text) != ''
          AND TRIM(cn) != ''
      ),
      spd_keyed AS (
        /*
         * Key SAP rows to the *page* sto_key.
         * Primary branch: STO-based match (fast when STO exists).
         * Fallback branch: contract_number ∈ shipment_page.contract_numbers (needed for
         * synthetic OP-SEA-* rows / SPD without STO). Must NOT pull SPD rows whose STO
         * differs from the page key — multi-STO contracts (contract_stos) otherwise
         * contaminate ports/qty (e.g. STO A showing loading port from STO B).
         *
         * The two branches were one join with an OR; they are now UNION ALL so each can be
         * planned independently against an index. The fallback adds
         * (sto expr = sto_key) IS NOT TRUE, which is exactly "not already matched by the
         * primary branch" - so every pair appears exactly once, as under the original OR.
         * IS NOT TRUE (rather than NOT ...) is required because <sto expr> can be NULL, and
         * the original join filter treated a NULL comparison as no-match.
         */
        SELECT
          sp.sto_key,
          spd.created_at,
          spd.id AS spd_id,
          spd.data
        FROM shipment_page sp
        INNER JOIN sap_processed_data spd
          ON ${sapStoNumberKeyExpr('spd')} = TRIM(sp.sto_key::text)
        WHERE sp.sto_key IS NOT NULL AND TRIM(sp.sto_key::text) != ''

        UNION ALL

        SELECT
          spc.sto_key,
          spd.created_at,
          spd.id AS spd_id,
          spd.data
        FROM shipment_page_contracts spc
        INNER JOIN sap_processed_data spd
          ON TRIM(spd.contract_number::text) = spc.contract_number
        WHERE spd.contract_number IS NOT NULL
          AND (${sapStoNumberKeyExpr('spd')} = TRIM(spc.sto_key::text)) IS NOT TRUE
          AND (
            TRIM(spc.sto_key::text) ~ '^OP-'
            OR ${sapStoNumberKeyExpr('spd')} IS NULL
          )
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
          WHERE ${sqlB2bChildSpdDataExcludeWhere('sk.data')}
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
          ${sqlSapIncotermFromJsonb('sk.data')} AS incoterm,
          COALESCE(sk.data->'contract'->>'contract_type', sk.data->>'B2B Flag', sk.data->>'Contract Type') AS b2b_flag,
          ${sqlSapSourceTypeFromJsonb('sk.data')} AS source_type,
          vp.vessel_name_sap,
          vp.vessel_code_sap,
          vp.vessel_owner_sap
        FROM spd_keyed sk
        LEFT JOIN sap_vessel_pick vp ON vp.sto_key = sk.sto_key
        WHERE sk.sto_key IS NOT NULL
        /*
         * Which SAP row represents this STO.
         *
         * 1. B2B CHILD ROWS RANK LAST. An STO can carry several contracts, and the page
         *    already excludes B2B children from the row set and from po_numbers_agg. Letting
         *    one of them supply b2b_flag meant the column could describe a contract the page
         *    deliberately does not count, while the PO column beside it excluded that same
         *    contract. Measured on a copy of staging: of 335 STO+timestamp groups tied to the
         *    microsecond, 45 disagreed on b2b_flag; ranking children last settles 38 of them
         *    from the data rather than by luck.
         *
         *    This is a preference, not a filter, and that is deliberate: 259 of 3,871 STOs
         *    (6.7%) have ONLY child rows. Filtering them out would leave those STOs with no
         *    sap_latest row at all, blanking b2b_flag and dropping incoterm to a fallback.
         *    Ranking keeps the current value for them and changes only STOs that actually
         *    have a non-child alternative.
         *
         * 2. Then newest first, as before.
         *
         * 3. Then spd_id DESC as a final tie-break. Without it the winner among rows sharing
         *    created_at is whatever the plan happens to emit first, so the displayed flag
         *    changed whenever the plan did. incoterm and source_type never disagree within a
         *    tied group (measured: 0 conflicts), so this only ever decided b2b_flag.
         */
        ORDER BY
          sk.sto_key,
          CASE WHEN ${sqlB2bChildSpdDataIsChild('sk.data')} THEN 1 ELSE 0 END,
          sk.created_at DESC NULLS LAST,
          sk.spd_id DESC
      )`;

export function shipmentListSpdAggCtes(skipSapJoin: boolean, pageCte = 'shipment_page'): string {
  if (skipSapJoin) return SHIPMENT_LIST_SPD_AGG_CTES_STUB;
  const spdFull = SHIPMENT_LIST_SPD_AGG_CTES_FULL.replace(/\bshipment_page\b/g, pageCte);
  return `${spdFull},
      ${buildShipmentListStoMetricsCte(pageCte)},
      ${SHIPMENT_LIST_SAP_PORTS_AGG_CTES}`;
}
