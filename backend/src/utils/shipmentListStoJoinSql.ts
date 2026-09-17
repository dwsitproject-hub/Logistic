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
