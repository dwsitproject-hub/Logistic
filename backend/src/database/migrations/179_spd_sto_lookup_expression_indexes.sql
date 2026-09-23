-- Shipment edit/view modal: the three expression indexes its STO lookups actually need.
--
-- Asked by Ryan on 2026-09-22 - can the edit modal be faster? Measured through the endpoint it
-- calls, /shipments/:id/edit-payload, against a copy of production (26,379 sap_processed_data
-- rows). Two thirds of the shipments sampled took 4,150-5,053 ms to open; the rest 248-547 ms. The
-- split was not random: every slow one ran a lookup keyed on an expression no index matched, and
-- fell back to a sequential scan that detoasted the jsonb `data` column on every row.
--
-- Three expressions were unindexed, and each is used as an equality in a hot predicate:
--
-- 1. sapStoNumberKeyExpr - six branches. `idx_spd_effective_sto` (migration 108) has FIVE, missing
--    `data->'raw'->>'STO No'`, and `idx_spd_effective_sto_trim` (migration 130) has all six but
--    wraps them in an extra outer TRIM. Neither matches, so neither could be used. Measured on the
--    ship/SAP-rows query: Seq Scan, 123,954 shared buffer hits, 6,420 ms -> 3.9 ms indexed.
--
-- 2. The operation-id key inside sqlStoLookupKeyMatchExpr, which fires whenever the lookup key is a
--    manual planning id (OP- / MNL- / MSEA-). Two sequential scans per call inside
--    contract_candidates, 1,885 ms and 1,434 ms, both returning ZERO rows.
--
-- 3. TRIM(COALESCE(sto_number::text, '')) - the first branch of the same predicate. The existing
--    index on the bare column cannot serve it, because the expression is not the column.
--
-- ACCESS PATH ONLY. An index changes which plan the planner picks, never which rows match. Verified
-- the way migrations 101, 107, 108 and 130 were: the endpoint's `contractDetails` payload captured
-- for 12 shipments before and after is byte-identical, 12/12.
--
-- Measured effect on the modal, same 12 shipments: median 4,264 ms -> 248 ms, worst 5,053 -> 537,
-- mean 2,875 -> 246. The bimodal split is gone.
--
-- Build cost on the production copy: 651 ms, 4 ms and 691 ms. These are small tables by index
-- standards; no CONCURRENTLY needed, and the migration runner's transaction is fine.

-- 1. The six-branch STO key (sapStoNumberKeyExpr), exactly as the queries spell it.
CREATE INDEX IF NOT EXISTS idx_spd_sto_key_full
  ON sap_processed_data (
    (NULLIF(TRIM(COALESCE(
      sto_number::text,
      data->'raw'->>'STO No.',
      data->'raw'->>'STO Number',
      data->'raw'->>'STO No',
      data->'shipment'->>'sto_no',
      data->'contract'->>'sto_no'
    )), ''))
  );

-- 2. The operation-id key (sqlStoLookupKeyMatchExpr's third branch). `data->'trucking'->0` is an
--    array element lookup and is immutable, so it is indexable like the rest.
CREATE INDEX IF NOT EXISTS idx_spd_operation_id_key
  ON sap_processed_data (
    (NULLIF(TRIM(COALESCE(
      data->'raw'->>'Operation ID',
      data->'shipment'->>'operation_id',
      data->'trucking'->0->'data'->>'operation_id',
      ''
    )), ''))
  );

-- 3. The trimmed sto_number column, as that predicate's first branch writes it.
CREATE INDEX IF NOT EXISTS idx_spd_sto_number_trim
  ON sap_processed_data ((TRIM(COALESCE(sto_number::text, ''))));
