-- Trucking page / PO-primary identity: list, summary, and hydrate queries match SAP
-- rows by TRIM(COALESCE(po_number::text, '')) in per-row correlated subqueries. With no
-- matching expression index each evaluation seq-scanned all of sap_processed_data
-- (~9k rows x ~5k trucking rows = 13.8s of a 17.5s request; the staging DB CPU
-- saturation flagged by Cloud Agent Monitoring on 2026-07-21). Index changes the
-- access path only — trucking list output verified byte-identical before/after.
CREATE INDEX IF NOT EXISTS idx_spd_po_number_trim
  ON sap_processed_data (TRIM(COALESCE(po_number::text, '')));

ANALYZE sap_processed_data;
