-- The Shipments hydrate path re-extracts the same handful of SAP fields out of `data` dozens of
-- times per row, and every extraction re-detoasts the whole jsonb blob.
--
-- Where the cost is, measured by rendering the SQL the list actually splices in:
--
--   component                     chars    jsonb accesses    sap_processed_data refs
--   spd_agg_ctes (FULL)          18,904               182                          2
--   sto_metrics                 144,570               885                         24
--   ports_agg                     1,846                 9                          0
--   -------------------------------------------------------------------------------
--   hydrate (skipSapJoin=false) 165,336             1,076                         26
--   shell   (skipSapJoin=true)    1,851                 0                          0
--
-- (940 of those are `data->'section'->>'key'`, 136 are the top-level `data->>'key'` form. The
-- first pass over this SQL matched only the two-level form and so undercounted: sto_metrics is
-- 885, not 768.)
--
-- So `sto_metrics` alone is 82% of it, over only 52 distinct paths - a 17x repeat factor.
--
-- What one such access costs, on this table (27,003 rows, 22 MB heap, 138 MB TOAST), root-node
-- buffers from EXPLAIN (ANALYZE, BUFFERS):
--
--   count(*), no jsonb                     463 buffers        36 ms
--   1 jsonb value per row               85,402 buffers     1,477 ms
--   5 distinct jsonb values per row    407,905 buffers    10,023 ms
--   5 stored columns per row             2,835 buffers        28 ms
--
-- Linear in the number of accesses, about 2s and 81,000 buffers per value per full scan - and a
-- stored column costs the same as touching no jsonb at all: 144x fewer buffers, 358x faster.
-- That is the whole case for this migration.
--
-- WHY ONE COLUMN PER PATH, NOT ONE PER VALUE
--
-- Tempting to collapse each COALESCE family into a single column. That would change results.
-- The GR/delete status logic is `openNorm(A) OR openNorm(B)`, not `openNorm(COALESCE(A, B))`:
-- with A='CLOSE' and B='OPEN' the OR is true while the COALESCE form is false. So each jsonb path
-- gets its own column and the expression trees above them are left exactly as they are. This is
-- an access-path change only - same values, read from a different place.
--
-- The five `STO No.` variants are deliberately absent: sapStoNumberKeyExpr already reads the
-- `sto_number` column first and COALESCE short-circuits, so those arms are rarely evaluated.
--
-- GENERATED ... STORED rather than plain columns plus a backfill: the SAP importer then needs no
-- change and the columns cannot drift from `data`, which is the failure mode that would show up
-- as wrong quantities rather than as an error. Every expression is immutable, as generated
-- columns require. `data` is kept - a hundred other call sites read arbitrary keys from it.
--
-- Cost of applying: one ALTER, so one table rewrite (ACCESS EXCLUSIVE) rather than 23. On the dev
-- copy that is 27,003 rows and 160 MB.

