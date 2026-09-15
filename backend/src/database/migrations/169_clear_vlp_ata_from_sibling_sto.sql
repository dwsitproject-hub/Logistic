-- 169 — clear discharge-port ATAs that were copied from a SIBLING STO's SAP row.
--
-- Symptom: a shipment showed an ATC that SAP leaves NULL. Reported for STO 1006019867
-- (PO 1001029907), which displayed 2026-08-13 — the date belonging to its sibling STO 1006019385.
--
-- Why it appears. The ATC a user sees is
--   COALESCE(shipments.ata_discharge_complete, vlpd.ata_loading_completed)
-- (sqlKlipStoredAtaCompleteDischarge). For this shipment the stored column is NULL and the manual
-- override is NULL too, so the discharge-port row supplies the value — and that row held the
-- sibling's date.
--
-- How it got there, and why no import ever repaired it. The SAP port lookup in
-- vesselLoadingPortsFromSap.service.ts used to fall back to a PO-wide row, so one shipment could
-- be written with another STO's dates. That lookup has since been fixed — sto_match_rank now
-- prefers a direct STO hit — but mergeSapPortValue is fill-gaps-only:
--     if (hasCurrent) return current;
-- so a value written before the fix is never overwritten afterwards. Dev is clean; production
-- still carries the legacy rows. This migration removes them so the corrected lookup can answer.
--
-- Three conditions, each load-bearing:
--
--   1. discharge-port rows with an ATA set — that is what feeds the ATC.
--
--   2. ata_loading_completed EQUALS sap_ata_loading_completed. The mirror column records what SAP
--      supplied, so equality means the value came from SAP rather than from a person. Anything a
--      user typed differs and is left untouched (15 such rows in production, 27 on dev).
--
--   3. the shipment's OWN STO has no such value in SAP, so the date cannot have come from there.
--      "Own STO" is shipments.shipment_id, never contracts.sto_number: one contract row can carry
--      two STOs, and using the contract's value is the exact conflation that caused the bug.
--      Including it in this test hid every case and reported zero candidates.
--
-- The SAP field is data->'shipment'->>'ata_vessel_completed_discharge'. The service reads
-- 'ata_discharging_completed_at_discharge_port' first, but that key exists on none of the 27,003
-- rows, so it is dead and deliberately not tested here.
--
-- Scope, measured read-only before writing this (docs/scripts/diag-vlp-ata-bleed.sh):
--   production — 219 discharge rows with an ATA, 204 SAP-sourced, 15 user-typed, 2 to clear:
--     PO 1001029281 / STO 1006019867 / PORT BONTANG / 2026-08-13   <- the reported row
--     PO 1001030633 / STO 1006019958 / PORT BONTANG / 2026-08-21
--   dev — 5 rows, none of them this case (the symptom does not exist on dev).
--
-- The sap_* mirror is cleared alongside the value: SAP never said that date for this STO, so
-- keeping it would leave the same wrong number behind under another name.
--
-- Idempotent: once cleared, ata_loading_completed IS NULL and the row no longer matches.
-- Loading-port rows (sequences 1-3) read different SAP keys and may carry the same legacy
-- problem; they are deliberately NOT touched here so this change can be verified on its own.

UPDATE vessel_loading_ports vp
SET ata_loading_completed = NULL,
    sap_ata_loading_completed = NULL
FROM shipments s
WHERE vp.shipment_id = s.id
  AND COALESCE(vp.is_discharge_port, false) = true
  AND vp.ata_loading_completed IS NOT NULL
  AND vp.ata_loading_completed::date IS NOT DISTINCT FROM vp.sap_ata_loading_completed
  AND NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.sto_number::text, '')) IN (
            NULLIF(TRIM(s.shipment_id::text), ''),
            COALESCE(NULLIF(TRIM(s.operation_id::text), ''), '~')
          )
      AND NULLIF(TRIM(spd.data->'shipment'->>'ata_vessel_completed_discharge'), '') IS NOT NULL
  );
