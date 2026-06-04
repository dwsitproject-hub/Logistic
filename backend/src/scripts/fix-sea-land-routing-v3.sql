-- Fix SEA / LAND routing for existing data (Final version)
-- This script moves data to the correct tables based on SEA / LAND field

BEGIN;

-- Step 1: Move LAND shipments to trucking_operations
DO $$
DECLARE
    shipment_rec RECORD;
    new_trucking_id UUID;
    contract_uuid UUID;
BEGIN
    FOR shipment_rec IN 
        SELECT DISTINCT s.id, s.shipment_id, s.contract_id, s.port_of_loading, s.port_of_discharge,
               s.quantity_shipped, s.vessel_name, s.vessel_owner,
               c.transport_mode,
               (SELECT data->'contract'->>'sea_land' 
                FROM sap_processed_data 
                WHERE contract_number = c.contract_id 
                ORDER BY created_at DESC 
                LIMIT 1) as sap_sea_land
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE (UPPER(TRIM(COALESCE((SELECT data->'contract'->>'sea_land' 
                                    FROM sap_processed_data 
                                    WHERE contract_number = c.contract_id 
                                    ORDER BY created_at DESC 
                                    LIMIT 1), ''))) = 'LAND'
               OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'LAND')
          AND NOT EXISTS (
              SELECT 1 FROM trucking_operations t 
              WHERE t.contract_id = s.contract_id 
              AND COALESCE(t.loading_location, '') = COALESCE(s.port_of_loading, '')
              AND COALESCE(t.unloading_location, '') = COALESCE(s.port_of_discharge, '')
              AND t.shipment_id IS NULL
          )
    LOOP
        contract_uuid := shipment_rec.contract_id;
        
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
            shipment_rec.quantity_shipped,
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        ) RETURNING id INTO new_trucking_id;
        
        DELETE FROM shipments WHERE id = shipment_rec.id;
    END LOOP;
END $$;

-- Step 2: Move SEA trucking_operations to shipments
DO $$
DECLARE
    trucking_rec RECORD;
    new_shipment_id UUID;
    contract_uuid UUID;
    shipment_id_val VARCHAR(100);
    existing_shipment_id UUID;
BEGIN
    FOR trucking_rec IN 
        SELECT DISTINCT t.id, t.contract_id, t.loading_location, t.unloading_location,
               t.quantity_sent, t.quantity_delivered, t.trucking_owner,
               c.transport_mode, c.contract_id as contract_number,
               (SELECT data->'contract'->>'sea_land' 
                FROM sap_processed_data 
                WHERE contract_number = c.contract_id 
                ORDER BY created_at DESC 
                LIMIT 1) as sap_sea_land
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE (UPPER(TRIM(COALESCE((SELECT data->'contract'->>'sea_land' 
                                    FROM sap_processed_data 
                                    WHERE contract_number = c.contract_id 
                                    ORDER BY created_at DESC 
                                    LIMIT 1), ''))) = 'SEA'
               OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA')
          AND t.shipment_id IS NULL
    LOOP
        contract_uuid := trucking_rec.contract_id;
        
        -- Generate unique shipment_id
        SELECT COALESCE(
            (SELECT sto_number FROM contracts WHERE id = contract_uuid AND sto_number IS NOT NULL AND sto_number != '' LIMIT 1),
            (SELECT contract_id FROM contracts WHERE id = contract_uuid LIMIT 1),
            'SHIP-' || SUBSTRING(contract_uuid::text, 1, 8) || '-' || SUBSTRING(trucking_rec.id::text, 1, 8)
        ) INTO shipment_id_val;
        
        -- Check if shipment already exists
        SELECT id INTO existing_shipment_id 
        FROM shipments 
        WHERE shipment_id = shipment_id_val 
        LIMIT 1;
        
        IF existing_shipment_id IS NULL THEN
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
                NULL,
                NULLIF(TRIM(COALESCE(trucking_rec.trucking_owner, '')), ''),
                COALESCE(trucking_rec.quantity_sent, trucking_rec.quantity_delivered, 0),
                'PLANNED',
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            ) RETURNING id INTO new_shipment_id;
            
            UPDATE trucking_operations 
            SET shipment_id = new_shipment_id
            WHERE id = trucking_rec.id;
        ELSE
            UPDATE trucking_operations 
            SET shipment_id = existing_shipment_id
            WHERE id = trucking_rec.id;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- Summary
SELECT 
    'After fix - Shipments with LAND' as check_type,
    COUNT(*) as count
FROM shipments s
LEFT JOIN contracts c ON s.contract_id = c.id
WHERE UPPER(TRIM(COALESCE((SELECT data->'contract'->>'sea_land' 
                           FROM sap_processed_data 
                           WHERE contract_number = c.contract_id 
                           ORDER BY created_at DESC 
                           LIMIT 1), ''))) = 'LAND'
   OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'LAND'

UNION ALL

SELECT 
    'After fix - Trucking with SEA (standalone)' as check_type,
    COUNT(*) as count
FROM trucking_operations t
LEFT JOIN contracts c ON t.contract_id = c.id
WHERE (UPPER(TRIM(COALESCE((SELECT data->'contract'->>'sea_land' 
                            FROM sap_processed_data 
                            WHERE contract_number = c.contract_id 
                            ORDER BY created_at DESC 
                            LIMIT 1), ''))) = 'SEA'
       OR UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA')
  AND t.shipment_id IS NULL;