ALTER TABLE sap_processed_data
  -- Quantity Delivery (48 + 48 accesses in sto_metrics)
  ADD COLUMN IF NOT EXISTS raw_quantity_delivery text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Delivery') STORED,
  ADD COLUMN IF NOT EXISTS shipment_quantity_delivery text
    GENERATED ALWAYS AS (data->'shipment'->>'quantity_delivery') STORED,

  -- GR PO / GR STO status (36 each). Two arms OR'd, so two columns - see the note above.
  ADD COLUMN IF NOT EXISTS raw_gr_po_status text
    GENERATED ALWAYS AS (data->'raw'->>'GR PO Status') STORED,
  ADD COLUMN IF NOT EXISTS contract_gr_po_status text
    GENERATED ALWAYS AS (data->'contract'->>'gr_po_status') STORED,
  ADD COLUMN IF NOT EXISTS raw_gr_sto_status text
    GENERATED ALWAYS AS (data->'raw'->>'GR STO Status') STORED,
  ADD COLUMN IF NOT EXISTS contract_gr_sto_status text
    GENERATED ALWAYS AS (data->'contract'->>'gr_sto_status') STORED,

  -- Delete STO status (25 each)
  ADD COLUMN IF NOT EXISTS raw_delete_sto_status text
    GENERATED ALWAYS AS (data->'raw'->>'Delete STO Status') STORED,
  ADD COLUMN IF NOT EXISTS contract_delete_sto_status text
    GENERATED ALWAYS AS (data->'contract'->>'delete_sto_status') STORED,
  ADD COLUMN IF NOT EXISTS shipment_delete_sto_status text
    GENERATED ALWAYS AS (data->'shipment'->>'delete_sto_status') STORED,

  -- Delete PO status (22 each)
  ADD COLUMN IF NOT EXISTS raw_delete_po_status text
    GENERATED ALWAYS AS (data->'raw'->>'Delete PO Status') STORED,
  ADD COLUMN IF NOT EXISTS contract_delete_po_status text
    GENERATED ALWAYS AS (data->'contract'->>'delete_po_status') STORED,
  ADD COLUMN IF NOT EXISTS shipment_delete_po_status text
    GENERATED ALWAYS AS (data->'shipment'->>'delete_po_status') STORED,

  -- Trucking-delivered quantity: five spellings, 24 accesses each
  ADD COLUMN IF NOT EXISTS raw_quantity_delivery_trucking text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Delivery Trucking') STORED,
  ADD COLUMN IF NOT EXISTS raw_quantity_delivered_trucking text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Delivered Trucking') STORED,
  ADD COLUMN IF NOT EXISTS raw_quantity_delivered_via_trucking text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Delivered via Trucking') STORED,
  ADD COLUMN IF NOT EXISTS shipment_quantity_delivery_trucking text
    GENERATED ALWAYS AS (data->'shipment'->>'quantity_delivery_trucking') STORED,
  ADD COLUMN IF NOT EXISTS contract_quantity_delivery_trucking text
    GENERATED ALWAYS AS (data->'contract'->>'quantity_delivery_trucking') STORED,

  -- Vessel-delivered quantity: four spellings, 24 accesses each
  ADD COLUMN IF NOT EXISTS raw_quantity_delivery_vessel text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Delivery Vessel') STORED,
  ADD COLUMN IF NOT EXISTS raw_quantity_delivered text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Delivered') STORED,
  ADD COLUMN IF NOT EXISTS shipment_quantity_delivered text
    GENERATED ALWAYS AS (data->'shipment'->>'quantity_delivered') STORED,
  ADD COLUMN IF NOT EXISTS contract_quantity_delivery text
    GENERATED ALWAYS AS (data->'contract'->>'quantity_delivery') STORED,

  -- Quantity Receive (15 each)
  ADD COLUMN IF NOT EXISTS raw_quantity_receive text
    GENERATED ALWAYS AS (data->'raw'->>'Quantity Receive') STORED,
  ADD COLUMN IF NOT EXISTS raw_qty_receive text
    GENERATED ALWAYS AS (data->'raw'->>'Qty Receive') STORED,

  /*
   * Top-level keys, read as `data->>'key'` with no section in between.
   *
   * These are the third arm of the same COALESCE families above - sqlSapGrPoStatusFromJson reads
   * raw, then contract, then the bare key - and they were missed by the first pass over the SQL,
   * which only matched the two-level form. 111 of the 117 top-level accesses in sto_metrics are
   * these five.
   */
  ADD COLUMN IF NOT EXISTS root_gr_po_status text
    GENERATED ALWAYS AS (data->>'gr_po_status') STORED,
  ADD COLUMN IF NOT EXISTS root_gr_sto_status text
    GENERATED ALWAYS AS (data->>'gr_sto_status') STORED,
  ADD COLUMN IF NOT EXISTS root_delete_po_status text
    GENERATED ALWAYS AS (data->>'delete_po_status') STORED,
  ADD COLUMN IF NOT EXISTS root_delete_sto_status text
    GENERATED ALWAYS AS (data->>'delete_sto_status') STORED,
  ADD COLUMN IF NOT EXISTS root_quantity_delivered_via_trucking text
    GENERATED ALWAYS AS (data->>'quantity_delivered_via_trucking') STORED;

COMMENT ON COLUMN sap_processed_data.raw_gr_po_status IS
  'Stored copy of data->''raw''->>''GR PO Status''. Generated, so it cannot drift from data. Added because the Shipments hydrate path re-extracted this and 22 sibling paths dozens of times per row, each re-detoasting the whole blob (measured: 85,402 buffers per value per full scan, versus 2,835 for five stored columns).';
