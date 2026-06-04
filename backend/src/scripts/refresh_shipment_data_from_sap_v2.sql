-- Enhanced refresh script to populate new shipment fields from latest SAP import data
-- This handles the actual field names found in the SAP data

-- Create helper function to safely parse dates in various formats (M/D/YY, M/D/YYYY, YYYY-MM-DD)
CREATE OR REPLACE FUNCTION safe_to_date(date_str TEXT)
RETURNS DATE AS $$
BEGIN
  IF date_str IS NULL OR TRIM(date_str) = '' THEN
    RETURN NULL;
  END IF;
  
  -- Try to parse as DATE (handles YYYY-MM-DD, ISO formats)
  BEGIN
    RETURN date_str::DATE;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  -- Try to parse M/D/YY or M/D/YYYY format
  BEGIN
    -- Handle M/D/YY format (e.g., "2/17/25" -> "2025-02-17")
    IF date_str ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN
      DECLARE
        parts TEXT[];
        month_val INT;
        day_val INT;
        year_val INT;
      BEGIN
        parts := string_to_array(date_str, '/');
        month_val := parts[1]::INT;
        day_val := parts[2]::INT;
        year_val := parts[3]::INT;
        -- Assume 2-digit years 00-50 are 2000-2050, 51-99 are 1951-1999
        IF year_val <= 50 THEN
          year_val := 2000 + year_val;
        ELSE
          year_val := 1900 + year_val;
        END IF;
        RETURN make_date(year_val, month_val, day_val);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    
    -- Handle M/D/YYYY format (e.g., "2/17/2025")
    IF date_str ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN
      BEGIN
        RETURN TO_DATE(date_str, 'MM/DD/YYYY');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update shipments with new fields from SAP data (handling exact field names)
-- First, create a temporary function to extract B/L Quantity
DO $$
DECLARE
  rec RECORD;
  bl_qty NUMERIC;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (s.id)
      s.id as shipment_id,
      spd.data
    FROM shipments s
    LEFT JOIN contracts c ON s.contract_id = c.id
    LEFT JOIN sap_processed_data spd ON (
      spd.shipment_id = s.shipment_id 
      OR spd.contract_number = c.contract_id
    )
    WHERE spd.data IS NOT NULL
      AND s.bl_quantity IS NULL
    ORDER BY s.id, spd.created_at DESC
  LOOP
    -- Extract B/L Quantity using pattern matching
    -- Trim JSON quotes and convert to numeric
    SELECT safe_to_numeric(TRIM(BOTH '"' FROM value::text)) INTO bl_qty
    FROM jsonb_each(rec.data->'raw')
    WHERE key LIKE '%B/L Quantity%'
      AND value IS NOT NULL
      AND jsonb_typeof(value) = 'string'
    LIMIT 1;
    
    IF bl_qty IS NOT NULL THEN
      UPDATE shipments SET bl_quantity = bl_qty WHERE id = rec.shipment_id;
    END IF;
  END LOOP;
END $$;

