-- Backfill operation_id for SAP-imported shipment shells where shipment_id is the
-- official numeric STO (10 digits) but operation_id was left NULL (SAP import path).
-- Grouping key for View Table / Add New Shipment becomes the STO number.

CREATE TABLE IF NOT EXISTS cleanup_audit_116 (
  id SERIAL PRIMARY KEY,
  shipment_uuid UUID NOT NULL,
  shipment_business_id TEXT,
  contract_number TEXT,
  po_number TEXT,
  old_operation_id TEXT,
  new_operation_id TEXT,
  action TEXT NOT NULL,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cleanup_audit_116_shipment_uuid_action_key'
  ) THEN
    ALTER TABLE cleanup_audit_116 DROP CONSTRAINT IF EXISTS cleanup_audit_116_shipment_uuid_key;
    ALTER TABLE cleanup_audit_116
      ADD CONSTRAINT cleanup_audit_116_shipment_uuid_action_key UNIQUE (shipment_uuid, action);
  END IF;
END $$;

-- STO 1586004884: duplicate UNPLANNED shell on 1584000923 (shipment_id 1586004917, no vessel).
-- Keep TK.BERLIAN UTAMA row (shipment_id 1586004884).
WITH dup AS (
  SELECT s.id, s.shipment_id, c.contract_id, c.po_number
  FROM shipments s
  INNER JOIN contracts c ON c.id = s.contract_id
  WHERE c.contract_id = '1584000923'
    AND s.id = '653e0059-6e15-405a-ac1d-632e748ff7bc'::uuid
    AND COALESCE(UPPER(TRIM(s.status)), '') <> 'CANCELLED'
    AND EXISTS (
      SELECT 1
      FROM shipments keeper
      WHERE keeper.contract_id = s.contract_id
        AND keeper.id = '316f093f-709c-4478-bb55-7fa81d31e432'::uuid
        AND COALESCE(UPPER(TRIM(keeper.status)), '') <> 'CANCELLED'
    )
),
audited AS (
  INSERT INTO cleanup_audit_116 (
    shipment_uuid,
    shipment_business_id,
    contract_number,
    po_number,
    old_operation_id,
    new_operation_id,
    action
  )
  SELECT id, shipment_id, contract_id, po_number, NULL, NULL, 'delete_duplicate_shell'
  FROM dup
  ON CONFLICT (shipment_uuid, action) DO NOTHING
  RETURNING shipment_uuid
),
del_vlp AS (
  DELETE FROM vessel_loading_ports v WHERE v.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING v.shipment_id
),
del_qs AS (
  DELETE FROM quality_surveys qs WHERE qs.shipment_id IN (SELECT shipment_uuid FROM audited)
  RETURNING qs.shipment_id
)
DELETE FROM shipments s WHERE s.id IN (SELECT shipment_uuid FROM audited);

WITH backfill AS (
  UPDATE shipments s
  SET operation_id = TRIM(s.shipment_id),
      updated_at = CURRENT_TIMESTAMP
  FROM contracts c
  WHERE c.id = s.contract_id
    AND TRIM(COALESCE(s.shipment_id, '')) ~ '^\d{10}$'
    AND TRIM(COALESCE(s.operation_id, '')) = ''
    AND COALESCE(UPPER(TRIM(s.status)), '') <> 'CANCELLED'
  RETURNING
    s.id,
    s.shipment_id,
    c.contract_id AS contract_number,
    c.po_number,
    NULL::text AS old_operation_id,
    TRIM(s.shipment_id) AS new_operation_id,
    'backfill_operation_id'::text AS action
)
INSERT INTO cleanup_audit_116 (
  shipment_uuid,
  shipment_business_id,
  contract_number,
  po_number,
  old_operation_id,
  new_operation_id,
  action
)
SELECT id, shipment_id, contract_number, po_number, old_operation_id, new_operation_id, action
FROM backfill
ON CONFLICT (shipment_uuid, action) DO NOTHING;

