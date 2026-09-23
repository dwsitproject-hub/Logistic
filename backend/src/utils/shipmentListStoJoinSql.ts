/**
 * The shipments-list STO join block, shared by the list service and the controller.
 *
 * WHY THE JOINS DO NOT WRAP sto_key IN TRIM()
 *
 * These used to read `ON TRIM(sm.sto_key::text) = TRIM(sp.sto_key::text)`, seven times in
 * one statement. Applying a function to BOTH sides of a join means Postgres cannot use
 * column statistics or any index, and must evaluate TRIM twice per candidate pair - the
 * pattern an external DB review flagged as a top cause of CPU saturation on the shared
 * staging host (2026-07-27: seven such joins exceeded the 120s statement_timeout).
 *
 * The TRIM calls were provably redundant, for two independent reasons:
 *
 * 1. sto_key is already trimmed at the source. Every branch of shipmentListStoKeyExpr()
 *    is NULLIF(TRIM(...), ''); the only unwrapped fallback is `s.id::text`, a UUID, which
 *    cannot contain whitespace. TRIM of an already-trimmed value is the identity function.
 *
 * 2. Both sides are the SAME value, not two independently-derived ones. Every CTE here
 *    propagates shipment_page.sto_key unchanged - spd_keyed does `SELECT sp.sto_key`, and
 *    the aggregates carry it through as sk.sto_key / q.sto_key. Nothing re-derives it, so
 *    there is no opportunity for the two sides to differ in whitespace.
 *
 * The `::text` casts are kept: they are no-ops on a text column that Postgres elides, and
 * they preserve type safety across the stub variants of these CTEs (which declare
 * `NULL::text AS sto_key`).
 *
 * Verified: full list output byte-identical before and after, across pages 1 and 2,
 * limit 25 and 50, and exact-STO / exact-PO searches.
 */
export const SHIPMENT_LIST_STO_JOIN_SQL = `
      FROM shipment_page sp
      LEFT JOIN sto_metrics sm ON sm.sto_key::text = sp.sto_key::text
      LEFT JOIN sap_agg sa ON sa.sto_key::text = sp.sto_key::text
      LEFT JOIN sap_latest sl ON sl.sto_key::text = sp.sto_key::text
      LEFT JOIN sap_loading_ports_agg slpa ON slpa.sto_key::text = sp.sto_key::text
      LEFT JOIN sap_discharge_ports_agg sdpa ON sdpa.sto_key::text = sp.sto_key::text
      LEFT JOIN contract_ext_agg cex ON cex.sto_key::text = sp.sto_key::text
      LEFT JOIN po_numbers_agg pna ON pna.sto_key::text = sp.sto_key::text`;

/**
 * The Jetty Planning System instruction for this STO, if KLIP has submitted one.
 *
 * Keyed on sto_key because that is the grain JPS is submitted at - one instruction per STO, not
 * per shipment row. `state = 'SUBMITTED'` excludes the go-live seed and the held rows, which are
 * KLIP bookkeeping and mean nothing to a user looking at the list.
 *
 * DISTINCT ON keeps the newest revision: a rejected instruction is replaced rather than amended,
 * so an STO can accumulate several rows and only the latest describes where it stands now.
 */
export const SHIPMENT_LIST_JPS_JOIN_SQL = `
      LEFT JOIN LATERAL (
        SELECT j.jps_status, j.jetty_name, j.planned_berthing_time, j.rejection_reason,
               j.submitted_at, j.last_polled_at
        FROM jps_shipping_instructions j
        WHERE j.sto_key = sp.sto_key::text
          AND j.state = 'SUBMITTED'
        ORDER BY j.revision DESC
        LIMIT 1
      ) jps ON TRUE`;

/** Columns the shipments list and its shell both project for the Jetty columns. */
export const SHIPMENT_LIST_JPS_SELECT_SQL = `
        jps.jps_status AS jetty_status,
        jps.jetty_name AS jetty_name,
        jps.planned_berthing_time AS jetty_planned_berthing_time,
        jps.rejection_reason AS jetty_rejection_reason,
        jps.submitted_at AS jetty_submitted_at,
        jps.last_polled_at AS jetty_last_synced_at`;