-- Now update all other fields
UPDATE shipments s
SET
  estimated_km = COALESCE(
    s.estimated_km,
    safe_to_numeric(spd.data->'raw'->>'Estimated KM'),
    safe_to_numeric(spd.data->'raw'->>'estimated km'),
    safe_to_numeric(spd.data->'raw'->>'esimated km'),
    safe_to_numeric(spd.data->'shipment'->>'estimated_km')
  ),
  estimated_nautical_miles = COALESCE(
    s.estimated_nautical_miles,
    safe_to_numeric(spd.data->'raw'->>'Estimated NM'),
    safe_to_numeric(spd.data->'raw'->>'estimated nm'),
    safe_to_numeric(spd.data->'raw'->>'estimated nautical miles'),
    safe_to_numeric(spd.data->'shipment'->>'estimated_nautical_miles')
  ),
  vessel_oa_budget = COALESCE(
    s.vessel_oa_budget,
    safe_to_numeric(spd.data->'raw'->>'Vessell OA Budget'),
    safe_to_numeric(spd.data->'raw'->>'Vessel OA Budget'),
    safe_to_numeric(spd.data->'raw'->>'vessel oa budget'),
    safe_to_numeric(spd.data->'shipment'->>'vessel_oa_budget')
  ),
  vessel_oa_actual = COALESCE(
    s.vessel_oa_actual,
    safe_to_numeric(spd.data->'raw'->>'Vessel OA Actual'),
    safe_to_numeric(spd.data->'raw'->>'vessel oa actual'),
    safe_to_numeric(spd.data->'shipment'->>'vessel_oa_actual')
  ),
  actual_vessel_qty_receive = COALESCE(
    s.actual_vessel_qty_receive,
    safe_to_numeric(spd.data->'raw'->>'Actual Vessel Qty Receive'),
    safe_to_numeric(spd.data->'raw'->>'actual vessel qty receive'),
    safe_to_numeric(spd.data->'raw'->>'QTY RECEIVE'),
    safe_to_numeric(spd.data->'raw'->>'Actual Quantity\r (at Final Location)'),
    safe_to_numeric(spd.data->'shipment'->>'actual_vessel_qty_receive')
  ),
  quantity_delivered = COALESCE(
    s.quantity_delivered,
    s.actual_vessel_qty_receive,
    safe_to_numeric(spd.data->'raw'->>'Actual Vessel Qty Receive'),
    safe_to_numeric(spd.data->'raw'->>'actual vessel qty receive'),
    safe_to_numeric(spd.data->'raw'->>'QTY RECEIVE'),
    safe_to_numeric(spd.data->'raw'->>'Actual Quantity\r (at Final Location)'),
    safe_to_numeric(spd.data->'raw'->>'Quantity Delivery'),
    safe_to_numeric(spd.data->'raw'->>'quantity delivery'),
    safe_to_numeric(spd.data->'shipment'->>'quantity_delivered')
  ),
  -- ATA dates from Loading Port 1 (using safe_to_date to handle M/D/YY format)
  ata_arrival = COALESCE(
    s.ata_arrival,
    safe_to_date(spd.data->'raw'->>'ATA Vessel Arrival at Loading Port 1'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Arrival at Loading Port'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_arrival_at_loading_port_1')
  ),
  ata_berthed = COALESCE(
    s.ata_berthed,
    safe_to_date(spd.data->'raw'->>'ATA Vessel Berthed at Loading Port 1'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Berthed at Loading Port'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_berthed_at_loading_port_1')
  ),
  ata_loading_start = COALESCE(
    s.ata_loading_start,
    safe_to_date(spd.data->'raw'->>'ATA Loading Start at Loading Port 1'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Start Loading'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_start_loading')
  ),
  ata_loading_complete = COALESCE(
    s.ata_loading_complete,
    safe_to_date(spd.data->'raw'->>'ATA Loading Completed at Loading Port 1'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Completed Loading'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_completed_loading')
  ),
  ata_sailed = COALESCE(
    s.ata_sailed,
    safe_to_date(spd.data->'raw'->>'ATA Vessel Sailed at Loading Port 1'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Sailed from Loading Port'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_sailed_from_loading_port')
  ),
  -- ATA dates from Discharge Port
  ata_discharge_arrival = COALESCE(
    s.ata_discharge_arrival,
    safe_to_date(spd.data->'raw'->>'ATA Vessel Arrival at Discharge Port'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Arrive at Discharge Port'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_arrival_at_discharge_port')
  ),
  ata_discharge_berthed = COALESCE(
    s.ata_discharge_berthed,
    safe_to_date(spd.data->'raw'->>'ATA Vessel Berthed at Discharge Port'),
    safe_to_date(spd.data->'shipment'->>'ata_vessel_berthed_at_discharge_port')
  ),
  ata_discharge_start = COALESCE(
    s.ata_discharge_start,
    safe_to_date(spd.data->'raw'->>'ATA Discharging Start at Discharge Port'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Start Discharging'),
    safe_to_date(spd.data->'shipment'->>'ata_discharging_start_at_discharge_port')
  ),
  ata_discharge_complete = COALESCE(
    s.ata_discharge_complete,
    safe_to_date(spd.data->'raw'->>'ATA Discharging Completed at Discharge Port'),
    safe_to_date(spd.data->'raw'->>'ATA Vessel Complete Discharge'),
    safe_to_date(spd.data->'shipment'->>'ata_discharging_completed_at_discharge_port')
  ),
  average_vessel_speed = COALESCE(
    s.average_vessel_speed,
    safe_to_numeric(spd.data->'raw'->>'Average Vessel Speed'),
    safe_to_numeric(spd.data->'raw'->>'average vessel speed'),
    safe_to_numeric(spd.data->'shipment'->>'average_vessel_speed')
  ),
  vessel_loa = COALESCE(
    s.vessel_loa,
    safe_to_numeric(spd.data->'raw'->>'Vessel LOA'),
    safe_to_numeric(spd.data->'raw'->>'loa'),
    safe_to_numeric(spd.data->'shipment'->>'vessel_loa')
  ),
  vessel_capacity = COALESCE(
    s.vessel_capacity,
    safe_to_numeric(spd.data->'raw'->>'Vessel Cappacity'),
    safe_to_numeric(spd.data->'raw'->>'Vessel Capacity'),
    safe_to_numeric(spd.data->'raw'->>'vessel capacity'),
    safe_to_numeric(spd.data->'shipment'->>'vessel_capacity')
  ),
  vessel_registration_year = COALESCE(
    s.vessel_registration_year,
    NULLIF(REPLACE(REPLACE(spd.data->'raw'->>'Vessel Registration on Year', E'\r', ''), ',', ''), '')::integer,
    NULLIF(REPLACE(REPLACE(spd.data->'raw'->>'vessel registration year', E'\r', ''), ',', ''), '')::integer,
    NULLIF(REPLACE(REPLACE(spd.data->'shipment'->>'vessel_registration_year', E'\r', ''), ',', ''), '')::integer
  ),
  port_of_loading = COALESCE(
    s.port_of_loading,
    REPLACE(spd.data->'raw'->>'Vessel Loading Port 1', E'\r', ''),
    spd.data->'shipment'->>'vessel_loading_port_1',
    spd.data->'raw'->>'vessel loading port 1'
  ),
  port_of_discharge = COALESCE(
    s.port_of_discharge,
    REPLACE(spd.data->'raw'->>'Vessel Discharge Port', E'\r', ''),
    spd.data->'shipment'->>'vessel_discharge_port',
    spd.data->'raw'->>'vessel discharge port'
  ),
  vessel_name = COALESCE(
    s.vessel_name,
    REPLACE(spd.data->'raw'->>'Vessel Name', E'\r', ''),
    spd.data->'shipment'->>'vessel_name',
    spd.data->'vessel'->>'vessel_name',
    spd.data->'raw'->>'vessel name'
  ),
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (s.id)
    s.id as shipment_id,
    spd.data
  FROM shipments s
  LEFT JOIN contracts c ON s.contract_id = c.id
  LEFT JOIN sap_processed_data spd ON (
    spd.shipment_id = s.shipment_id 
    OR spd.contract_number = c.contract_id
  )
  WHERE spd.data IS NOT NULL
  ORDER BY s.id, spd.created_at DESC
) spd
WHERE s.id = spd.shipment_id;

