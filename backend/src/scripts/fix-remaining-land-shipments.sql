-- Fix remaining LAND shipments (prioritize SAP import data)
BEGIN;

DO $$
DECLARE
    s_rec RECORD;
    new_trucking_id UUID;
BEGIN
    FOR s_rec IN 
        SELECT s.id, s.shipment_id, s.contract_id, s.port_of_loading, s.port_of_discharge,
               s.quantity_shipped, s.vessel_owner,
               (SELECT data->'contract'->>'sea_land' 
                FROM sap_processed_data 
                WHERE contract_number = c.contract_id 
                ORDER BY created_at DESC 
                LIMIT 1) as sap_sea_land
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE UPPER(TRIM(COALESCE((SELECT data->'contract'->>'sea_land' 
                                   FROM sap_processed_data 
                                   WHERE contract_number = c.contract_id 
                                   ORDER BY created_at DESC 
                                   LIMIT 1), ''))) = 'LAND'
          AND NOT EXISTS (
              SELECT 1 FROM trucking_operations t 
              WHERE t.contract_id = s.contract_id 
              AND COALESCE(t.loading_location, '') = COALESCE(s.port_of_loading, '')
              AND COALESCE(t.unloading_location, '') = COALESCE(s.port_of_discharge, '')
              AND t.shipment_id IS NULL
          )
    LOOP
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
            s_rec.contract_id,
            NULLIF(TRIM(COALESCE(s_rec.port_of_loading, '')), ''),
            NULLIF(TRIM(COALESCE(s_rec.port_of_discharge, '')), ''),
            NULLIF(TRIM(COALESCE(s_rec.vessel_owner, '')), ''),
            s_rec.quantity_shipped,
            s_rec.quantity_shipped,
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        ) RETURNING id INTO new_trucking_id;
        
        DELETE FROM shipments WHERE id = s_rec.id;
    END LOOP;
END $$;

COMMIT;

-- Final summary
SELECT 
    'Final - Shipments with LAND' as check_type,
    COUNT(*) as count
FROM shipments s
LEFT JOIN contracts c ON s.contract_id = c.id
WHERE UPPER(TRIM(COALESCE((SELECT data->'contract'->>'sea_land' 
                           FROM sap_processed_data 
                           WHERE contract_number = c.contract_id 
                           ORDER BY created_at DESC 
                           LIMIT 1), ''))) = 'LAND'

UNION ALL

SELECT 
    'Final - Trucking with SEA (standalone)' as check_type,
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

