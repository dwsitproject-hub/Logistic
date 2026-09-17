-- Contract-details-for-STO (the contract_candidates query observed running 4x
-- concurrently at ~56s each during the staging DB CPU saturation): its SAP branch
-- matches rows with an OR of two STO forms —
--   TRIM(COALESCE(sto_number::text, '')) = $sto  OR  <5-key effective-STO form> = $sto
-- Migration 108 indexed the 5-key form; the short form had no matching index, so the
-- OR forced a sequential scan of sap_processed_data per request. This index enables a
-- BitmapOr of both disjuncts. Access-path only; endpoint output verified identical.
CREATE INDEX IF NOT EXISTS idx_spd_sto_number_trim
  ON sap_processed_data (TRIM(COALESCE(sto_number::text, '')));

ANALYZE sap_processed_data;