-- Calculate difference if we have both values
UPDATE shipments
SET
  difference_final_qty_vs_bl_qty = CASE
    WHEN actual_vessel_qty_receive IS NOT NULL AND bl_quantity IS NOT NULL
    THEN actual_vessel_qty_receive - bl_quantity
    ELSE difference_final_qty_vs_bl_qty
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE (difference_final_qty_vs_bl_qty IS NULL OR difference_final_qty_vs_bl_qty = 0)
  AND actual_vessel_qty_receive IS NOT NULL
  AND bl_quantity IS NOT NULL;

-- Update vessel loading ports with quality data
DO $$
DECLARE
  rec RECORD;
  shipment_uuid UUID;
  port_seq INTEGER;
  quality_ffa_val NUMERIC;
  quality_mi_val NUMERIC;
  quality_dobi_val NUMERIC;
  quality_red_val NUMERIC;
  quality_ds_val NUMERIC;
  quality_stone_val NUMERIC;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (s.id, port_location)
      s.id as shipment_id,
      s.shipment_id as shipment_identifier,
      spd.data,
      CASE
        WHEN spd.data->'raw'->>'Quality at Loading Loc 1 FFA' IS NOT NULL THEN 'Loading Port 1'
        WHEN spd.data->'raw'->>'Quality at Loading Loc 2 FFA' IS NOT NULL THEN 'Loading Port 2'
        WHEN spd.data->'raw'->>'Quality at Loading Loc 3 FFA' IS NOT NULL THEN 'Loading Port 3'
        WHEN spd.data->'raw'->>'Quality at Discharge Port FFA' IS NOT NULL THEN 'Discharge Port'
        ELSE NULL
      END as port_location
    FROM shipments s
    LEFT JOIN contracts c ON s.contract_id = c.id
    LEFT JOIN sap_processed_data spd ON (
      spd.shipment_id = s.shipment_id 
      OR spd.contract_number = c.contract_id
    )
    WHERE spd.data IS NOT NULL
      AND (
        spd.data->'raw'->>'Quality at Loading Loc 1 FFA' IS NOT NULL
        OR spd.data->'raw'->>'Quality at Loading Loc 2 FFA' IS NOT NULL
        OR spd.data->'raw'->>'Quality at Loading Loc 3 FFA' IS NOT NULL
        OR spd.data->'raw'->>'Quality at Discharge Port FFA' IS NOT NULL
      )
    ORDER BY s.id, port_location, spd.created_at DESC
  LOOP
    shipment_uuid := rec.shipment_id;
    
    -- Determine port sequence
    IF rec.port_location = 'Loading Port 1' THEN
      port_seq := 1;
    ELSIF rec.port_location = 'Loading Port 2' THEN
      port_seq := 2;
    ELSIF rec.port_location = 'Loading Port 3' THEN
      port_seq := 3;
    ELSIF rec.port_location = 'Discharge Port' THEN
      port_seq := 999;
    ELSE
      CONTINUE;
    END IF;
    
    -- Extract quality values based on port location
    IF rec.port_location = 'Loading Port 1' THEN
      quality_ffa_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 1 FFA', E'\r', ''));
      quality_mi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 1 M&I', E'\r', ''));
      quality_dobi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 1 DOBI', E'\r', ''));
      quality_red_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 1 RED', E'\r', ''));
      quality_ds_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 1 D&S', E'\r', ''));
      quality_stone_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 1 Stone', E'\r', ''));
    ELSIF rec.port_location = 'Loading Port 2' THEN
      quality_ffa_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 2 FFA', E'\r', ''));
      quality_mi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 2 M&I', E'\r', ''));
      quality_dobi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 2 DOBI', E'\r', ''));
      quality_red_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 2 RED', E'\r', ''));
      quality_ds_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 2 D&S', E'\r', ''));
      quality_stone_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 2 Stone', E'\r', ''));
    ELSIF rec.port_location = 'Loading Port 3' THEN
      quality_ffa_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 3 FFA', E'\r', ''));
      quality_mi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 3 M&I', E'\r', ''));
      quality_dobi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 3 DOBI', E'\r', ''));
      quality_red_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 3 RED', E'\r', ''));
      quality_ds_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 3 D&S', E'\r', ''));
      quality_stone_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Loading Loc 3 Stone', E'\r', ''));
    ELSIF rec.port_location = 'Discharge Port' THEN
      quality_ffa_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Discharge Port FFA', E'\r', ''));
      quality_mi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Discharge Port M&I', E'\r', ''));
      quality_dobi_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Discharge Port DOBI', E'\r', ''));
      quality_red_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Discharge Port RED', E'\r', ''));
      quality_ds_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Discharge Port D&S', E'\r', ''));
      quality_stone_val := safe_to_numeric(REPLACE(rec.data->'raw'->>'Quality at Discharge Port Stone', E'\r', ''));
    END IF;
    
    -- Update existing port or insert new one
    UPDATE vessel_loading_ports SET
      quality_ffa = COALESCE(quality_ffa, quality_ffa_val),
      quality_mi = COALESCE(quality_mi, quality_mi_val),
      quality_dobi = COALESCE(quality_dobi, quality_dobi_val),
      quality_red = COALESCE(quality_red, quality_red_val),
      quality_ds = COALESCE(quality_ds, quality_ds_val),
      quality_stone = COALESCE(quality_stone, quality_stone_val),
      is_discharge_port = (port_seq = 999),
      updated_at = CURRENT_TIMESTAMP
    WHERE shipment_id = shipment_uuid
      AND port_sequence = port_seq;
    
    -- Insert if no existing port found
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
        rec.port_location,
        port_seq,
        quality_ffa_val,
        quality_mi_val,
        quality_dobi_val,
        quality_red_val,
        quality_ds_val,
        quality_stone_val,
        (port_seq = 999)
      );
    END IF;
  END LOOP;