-- STO 1586004884: contract 1584000922 (PO 1581000922) has SAP STO but no shipment shell
-- (appears in Unplanned backlog with null operation_id). Link to keeper group.
WITH inserted AS (
  INSERT INTO shipments (
    shipment_id, contract_id, vessel_name, port_of_loading, port_of_discharge,
    quantity_delivered, status, vessel_code, vessel_owner, vessel_draft, vessel_loa,
    vessel_capacity, vessel_hull_type, vessel_registration_year, charter_type,
    eta_arrival, ata_arrival, eta_berthed, ata_berthed,
    eta_loading_start, ata_loading_start, eta_loading_complete, ata_loading_complete,
    eta_sailed, ata_sailed,
    eta_discharge_arrival, ata_discharge_arrival, eta_discharge_berthed, ata_discharge_berthed,
    eta_discharge_start, ata_discharge_start, eta_discharge_complete, ata_discharge_complete,
    estimated_km, estimated_nautical_miles, vessel_oa_budget, vessel_oa_actual,
    actual_vessel_qty_receive, average_vessel_speed, operation_id, daily_deliverables,
    sfal_qty, sfbd_qty, is_delayed, created_at, updated_at
  )
  SELECT
    '1586004884-' || m.contract_id,
    m.contract_uuid,
    t.vessel_name,
    t.port_of_loading,
    t.port_of_discharge,
    NULL::numeric,
    COALESCE(t.status, 'UNPLANNED'),
    t.vessel_code,
    t.vessel_owner,
    t.vessel_draft,
    t.vessel_loa,
    t.vessel_capacity,
    t.vessel_hull_type,
    t.vessel_registration_year,
    t.charter_type,
    t.eta_arrival, t.ata_arrival, t.eta_berthed, t.ata_berthed,
    t.eta_loading_start, t.ata_loading_start, t.eta_loading_complete, t.ata_loading_complete,
    t.eta_sailed, t.ata_sailed,
    t.eta_discharge_arrival, t.ata_discharge_arrival, t.eta_discharge_berthed, t.ata_discharge_berthed,
    t.eta_discharge_start, t.ata_discharge_start, t.eta_discharge_complete, t.ata_discharge_complete,
    t.estimated_km, t.estimated_nautical_miles, t.vessel_oa_budget, t.vessel_oa_actual,
    t.actual_vessel_qty_receive, t.average_vessel_speed,
    '1586004884',
    '[]'::jsonb,
    t.sfal_qty, t.sfbd_qty, COALESCE(t.is_delayed, false), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (
    SELECT c.id AS contract_uuid, c.contract_id
    FROM contracts c
    WHERE c.contract_id = '1584000922'
      AND TRIM(COALESCE(c.sto_number::text, '')) = '1586004884'
      AND NOT EXISTS (
        SELECT 1 FROM shipments s2
        WHERE s2.contract_id = c.id
          AND COALESCE(UPPER(TRIM(s2.status)), '') <> 'CANCELLED'
      )
  ) m
  CROSS JOIN shipments t
  WHERE t.id = '316f093f-709c-4478-bb55-7fa81d31e432'::uuid
  ON CONFLICT (shipment_id) DO NOTHING
  RETURNING id, shipment_id, contract_id, operation_id
)
INSERT INTO cleanup_audit_116 (
  shipment_uuid,
  shipment_business_id,
  contract_number,
  po_number,
  old_operation_id,
  new_operation_id,
  action
)
SELECT
  i.id,
  i.shipment_id,
  c.contract_id,
  c.po_number,
  NULL,
  i.operation_id,
  'link_missing_po_shell'
FROM inserted i
INNER JOIN contracts c ON c.id = i.contract_id
ON CONFLICT (shipment_uuid, action) DO NOTHING;

UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE
WHERE module = 'shipment';
