-- 170 — clear loading-port ATAs that were copied from a SIBLING STO's SAP row.
--
-- Companion to 169, which did the same for the discharge port. Same cause: the SAP port lookup
-- once fell back to a PO-wide row, and mergeSapPortValue is fill-gaps-only, so anything written
-- before that lookup was fixed is never corrected by a later import.
--
-- Loading ports need a STRICTER test than 169 used, and that is the reason this is a separate
-- migration rather than an extension of it.
--
-- Several STOs under one PO can legitimately share ONE vessel voyage. Where SAP recorded the
-- loading dates on only one of those STO rows, the others genuinely have no value of their own
-- and the date they display is CORRECT. 169's rule would delete those: on dev it flags 79 rows
-- for ata_loading_completed alone, 16 of which are siblings on the same vessel.
--
-- So a third condition is required: a sibling shipment under the same contract holds the
-- identical date on a DIFFERENT vessel. Two ships cannot finish loading at the same moment, so
-- together with the other two conditions the copy explanation is the only sensible one.
--
-- Conditions, per field:
--   1. loading-port rows only (is_discharge_port = false).
--   2. the value EQUALS its sap_* mirror, so anything a user typed is left alone.
--   3. the shipment's OWN STO has no such value in SAP. "Own STO" is shipments.shipment_id, never
--      contracts.sto_number - one contract row can carry two STOs, and using the contract's value
--      is the exact conflation behind the bug.
--   4. a sibling under the same contract holds that value on a different vessel.
--
-- SAP keys are not what the service's first choice suggests. For loading port 1 it reads
-- ata_loading_*_at_loading_port_1 before falling back to the global key, but three of those
-- per-port keys exist on ZERO of 27,003 rows. The live sources are used below. (Loading ports 2
-- and 3 read ata_loading_completed_at_loading_port_2/3 with NO fallback, so they can never
-- receive a completed-loading date at all. Recorded; not addressed here.)
--
-- Scope, measured read-only first (docs/scripts/diag-vlp-loading-ata-bleed.sh):
--   production — 2 rows per field, ALL in the different-vessel tier, none ambiguous:
--     PO 1001029281 / STO 1006019867 / Merauke      / MT.ANGGRAINI SPIRIT
--     PO 1001030633 / STO 1006019958 / PORT PONDONG / Luminor 6
--   These are the same two shipments migration 169 repaired, which absorbed their siblings'
--   dates wholesale rather than only the ATC.
--   dev — 52 different-vessel, 16 same-vessel (left alone), 11 with no sibling (left alone).
--
-- The sap_* mirror is cleared alongside each value: SAP never said that date for this STO.
-- Idempotent: once cleared the column IS NULL and the row no longer matches.

UPDATE vessel_loading_ports vp
SET ata_vessel_arrival = NULL,
    sap_ata_vessel_arrival = NULL
FROM shipments s
WHERE vp.shipment_id = s.id
  AND COALESCE(vp.is_discharge_port, false) = false
  AND vp.ata_vessel_arrival IS NOT NULL
  AND vp.ata_vessel_arrival::date IS NOT DISTINCT FROM vp.sap_ata_vessel_arrival
  AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
            NULLIF(TRIM(s.shipment_id::text), ''),
            COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
      AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_arrival_at_loading_port_1'), '') IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM shipments sib
    JOIN vessel_loading_ports vsib ON vsib.shipment_id = sib.id
    WHERE sib.contract_id = s.contract_id
      AND sib.id <> s.id
      AND COALESCE(vsib.is_discharge_port, false) = false
      AND vsib.ata_vessel_arrival::date = vp.ata_vessel_arrival::date
      AND NULLIF(TRIM(sib.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
  );

UPDATE vessel_loading_ports vp
SET ata_vessel_berthed = NULL,
    sap_ata_vessel_berthed = NULL
FROM shipments s
WHERE vp.shipment_id = s.id
  AND COALESCE(vp.is_discharge_port, false) = false
  AND vp.ata_vessel_berthed IS NOT NULL
  AND vp.ata_vessel_berthed::date IS NOT DISTINCT FROM vp.sap_ata_vessel_berthed
  AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
            NULLIF(TRIM(s.shipment_id::text), ''),
            COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
      AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_berthed_at_loading_port_1'), '') IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM shipments sib
    JOIN vessel_loading_ports vsib ON vsib.shipment_id = sib.id
    WHERE sib.contract_id = s.contract_id
      AND sib.id <> s.id
      AND COALESCE(vsib.is_discharge_port, false) = false
      AND vsib.ata_vessel_berthed::date = vp.ata_vessel_berthed::date
      AND NULLIF(TRIM(sib.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
  );

UPDATE vessel_loading_ports vp
SET ata_loading_start = NULL,
    sap_ata_loading_start = NULL
FROM shipments s
WHERE vp.shipment_id = s.id
  AND COALESCE(vp.is_discharge_port, false) = false
  AND vp.ata_loading_start IS NOT NULL
  AND vp.ata_loading_start::date IS NOT DISTINCT FROM vp.sap_ata_loading_start
  AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
            NULLIF(TRIM(s.shipment_id::text), ''),
            COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
      AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_start_loading'), '') IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM shipments sib
    JOIN vessel_loading_ports vsib ON vsib.shipment_id = sib.id
    WHERE sib.contract_id = s.contract_id
      AND sib.id <> s.id
      AND COALESCE(vsib.is_discharge_port, false) = false
      AND vsib.ata_loading_start::date = vp.ata_loading_start::date
      AND NULLIF(TRIM(sib.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
  );

UPDATE vessel_loading_ports vp
SET ata_loading_completed = NULL,
    sap_ata_loading_completed = NULL
FROM shipments s
WHERE vp.shipment_id = s.id
  AND COALESCE(vp.is_discharge_port, false) = false
  AND vp.ata_loading_completed IS NOT NULL
  AND vp.ata_loading_completed::date IS NOT DISTINCT FROM vp.sap_ata_loading_completed
  AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
            NULLIF(TRIM(s.shipment_id::text), ''),
            COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
      AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_completed_loading'), '') IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM shipments sib
    JOIN vessel_loading_ports vsib ON vsib.shipment_id = sib.id
    WHERE sib.contract_id = s.contract_id
      AND sib.id <> s.id
      AND COALESCE(vsib.is_discharge_port, false) = false
      AND vsib.ata_loading_completed::date = vp.ata_loading_completed::date
      AND NULLIF(TRIM(sib.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
  );

UPDATE vessel_loading_ports vp
SET ata_vessel_sailed = NULL,
    sap_ata_vessel_sailed = NULL
FROM shipments s
WHERE vp.shipment_id = s.id
  AND COALESCE(vp.is_discharge_port, false) = false
  AND vp.ata_vessel_sailed IS NOT NULL
  AND vp.ata_vessel_sailed::date IS NOT DISTINCT FROM vp.sap_ata_vessel_sailed
  AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
            NULLIF(TRIM(s.shipment_id::text), ''),
            COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~'))
      AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_sailed_from_loading_port'), '') IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM shipments sib
    JOIN vessel_loading_ports vsib ON vsib.shipment_id = sib.id
    WHERE sib.contract_id = s.contract_id
      AND sib.id <> s.id
      AND COALESCE(vsib.is_discharge_port, false) = false
      AND vsib.ata_vessel_sailed::date = vp.ata_vessel_sailed::date
      AND NULLIF(TRIM(sib.vessel_name), '') IS DISTINCT FROM NULLIF(TRIM(s.vessel_name), '')
  );
