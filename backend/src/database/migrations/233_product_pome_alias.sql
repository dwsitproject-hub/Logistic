-- Product alias: `WASTE OIL (POME)` and the bracket-cut `WASTE OIL (POME` become `POME` (the canonical name
-- is the requester's decision; see utils/productAlias.ts).
-- Requested 2026-10-12, as a stop-gap until the DHM integration supplies clean master data.
--
-- SAP changed PO 1601000176 from `WASTE OIL (POME)` to `POME` on 2026-10-09, so one product sat under two
-- names: a drilldown that matches the product exactly split the volume, and the Oil Loss POME option matches
-- exactly too. The code now normalises where a product enters KLIP (utils/productAlias.ts: SAP import parse,
-- contract upsert, manual contract create), so this migration is only about the values ALREADY stored.
--
-- Direct UPDATEs on tables with one row per entity, where the new value cannot collide with a key - the same
-- approach migration 158 took for the KIJING alias, and for the same reason: it writes exactly what a rebuild
-- would compute, so nothing has to be marked stale and no page falls back to its slow live query.
--
-- Deliberately NOT touched:
--   * *_pipeline_daily_summary / shipment_pipeline_vessel_stage_daily - product is part of their primary key, so
--     an in-place UPDATE could collide with an existing POME row for the same day. They are rebuilt from
--     contracts.product by the next SAP import refresh, which now reads the canonical value.
--   * pre_planned_groups - a group is partitioned by product; the nightly rebuild regroups it.
--   * sap_raw_data and the raw SAP keys inside sap_processed_data.data -> 'raw': what SAP actually sent stays as is.
--   * claim Mutu tables - their product comes from the uploaded workbooks, a separate source.
--
-- Idempotent: the WHERE clauses only match the non-canonical spellings.

UPDATE contracts
   SET product = 'POME'
 WHERE UPPER(TRIM(COALESCE(product, ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');

UPDATE sap_processed_data
   SET product = 'POME'
 WHERE UPPER(TRIM(COALESCE(product, ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');

-- The parsed copy the importer kept in the JSON (data -> contract -> product). Rows without a contract object
-- or without a product key are skipped by the WHERE, so jsonb_set never creates one.
UPDATE sap_processed_data
   SET data = jsonb_set(data, '{contract,product}', to_jsonb('POME'::text))
 WHERE jsonb_typeof(data -> 'contract') = 'object'
   AND UPPER(TRIM(COALESCE(data -> 'contract' ->> 'product', ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');

UPDATE contract_performance_snapshot
   SET product = 'POME'
 WHERE UPPER(TRIM(COALESCE(product, ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');

UPDATE shipment_list_stage_snapshot
   SET product = 'POME'
 WHERE UPPER(TRIM(COALESCE(product, ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');

UPDATE trucking_list_stage_snapshot
   SET product = 'POME'
 WHERE UPPER(TRIM(COALESCE(product, ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');

UPDATE oil_loss_snapshot
   SET product = 'POME'
 WHERE UPPER(TRIM(COALESCE(product, ''))) IN ('WASTE OIL (POME)', 'WASTE OIL (POME');
