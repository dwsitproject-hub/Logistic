-- Fix SEA / LAND routing for existing data (Improved version)
-- This script moves data to the correct tables based on SEA / LAND field

BEGIN;

-- Step 1: Move LAND shipments to trucking_operations
-- Find shipments that should be trucking operations (SEA / LAND = LAND)
DO $$
DECLARE
    shipment_rec RECORD;
    new_trucking_id UUID;
    contract_uuid UUID;
    processed_shipments UUID[] := ARRAY[]::UUID[];
BEGIN
    FOR shipment_rec IN 
        SELECT DISTINCT ON (s.id) 
            s.id, s.shipment_id, s.contract_id, s.port_of_loading, s.port_of_discharge,
            s.quantity_shipped, s.vessel_name, s.vessel_owner,
            c.transport_mode,
            spd.data->'contract'->>'sea_land' as sap_sea_land
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN LATERAL (
            SELECT data->'contract'->>'sea_land' as sea_land
            FROM sap_processed_data 
            WHERE contract_number = c.contract_id 
            ORDER BY created_at DESC 
            LIMIT 1
        ) spd ON true
        WHERE (UPPER(TRIM(COALESCE(spd.sea_land, ''))) = 'LAND'
               OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'LAND')
          AND s.id != ALL(processed_shipments)
    LOOP
        -- Skip if already processed
        IF shipment_rec.id = ANY(processed_shipments) THEN
            CONTINUE;
        END IF;
        
        -- Mark as processed
        processed_shipments := array_append(processed_shipments, shipment_rec.id);
        
        -- Get contract UUID
        contract_uuid := shipment_rec.contract_id;
        
        -- Check if trucking operation already exists
        IF NOT EXISTS (
            SELECT 1 FROM trucking_operations t 
            WHERE t.contract_id = contract_uuid 
            AND COALESCE(t.loading_location, '') = COALESCE(shipment_rec.port_of_loading, '')
            AND COALESCE(t.unloading_location, '') = COALESCE(shipment_rec.port_of_discharge, '')
            AND t.shipment_id IS NULL
        ) THEN
            -- Create trucking operation from shipment data
            INSERT INTO trucking_operations (
                contract_id,
                loading_location,
                unloading_location,
                trucking_owner,
                quantity_sent,
                quantity_delivered,
                location_sequence,
                created_at,
                updated_at
            ) VALUES (
                contract_uuid,
                NULLIF(TRIM(COALESCE(shipment_rec.port_of_loading, '')), ''),
                NULLIF(TRIM(COALESCE(shipment_rec.port_of_discharge, '')), ''),
                NULLIF(TRIM(COALESCE(shipment_rec.vessel_owner, '')), ''),
                shipment_rec.quantity_shipped,
                shipment_rec.quantity_shipped, -- Use shipped as delivered if no separate field
                1,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            ) RETURNING id INTO new_trucking_id;
            
            RAISE NOTICE 'Created trucking operation % from shipment % (contract: %)', 
                new_trucking_id, shipment_rec.shipment_id, contract_uuid;
        END IF;
        
        -- Delete the shipment (it should be trucking, not shipment)
        DELETE FROM shipments WHERE id = shipment_rec.id;
        
        RAISE NOTICE 'Deleted shipment % (moved to trucking)', shipment_rec.id;
    END LOOP;
END $$;

-- Step 2: Move SEA trucking_operations to shipments
-- Find trucking operations that should be shipments (SEA / LAND = SEA)
DO $$
DECLARE
    trucking_rec RECORD;
    new_shipment_id UUID;
    contract_uuid UUID;
    shipment_id_val VARCHAR(100);
    processed_trucking UUID[] := ARRAY[]::UUID[];
