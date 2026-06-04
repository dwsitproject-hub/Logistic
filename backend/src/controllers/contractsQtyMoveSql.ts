/**
 * SAP quantity movement per contract for outstanding qty.
 *
 * Two-stage aggregation:
 * 1. STO-based (existing logic): latest row per STO → SUM with dedup guard.
 *    Used when a contract has at least one row with a STO number.
 * 2. No-STO fallback: latest single row per contract for contracts that have
 *    NO STO numbers at all in sap_processed_data. SAP sometimes sends delivery
 *    data without linking to an STO (e.g. land/FRC contracts). Without this
 *    fallback those contracts would always show outstanding = full contract qty.
 *
 * Final SELECT: if STO-based result exists → use it (even when qty = 0, because
 * SAP explicitly reported 0). Otherwise → use no-STO latest row.
 */
export const CONTRACTS_QTY_MOVE_CTE = `
      qty_move AS (
        WITH latest_per_sto AS (
          SELECT DISTINCT ON (spd.contract_number, spd.sto_number)
            spd.contract_number,
            spd.sto_number,
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC) AS quantity_delivery,
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC) AS quantity_receive
          FROM sap_processed_data spd
          INNER JOIN contract_scope cs ON cs.contract_id = spd.contract_number
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            AND spd.sto_number IS NOT NULL AND TRIM(spd.sto_number::text) != ''
          ORDER BY spd.contract_number, spd.sto_number, spd.created_at DESC NULLS LAST
        ),
        latest_no_sto AS (
          -- Latest SAP row per contract for contracts that have NO STO number.
          SELECT DISTINCT ON (spd.contract_number)
            spd.contract_number,
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC) AS quantity_delivery,
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC) AS quantity_receive
          FROM sap_processed_data spd
          INNER JOIN contract_scope cs ON cs.contract_id = spd.contract_number
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
            AND (spd.sto_number IS NULL OR TRIM(spd.sto_number::text) = '')
            AND NOT EXISTS (
              SELECT 1 FROM sap_processed_data spd2
              WHERE spd2.contract_number = spd.contract_number
                AND spd2.sto_number IS NOT NULL AND TRIM(spd2.sto_number::text) != ''
            )
          ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
        ),
        contract_ordered AS (
          SELECT c.contract_id AS contract_number, MAX(c.quantity_ordered) AS quantity_ordered
          FROM contracts c
          INNER JOIN contract_scope cs ON cs.contract_id = c.contract_id
          GROUP BY c.contract_id
        ),
        sto_metrics AS (
          SELECT
            l.contract_number,
            co.quantity_ordered,
            COUNT(*)::int AS sto_count,
            COALESCE(SUM(l.quantity_delivery) FILTER (WHERE l.quantity_delivery IS NOT NULL), 0) AS sum_delivery_raw,
            COALESCE(SUM(l.quantity_receive) FILTER (WHERE l.quantity_receive IS NOT NULL), 0) AS sum_receive_raw
          FROM latest_per_sto l
          JOIN contract_ordered co ON co.contract_number = l.contract_number
          GROUP BY l.contract_number, co.quantity_ordered
        ),
        deduped AS (
          SELECT
            l.contract_number,
            COALESCE(SUM(l.quantity_delivery) FILTER (
              WHERE l.quantity_delivery IS NOT NULL
                AND NOT (
                  sm.sto_count > 1
                  AND sm.sum_delivery_raw > sm.quantity_ordered * 1.2
                  AND l.quantity_delivery >= sm.quantity_ordered * 0.95
                )
            ), 0)::numeric AS sum_delivery_adj,
            COALESCE(SUM(l.quantity_receive) FILTER (
              WHERE l.quantity_receive IS NOT NULL
                AND NOT (
                  sm.sto_count > 1
                  AND sm.sum_receive_raw > sm.quantity_ordered * 1.2
                  AND l.quantity_receive >= sm.quantity_ordered * 0.95
                )
            ), 0)::numeric AS sum_receive_adj,
            COALESCE(MAX(l.quantity_delivery), 0)::numeric AS max_delivery,
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
            CASE
              WHEN sto_count > 1 AND sum_delivery_adj > quantity_ordered * 1.2 THEN max_delivery
              ELSE sum_delivery_adj
            END AS quantity_delivery,
            CASE
              WHEN sto_count > 1 AND sum_receive_adj > quantity_ordered * 1.2 THEN max_receive
              ELSE sum_receive_adj
            END AS quantity_receive
          FROM deduped
        )
        SELECT
          COALESCE(sr.contract_number, ns.contract_number) AS contract_number,
          CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_delivery ELSE ns.quantity_delivery END AS quantity_delivery,
          CASE WHEN sr.contract_number IS NOT NULL THEN sr.quantity_receive  ELSE ns.quantity_receive  END AS quantity_receive
        FROM sto_result sr
        FULL OUTER JOIN latest_no_sto ns ON ns.contract_number = sr.contract_number
      )`;
