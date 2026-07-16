-- Idempotent cleanup: orphan UNPLANNED shipment shells that duplicate a contract
-- which already has another non-cancelled shipment with registered ETA (shipment or port).
--
-- Symptom: Unplanned table still shows a row; Add New Shipment fails with
--   "STO Number … already has shipment planning".
-- Cause: earlier create/plot bugs left an empty UNPLANNED shipment beside a planned sibling.
--
-- Safe predicate:
--   - orphan status UNPLANNED (or blank)
--   - no shipment-level ETA
--   - no port-level ETA/ATA on vessel_loading_ports
--   - same contract already has another active shipment with ETA (shipment or port)
--
-- Audit: SELECT * FROM cleanup_audit_115 ORDER BY deleted_at DESC;

CREATE TABLE IF NOT EXISTS cleanup_audit_115 (
  id SERIAL PRIMARY KEY,
  shipment_uuid UUID NOT NULL UNIQUE,
  shipment_business_id TEXT,
  contract_uuid UUID,
  contract_number TEXT,
  po_number TEXT,
  sto_number TEXT,
  status TEXT,
  created_at TIMESTAMP,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH orphan_candidates AS (
  SELECT
    orphan.id,
    orphan.shipment_id,
    orphan.contract_id,
    orphan.status,
    orphan.created_at,
    c.contract_id AS contract_number,
    c.po_number,
    c.sto_number
  FROM shipments orphan
  INNER JOIN contracts c ON c.id = orphan.contract_id
  WHERE COALESCE(UPPER(TRIM(orphan.status)), '') <> 'CANCELLED'
    AND COALESCE(UPPER(TRIM(orphan.status)), 'UNPLANNED') IN ('UNPLANNED', '')
    AND orphan.eta_arrival IS NULL
    AND orphan.eta_berthed IS NULL
    AND orphan.eta_loading_start IS NULL
    AND orphan.eta_loading_complete IS NULL
    AND orphan.eta_sailed IS NULL
    AND orphan.eta_discharge_arrival IS NULL
    AND orphan.eta_discharge_berthed IS NULL
    AND orphan.eta_discharge_start IS NULL
    AND orphan.eta_discharge_complete IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM vessel_loading_ports v
      WHERE v.shipment_id = orphan.id
        AND (
          v.eta_vessel_arrival IS NOT NULL
          OR v.eta_vessel_berthed IS NOT NULL
          OR v.eta_loading_start IS NOT NULL
          OR v.eta_loading_completed IS NOT NULL
          OR v.eta_vessel_sailed IS NOT NULL
          OR v.eta_vessel_complete_discharge IS NOT NULL
          OR v.ata_vessel_arrival IS NOT NULL
          OR v.ata_vessel_berthed IS NOT NULL
          OR v.ata_loading_start IS NOT NULL
          OR v.ata_loading_completed IS NOT NULL
          OR v.ata_vessel_sailed IS NOT NULL
        )
    )
    AND EXISTS (
      SELECT 1
      FROM shipments planned
      WHERE planned.contract_id = orphan.contract_id
        AND planned.id <> orphan.id
        AND COALESCE(UPPER(TRIM(planned.status)), '') <> 'CANCELLED'
        AND (
          planned.eta_arrival IS NOT NULL
          OR planned.eta_berthed IS NOT NULL
          OR planned.eta_loading_start IS NOT NULL
          OR planned.eta_loading_complete IS NOT NULL
          OR planned.eta_sailed IS NOT NULL
          OR planned.eta_discharge_arrival IS NOT NULL
          OR planned.eta_discharge_berthed IS NOT NULL
          OR planned.eta_discharge_start IS NOT NULL
          OR planned.eta_discharge_complete IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM vessel_loading_ports v2
            WHERE v2.shipment_id = planned.id
              AND (
                v2.eta_vessel_arrival IS NOT NULL
                OR v2.eta_vessel_berthed IS NOT NULL
                OR v2.eta_loading_start IS NOT NULL
                OR v2.eta_loading_completed IS NOT NULL
                OR v2.eta_vessel_sailed IS NOT NULL
                OR v2.eta_vessel_complete_discharge IS NOT NULL
              )
          )
        )
    )
),
audited AS (
  INSERT INTO cleanup_audit_115 (
    shipment_uuid,
    shipment_business_id,
    contract_uuid,
    contract_number,
    po_number,
    sto_number,
    status,
    created_at
  )
  SELECT
    id,
    shipment_id,
    contract_id,
    contract_number,
    po_number,
    sto_number,
    status,
    created_at
  FROM orphan_candidates
  ON CONFLICT DO NOTHING
  RETURNING shipment_uuid
),
del_vlp AS (
  DELETE FROM vessel_loading_ports v
  WHERE v.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING v.shipment_id
),
del_lp AS (
  DELETE FROM loading_ports lp
  WHERE lp.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING lp.shipment_id
),
del_qs AS (
  DELETE FROM quality_surveys qs
  WHERE qs.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING qs.shipment_id
),
del_surveyors AS (
  DELETE FROM surveyors sv
  WHERE sv.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING sv.shipment_id
),
del_ata AS (
  DELETE FROM shipment_ata_overrides ao
  WHERE ao.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING ao.shipment_id
),
del_docs AS (
  DELETE FROM documents d
  WHERE d.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING d.shipment_id
),
-- Detach trucking links (do not delete trucking ops — only clear FK)
upd_truck AS (
  UPDATE trucking_operations t
  SET shipment_id = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE t.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING t.id
)
DELETE FROM shipments s
WHERE s.id IN (SELECT shipment_uuid FROM audited);

-- Raw cleanup bypasses app invalidateShipmentsListCache — mark daily snapshot stale
-- so Unplanned card does not keep serving pre-delete totals until next cron refresh.
UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE
WHERE module = 'shipment';
