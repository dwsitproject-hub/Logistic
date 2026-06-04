-- Fix SEA / LAND routing for existing data
-- This script moves data to the correct tables based on SEA / LAND field

BEGIN;

-- Step 1: Move LAND shipments to trucking_operations
-- Find shipments that should be trucking operations (SEA / LAND = LAND)
DO $$
DECLARE
    shipment_rec RECORD;
    new_trucking_id UUID;
    contract_uuid UUID;
BEGIN
    FOR shipment_rec IN 
        SELECT s.id, s.shipment_id, s.contract_id, s.port_of_loading, s.port_of_discharge,
               s.quantity_shipped, s.vessel_name, s.vessel_owner,
               c.transport_mode,
               spd.data->'contract'->>'sea_land' as sap_sea_land
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN sap_processed_data spd ON spd.contract_number = c.contract_id
        WHERE (UPPER(TRIM(COALESCE(spd.data->'contract'->>'sea_land', ''))) = 'LAND'
               OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'LAND')
          AND NOT EXISTS (
              -- Don't create duplicate trucking operations
              SELECT 1 FROM trucking_operations t 
              WHERE t.contract_id = s.contract_id 
              AND t.loading_location = COALESCE(s.port_of_loading, '')
              AND t.unloading_location = COALESCE(s.port_of_discharge, '')
          )
    LOOP
        -- Get contract UUID
        contract_uuid := shipment_rec.contract_id;
        
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
            COALESCE(NULLIF(shipment_rec.port_of_loading, ''), NULLIF(shipment_rec.port_of_loading, '0.00'), NULL),
            COALESCE(NULLIF(shipment_rec.port_of_discharge, ''), NULL),
            COALESCE(shipment_rec.vessel_owner, NULL),
            shipment_rec.quantity_shipped,
            shipment_rec.quantity_shipped, -- Use shipped as delivered if no separate field
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        ) RETURNING id INTO new_trucking_id;
        
        RAISE NOTICE 'Created trucking operation % from shipment % (contract: %)', 
            new_trucking_id, shipment_rec.shipment_id, contract_uuid;
        
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
BEGIN
    FOR trucking_rec IN 
        SELECT t.id, t.contract_id, t.loading_location, t.unloading_location,
               t.quantity_sent, t.quantity_delivered, t.trucking_owner,
               c.transport_mode,
               spd.data->'contract'->>'sea_land' as sap_sea_land
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        LEFT JOIN sap_processed_data spd ON spd.contract_number = c.contract_id
        WHERE (UPPER(TRIM(COALESCE(spd.data->'contract'->>'sea_land', ''))) = 'SEA'
               OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA')
          AND t.shipment_id IS NULL  -- Only standalone trucking operations
          AND NOT EXISTS (
              -- Don't create duplicate shipments
              SELECT 1 FROM shipments s 
              WHERE s.contract_id = t.contract_id 
              AND s.port_of_loading = COALESCE(t.loading_location, '')
              AND s.port_of_discharge = COALESCE(t.unloading_location, '')
          )
    LOOP
        -- Get contract UUID
        contract_uuid := trucking_rec.contract_id;
        
        -- Generate shipment_id from contract or use a default
        DECLARE
            shipment_id_val VARCHAR(100);
        BEGIN
            -- Try to get STO number from contract or use contract_id
            SELECT COALESCE(
                (SELECT sto_number FROM contracts WHERE id = contract_uuid LIMIT 1),
                (SELECT contract_id FROM contracts WHERE id = contract_uuid LIMIT 1),
                'SHIP-' || SUBSTRING(contract_uuid::text, 1, 8)
            ) INTO shipment_id_val;
            
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
                COALESCE(NULLIF(trucking_rec.loading_location, ''), NULL),
                COALESCE(NULLIF(trucking_rec.unloading_location, ''), NULL),
                NULL, -- No vessel name from trucking
                COALESCE(trucking_rec.trucking_owner, NULL),
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
        END;
    END LOOP;
END $$;

COMMIT;

-- Summary query
SELECT 
    'After fix - Shipments with LAND' as check_type,
    COUNT(*) as count
FROM shipments s
LEFT JOIN contracts c ON s.contract_id = c.id
LEFT JOIN sap_processed_data spd ON spd.contract_number = c.contract_id
WHERE UPPER(TRIM(COALESCE(spd.data->'contract'->>'sea_land', ''))) = 'LAND'
   OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'LAND'

UNION ALL

SELECT 
    'After fix - Trucking with SEA (standalone)' as check_type,
    COUNT(*) as count
FROM trucking_operations t
LEFT JOIN contracts c ON t.contract_id = c.id
LEFT JOIN sap_processed_data spd ON spd.contract_number = c.contract_id
WHERE (UPPER(TRIM(COALESCE(spd.data->'contract'->>'sea_land', ''))) = 'SEA'
       OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA')
  AND t.shipment_id IS NULL;