END $$;

-- Summary query
SELECT 
  'Enhanced Refresh Summary' as status,
  (SELECT COUNT(*) FROM shipments WHERE estimated_km IS NOT NULL) as shipments_with_estimated_km,
  (SELECT COUNT(*) FROM shipments WHERE estimated_nautical_miles IS NOT NULL) as shipments_with_estimated_nm,
  (SELECT COUNT(*) FROM shipments WHERE vessel_oa_budget IS NOT NULL) as shipments_with_oa_budget,
  (SELECT COUNT(*) FROM shipments WHERE vessel_oa_actual IS NOT NULL) as shipments_with_oa_actual,
  (SELECT COUNT(*) FROM shipments WHERE bl_quantity IS NOT NULL) as shipments_with_bl_quantity,
  (SELECT COUNT(*) FROM shipments WHERE actual_vessel_qty_receive IS NOT NULL) as shipments_with_actual_qty,
  (SELECT COUNT(*) FROM shipments WHERE difference_final_qty_vs_bl_qty IS NOT NULL) as shipments_with_difference,
  (SELECT COUNT(*) FROM shipments WHERE average_vessel_speed IS NOT NULL) as shipments_with_avg_speed,
  (SELECT COUNT(*) FROM vessel_loading_ports WHERE quality_ffa IS NOT NULL OR quality_mi IS NOT NULL) as ports_with_quality_data;

