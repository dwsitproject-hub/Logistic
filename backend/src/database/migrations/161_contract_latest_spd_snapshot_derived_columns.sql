-- contract_latest_spd_snapshot stored the SAP row as jsonb and every reader pulled the same six
-- derived values back out of it. buildUnplannedContractBacklogLatestSpdCte alone makes 26
-- `data->` accesses per row to produce them, and it feeds 18 query sites across six files.
--
-- Measured with a prototype before writing this migration (the point of prototyping first):
-- storing the six as typed columns took the completed-backlog count from 326,763 buffers to
-- 214,555 (-34.3%) with identical results, and the projection from 52 MB of jsonb to 2,480 kB of
-- columns. Combined with reading the snapshot at all rather than scanning sap_processed_data,
-- that count goes 378,651 -> 214,555 buffers, -43%.
--
-- `data` is deliberately KEPT. Around a hundred other `latest_spd` references pull arbitrary keys
-- from it, so dropping it would mean rewriting all of them. These columns are additive.
--
-- The expressions below are generated from utils/contractLatestSpdDerivedSql.ts, which the
-- snapshot refresh also uses. A stored column and a live expression that disagreed would be a
-- silent data bug, so there is one definition and both sides read it.
--
-- effective_sto passes NULL for the sto_number column the live form reads first: the snapshot does
-- not carry that column, and the column-vs-JSON forms agreed for all 18,711 contracts.

ALTER TABLE contract_latest_spd_snapshot
  ADD COLUMN IF NOT EXISTS effective_sto text,
  ADD COLUMN IF NOT EXISTS b2b_flag_raw text,
  ADD COLUMN IF NOT EXISTS contract_reference_po_raw text,
  ADD COLUMN IF NOT EXISTS contract_ext_no_raw text,
  ADD COLUMN IF NOT EXISTS discharge_destination text,
  ADD COLUMN IF NOT EXISTS source_type_raw text;

-- Backfill in one pass: 18,711 rows, so a plain UPDATE is brief. The refresh keeps them current
-- from here on, including the targeted refreshForContracts path.
UPDATE contract_latest_spd_snapshot AS t
SET
effective_sto = d.effective_sto,
  b2b_flag_raw = d.b2b_flag_raw,
  contract_reference_po_raw = d.contract_reference_po_raw,
  contract_ext_no_raw = d.contract_ext_no_raw,
  discharge_destination = d.discharge_destination,
  source_type_raw = d.source_type_raw
FROM (
  SELECT lss.contract_number,
          NULLIF(TRIM(COALESCE(
            NULL::text,
            lss.data->'raw'->>'STO No.',
            lss.data->'raw'->>'STO Number',
            lss.data->'shipment'->>'sto_no',
            lss.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
          COALESCE(
            lss.data->'contract'->>'contract_type',
            lss.data->>'B2B Flag',
            lss.data->'raw'->>'B2B Flag',
            lss.data->>'Contract Type'
          ) AS b2b_flag_raw,
          COALESCE(
            lss.data->'contract'->>'contract_reference_po',
            lss.data->>'CONTRACT REFF PO',
            lss.data->>'Contract Reff PO Ini',
            lss.data->'raw'->>'Contract Reff PO Ini',
            lss.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po_raw,
          COALESCE(
            lss.data->'raw'->>'Contract Ext No',
            lss.data->>'Contract Ext No'
          ) AS contract_ext_no_raw,
          CASE
      WHEN UPPER(TRIM(NULLIF(TRIM(COALESCE(
    NULLIF(TRIM(lss.data->'shipment'->>'discharge_destination'), ''),
    NULLIF(TRIM(lss.data->'raw'->>'Discharge Destination'), ''),
    NULLIF(TRIM(lss.data->>'discharge_destination'), '')
  )), ''))) = 'KIJING' THEN 'TANJUNG PURA'
      ELSE NULLIF(TRIM(COALESCE(
    NULLIF(TRIM(lss.data->'shipment'->>'discharge_destination'), ''),
    NULLIF(TRIM(lss.data->'raw'->>'Discharge Destination'), ''),
    NULLIF(TRIM(lss.data->>'discharge_destination'), '')
  )), '')
    END AS discharge_destination,
          COALESCE(
    NULLIF(TRIM(lss.data->'contract'->>'source_type'), ''),
    NULLIF(TRIM(lss.data->>'Source'), ''),
    NULLIF(TRIM(lss.data->'raw'->>'Source'), ''),
    NULLIF(TRIM(lss.data->>'Source_Type'), ''),
    NULLIF(TRIM(lss.data->'raw'->>'Source_Type'), '')
  ) AS source_type_raw
  FROM contract_latest_spd_snapshot lss
) d
WHERE d.contract_number = t.contract_number;

-- Readers join on contract_number, already the primary key, so no new index is needed.