BEGIN
    FOR trucking_rec IN 
        SELECT DISTINCT ON (t.id)
            t.id, t.contract_id, t.loading_location, t.unloading_location,
            t.quantity_sent, t.quantity_delivered, t.trucking_owner,
            c.transport_mode, c.contract_id as contract_number,
            spd.sea_land
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        LEFT JOIN LATERAL (
            SELECT data->'contract'->>'sea_land' as sea_land
            FROM sap_processed_data 
            WHERE contract_number = c.contract_id 
            ORDER BY created_at DESC 
            LIMIT 1
        ) spd ON true
        WHERE (UPPER(TRIM(COALESCE(spd.sea_land, ''))) = 'SEA'
               OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA')
          AND t.shipment_id IS NULL  -- Only standalone trucking operations
          AND t.id != ALL(processed_trucking)
    LOOP
        -- Skip if already processed
        IF trucking_rec.id = ANY(processed_trucking) THEN
            CONTINUE;
        END IF;
        
        -- Mark as processed
        processed_trucking := array_append(processed_trucking, trucking_rec.id);
        
        -- Get contract UUID
        contract_uuid := trucking_rec.contract_id;
        
        -- Generate unique shipment_id
        SELECT COALESCE(
            (SELECT sto_number FROM contracts WHERE id = contract_uuid AND sto_number IS NOT NULL LIMIT 1),
            (SELECT contract_id FROM contracts WHERE id = contract_uuid LIMIT 1),
            'SHIP-' || SUBSTRING(contract_uuid::text, 1, 8) || '-' || SUBSTRING(trucking_rec.id::text, 1, 8)
        ) INTO shipment_id_val;
        
        -- Check if shipment already exists with this ID
        IF NOT EXISTS (
            SELECT 1 FROM shipments WHERE shipment_id = shipment_id_val
        ) THEN
            -- Create shipment from trucking operation data
            INSERT INTO shipments (
                shipment_id,
                contract_id,
                port_of_loading,
                port_of_discharge,
                vessel_name,
                vessel_owner,
                quantity_shipped,
                status,
                created_at,
                updated_at
            ) VALUES (
                shipment_id_val,
                contract_uuid,
                NULLIF(TRIM(COALESCE(trucking_rec.loading_location, '')), ''),
                NULLIF(TRIM(COALESCE(trucking_rec.unloading_location, '')), ''),
                NULL, -- No vessel name from trucking
                NULLIF(TRIM(COALESCE(trucking_rec.trucking_owner, '')), ''),
                COALESCE(trucking_rec.quantity_sent, trucking_rec.quantity_delivered, 0),
                'PLANNED',
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            ) RETURNING id INTO new_shipment_id;
            
            RAISE NOTICE 'Created shipment % from trucking operation % (contract: %)', 
                new_shipment_id, trucking_rec.id, contract_uuid;
            
            -- Update trucking operations to link to the new shipment
            UPDATE trucking_operations 
            SET shipment_id = new_shipment_id
            WHERE id = trucking_rec.id;
            
            RAISE NOTICE 'Updated trucking operation % to link to shipment %', 
                trucking_rec.id, new_shipment_id;
        ELSE
            -- Shipment already exists, just link the trucking operation to it
            SELECT id INTO new_shipment_id FROM shipments WHERE shipment_id = shipment_id_val LIMIT 1;
            UPDATE trucking_operations 
            SET shipment_id = new_shipment_id
            WHERE id = trucking_rec.id;
            
            RAISE NOTICE 'Linked trucking operation % to existing shipment %', 
                trucking_rec.id, new_shipment_id;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- Summary query
SELECT 
    'After fix - Shipments with LAND' as check_type,
    COUNT(*) as count
FROM shipments s
LEFT JOIN contracts c ON s.contract_id = c.id
LEFT JOIN LATERAL (
    SELECT data->'contract'->>'sea_land' as sea_land
    FROM sap_processed_data 
    WHERE contract_number = c.contract_id 
    ORDER BY created_at DESC 
    LIMIT 1
) spd ON true
WHERE UPPER(TRIM(COALESCE(spd.sea_land, ''))) = 'LAND'
   OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'LAND'

UNION ALL

SELECT 
    'After fix - Trucking with SEA (standalone)' as check_type,
    COUNT(*) as count
FROM trucking_operations t
LEFT JOIN contracts c ON t.contract_id = c.id
LEFT JOIN LATERAL (
    SELECT data->'contract'->>'sea_land' as sea_land
    FROM sap_processed_data 
    WHERE contract_number = c.contract_id 
    ORDER BY created_at DESC 
    LIMIT 1
) spd ON true
WHERE (UPPER(TRIM(COALESCE(spd.sea_land, ''))) = 'SEA'
       OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA')
  AND t.shipment_id IS NULL;

