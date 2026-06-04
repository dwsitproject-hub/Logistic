/**
 * Script to backfill port_of_loading in shipments table from sap_processed_data
 * This ensures all shipments have port_of_loading populated from "Vessel Loading Port 1" in SAP data
 */

import { query } from '../database/connection'
import logger from '../utils/logger'

async function backfillPortOfLoading() {
  try {
    logger.info('Starting port_of_loading backfill from sap_processed_data...')
    
    // Update shipments where port_of_loading is missing or invalid
    // Match by:
    // 1. shipment_id = sto_number in sap_processed_data
    // 2. contract.sto_number = sto_number in sap_processed_data
    // Update shipments where port_of_loading is missing or invalid
    // Match by shipment_id = sto_number (as text) or by contract.sto_number = sto_number
    const result = await query(`
      UPDATE shipments s
      SET port_of_loading = COALESCE(
        -- Try to get from sap_processed_data by shipment_id = sto_number (cast to text for comparison)
        (SELECT spd.data->'shipment'->>'vessel_loading_port_1'
         FROM sap_processed_data spd
         WHERE spd.sto_number::text = s.shipment_id
           AND spd.data->'shipment'->>'vessel_loading_port_1' IS NOT NULL
           AND spd.data->'shipment'->>'vessel_loading_port_1' != ''
           AND spd.data->'shipment'->>'vessel_loading_port_1' != '0.00'
           AND LENGTH(TRIM(spd.data->'shipment'->>'vessel_loading_port_1')) > 0
         ORDER BY spd.created_at DESC
         LIMIT 1),
        -- Fallback: get from sap_processed_data by contract.sto_number
        (SELECT spd.data->'shipment'->>'vessel_loading_port_1'
         FROM sap_processed_data spd
         INNER JOIN contracts c ON c.sto_number::text = spd.sto_number::text
         WHERE c.id = s.contract_id
           AND spd.data->'shipment'->>'vessel_loading_port_1' IS NOT NULL
           AND spd.data->'shipment'->>'vessel_loading_port_1' != ''
           AND spd.data->'shipment'->>'vessel_loading_port_1' != '0.00'
           AND LENGTH(TRIM(spd.data->'shipment'->>'vessel_loading_port_1')) > 0
         ORDER BY spd.created_at DESC
         LIMIT 1)
      ),
      updated_at = CURRENT_TIMESTAMP
      WHERE (s.port_of_loading IS NULL 
         OR s.port_of_loading = '' 
         OR s.port_of_loading = '0.00')
        AND (
          -- Only update if we can find a valid value from sap_processed_data
          EXISTS (
            SELECT 1 FROM sap_processed_data spd
            WHERE (spd.sto_number::text = s.shipment_id
              OR EXISTS (SELECT 1 FROM contracts c WHERE c.id = s.contract_id AND c.sto_number::text = spd.sto_number::text))
              AND spd.data->'shipment'->>'vessel_loading_port_1' IS NOT NULL
              AND spd.data->'shipment'->>'vessel_loading_port_1' != ''
              AND spd.data->'shipment'->>'vessel_loading_port_1' != '0.00'
              AND LENGTH(TRIM(spd.data->'shipment'->>'vessel_loading_port_1')) > 0
          )
        )
    `)
    
    logger.info(`Port of loading backfill completed. Updated ${result.rowCount || 0} shipments.`)
    
    return {
      success: true,
      updated: result.rowCount || 0
    }
  } catch (error) {
    logger.error('Error backfilling port_of_loading:', error)
    throw error
  }
}

// Run if called directly
if (require.main === module) {
  backfillPortOfLoading()
    .then(result => {
      console.log('Backfill completed:', result)
      process.exit(0)
    })
    .catch(error => {
      console.error('Backfill failed:', error)
      process.exit(1)
    })
}

export default backfillPortOfLoading

