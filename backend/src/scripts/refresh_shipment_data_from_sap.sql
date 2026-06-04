-- Refresh shipment data from SAP import data
-- This script updates existing shipments with new fields from sap_processed_data

-- Create a helper function for safe numeric conversion
CREATE OR REPLACE FUNCTION safe_to_numeric(val TEXT) RETURNS NUMERIC AS $$
BEGIN
  IF val IS NULL OR val = '' OR UPPER(TRIM(val)) IN ('N/A', 'NA', '-', 'NULL', 'NONE', '') THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN REPLACE(val, ',', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$
DECLARE
  rec RECORD;
  shipment_uuid UUID;
  quality_data JSONB;
  location_name TEXT;
  port_seq INTEGER;
  discharge_port_seq INTEGER := 999;
BEGIN
  -- Update shipments with new fields from SAP data
  FOR rec IN 
    SELECT 
      s.id as shipment_id,
      s.shipment_id as shipment_identifier,
      spd.data as sap_data,
      spd.contract_number
    FROM shipments s
    LEFT JOIN sap_processed_data spd ON (
      spd.shipment_id = s.shipment_id 
      OR spd.contract_number = (SELECT contract_id FROM contracts WHERE id = s.contract_id)
    )
    WHERE spd.data IS NOT NULL
    ORDER BY spd.created_at DESC
  LOOP
    shipment_uuid := rec.shipment_id;
    
    -- Helper function to clean numeric strings (remove commas)
    -- Update shipment with new fields
    UPDATE shipments SET
      estimated_km = COALESCE(
        estimated_km,
        safe_to_numeric(rec.sap_data->>'estimated_km'),
        safe_to_numeric(rec.sap_data->'shipment'->>'estimated_km'),
        safe_to_numeric(rec.sap_data->'raw'->>'estimated km'),
        safe_to_numeric(rec.sap_data->'raw'->>'esimated km')
      ),
      estimated_nautical_miles = COALESCE(
        estimated_nautical_miles,
        safe_to_numeric(rec.sap_data->>'estimated_nautical_miles'),
        safe_to_numeric(rec.sap_data->'shipment'->>'estimated_nautical_miles'),
        safe_to_numeric(rec.sap_data->'raw'->>'estimated nm'),
        safe_to_numeric(rec.sap_data->'raw'->>'estimated nautical miles')
      ),
      vessel_oa_budget = COALESCE(
        vessel_oa_budget,
        safe_to_numeric(rec.sap_data->>'vessel_oa_budget'),
        safe_to_numeric(rec.sap_data->'shipment'->>'vessel_oa_budget'),
        safe_to_numeric(rec.sap_data->'raw'->>'vessel oa budget')
      ),
      vessel_oa_actual = COALESCE(
        vessel_oa_actual,
        safe_to_numeric(rec.sap_data->>'vessel_oa_actual'),
        safe_to_numeric(rec.sap_data->'shipment'->>'vessel_oa_actual'),
        safe_to_numeric(rec.sap_data->'raw'->>'vessel oa actual')
      ),
      bl_quantity = COALESCE(
        bl_quantity,
        safe_to_numeric(rec.sap_data->>'bl_quantity'),
        safe_to_numeric(rec.sap_data->'shipment'->>'bl_quantity'),
        safe_to_numeric(rec.sap_data->'raw'->>'b/l quantity')
      ),
      actual_vessel_qty_receive = COALESCE(
        actual_vessel_qty_receive,
        safe_to_numeric(rec.sap_data->>'actual_vessel_qty_receive'),
        safe_to_numeric(rec.sap_data->'shipment'->>'actual_vessel_qty_receive'),
        safe_to_numeric(rec.sap_data->'raw'->>'actual vessel qty receive')
      ),
      average_vessel_speed = COALESCE(
        average_vessel_speed,
        safe_to_numeric(rec.sap_data->>'average_vessel_speed'),
        safe_to_numeric(rec.sap_data->'shipment'->>'average_vessel_speed'),
        safe_to_numeric(rec.sap_data->'raw'->>'average vessel speed')
      ),
      vessel_loa = COALESCE(
        vessel_loa,
        safe_to_numeric(rec.sap_data->>'vessel_loa'),
        safe_to_numeric(rec.sap_data->'shipment'->>'vessel_loa'),
        safe_to_numeric(rec.sap_data->'raw'->>'loa')
      ),
      vessel_registration_year = COALESCE(
        vessel_registration_year,
        NULLIF((rec.sap_data->>'vessel_registration_year')::text, '')::integer,
        NULLIF((rec.sap_data->'shipment'->>'vessel_registration_year')::text, '')::integer,
        NULLIF((rec.sap_data->'raw'->>'vessel registration year')::text, '')::integer
      ),
      port_of_loading = COALESCE(
        port_of_loading,
        rec.sap_data->'shipment'->>'vessel_loading_port_1',
        rec.sap_data->'raw'->>'vessel loading port 1'
      ),
      port_of_discharge = COALESCE(
        port_of_discharge,
        rec.sap_data->'shipment'->>'vessel_discharge_port',
        rec.sap_data->'raw'->>'vessel discharge port'
      ),
      vessel_name = COALESCE(
        vessel_name,
        rec.sap_data->'shipment'->>'vessel_name',
        rec.sap_data->'vessel'->>'vessel_name',
        rec.sap_data->'raw'->>'vessel name'
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = shipment_uuid;
    
    -- Calculate and update difference if we have both values
    UPDATE shipments SET
      difference_final_qty_vs_bl_qty = CASE
        WHEN actual_vessel_qty_receive IS NOT NULL AND bl_quantity IS NOT NULL
        THEN actual_vessel_qty_receive - bl_quantity
        ELSE difference_final_qty_vs_bl_qty
      END
    WHERE id = shipment_uuid
      AND (difference_final_qty_vs_bl_qty IS NULL OR difference_final_qty_vs_bl_qty = 0)
      AND actual_vessel_qty_receive IS NOT NULL
      AND bl_quantity IS NOT NULL;
    
    -- Update vessel loading ports with quality data
    IF rec.sap_data->'quality' IS NOT NULL THEN
      FOR quality_data IN SELECT * FROM jsonb_array_elements(rec.sap_data->'quality')
      LOOP
        location_name := quality_data->>'location';
        
        -- Determine port sequence based on location
        IF location_name LIKE '%Loading Port 1%' OR location_name LIKE '%Loading Loc 1%' THEN
          port_seq := 1;
        ELSIF location_name LIKE '%Loading Port 2%' OR location_name LIKE '%Loading Loc 2%' THEN
          port_seq := 2;
        ELSIF location_name LIKE '%Loading Port 3%' OR location_name LIKE '%Loading Loc 3%' THEN
          port_seq := 3;
        ELSIF location_name LIKE '%Discharge Port%' THEN
          port_seq := discharge_port_seq;
        ELSE
          CONTINUE; -- Skip unknown locations
        END IF;
        
        -- Update existing port if it exists
        UPDATE vessel_loading_ports SET
          quality_ffa = COALESCE(
            quality_ffa,
            safe_to_numeric(quality_data->'data'->>'quality_ffa')
          ),
          quality_mi = COALESCE(
            quality_mi,
            safe_to_numeric(quality_data->'data'->>'quality_mi')
          ),
          quality_dobi = COALESCE(
            quality_dobi,
            safe_to_numeric(quality_data->'data'->>'quality_dobi')
          ),
          quality_red = COALESCE(
            quality_red,
            safe_to_numeric(quality_data->'data'->>'quality_red')
          ),
          quality_ds = COALESCE(
            quality_ds,
            safe_to_numeric(quality_data->'data'->>'quality_ds')
          ),
          quality_stone = COALESCE(
            quality_stone,
            safe_to_numeric(quality_data->'data'->>'quality_stone')
          ),
          is_discharge_port = (port_seq = discharge_port_seq),
          updated_at = CURRENT_TIMESTAMP
        WHERE shipment_id = shipment_uuid
          AND port_sequence = port_seq;
        
        -- Insert new port if update didn't affect any rows
        IF NOT FOUND THEN
          INSERT INTO vessel_loading_ports (
            shipment_id,
            port_name,
            port_sequence,
            quality_ffa,
            quality_mi,
            quality_dobi,
            quality_red,
            quality_ds,
            quality_stone,
            is_discharge_port
          )
          VALUES (
            shipment_uuid,
            COALESCE(location_name, 'Port ' || port_seq::text),
            port_seq,
            safe_to_numeric(quality_data->'data'->>'quality_ffa'),
            safe_to_numeric(quality_data->'data'->>'quality_mi'),
            safe_to_numeric(quality_data->'data'->>'quality_dobi'),
            safe_to_numeric(quality_data->'data'->>'quality_red'),
            safe_to_numeric(quality_data->'data'->>'quality_ds'),
            safe_to_numeric(quality_data->'data'->>'quality_stone'),
            (port_seq = discharge_port_seq)
          );
        END IF;
      END LOOP;
    END IF;
    
  END LOOP;
  
  RAISE NOTICE 'Shipment data refresh completed';
END $$;

-- Summary query
SELECT 
  'Migration Summary' as status,
  (SELECT COUNT(*) FROM shipments WHERE estimated_km IS NOT NULL) as shipments_with_estimated_km,
  (SELECT COUNT(*) FROM shipments WHERE vessel_oa_budget IS NOT NULL) as shipments_with_oa_budget,
  (SELECT COUNT(*) FROM shipments WHERE bl_quantity IS NOT NULL) as shipments_with_bl_quantity,
  (SELECT COUNT(*) FROM shipments WHERE actual_vessel_qty_receive IS NOT NULL) as shipments_with_actual_qty,
  (SELECT COUNT(*) FROM vessel_loading_ports WHERE quality_ffa IS NOT NULL) as ports_with_quality_data;

