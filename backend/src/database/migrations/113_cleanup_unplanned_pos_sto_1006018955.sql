-- Idempotent SIT/local cleanup:
-- POs 1001030005 / 1001030623 already have sto_number 1006018955 and SAP ATA sailed,
-- but lacked shipment rows so they incorrectly appeared in Unplanned backlog.
-- Link them to the existing SAILED shipment group (same operation_id).

DO $$
DECLARE
  template_id uuid;
BEGIN
  SELECT s.id INTO template_id
  FROM shipments s
  INNER JOIN contracts c ON c.id = s.contract_id
  WHERE TRIM(COALESCE(c.sto_number::text, '')) = '1006018955'
    AND COALESCE(s.status, '') <> 'CANCELLED'
  ORDER BY s.created_at ASC NULLS LAST
  LIMIT 1;

  IF template_id IS NULL THEN
    RAISE NOTICE 'STO 1006018955 cleanup skipped: no template SAILED/active shipment found';
    RETURN;
  END IF;

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
    t.shipment_id || '-' || m.contract_id,
    m.contract_uuid,
    t.vessel_name,
    t.port_of_loading,
    t.port_of_discharge,
    NULL::numeric,
    t.status,
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
    t.actual_vessel_qty_receive, t.average_vessel_speed, t.operation_id, '[]'::jsonb,
    t.sfal_qty, t.sfbd_qty, COALESCE(t.is_delayed, false), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (
    SELECT c.id AS contract_uuid, c.contract_id
    FROM contracts c
    WHERE TRIM(c.po_number::text) IN ('1001030623', '1001030005')
      AND TRIM(COALESCE(c.sto_number::text, '')) = '1006018955'
      AND NOT EXISTS (
        SELECT 1 FROM shipments s2 WHERE s2.contract_id = c.id
      )
  ) m
  CROSS JOIN shipments t
  WHERE t.id = template_id
  ON CONFLICT (shipment_id) DO NOTHING;

  RAISE NOTICE 'STO 1006018955 Unplanned PO cleanup applied (template %)', template_id;
END
$$;
