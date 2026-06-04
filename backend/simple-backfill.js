const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function simpleBackfill() {
  try {
    const cn = '2313586719';
    console.log('Simple backfill for contract:', cn);
    
    // Get all processed data for this contract
    const processedRows = await pool.query(
      'SELECT * FROM sap_processed_data WHERE contract_number=$1 ORDER BY created_at',
      [cn]
    );
    
    console.log('Found', processedRows.rows.length, 'processed rows');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const row of processedRows.rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        console.log('Processing row:', row.id);
        
        // Parse the data JSON
        const parsedData = row.data;
        
        // Run distribution for this row
        await SapDataDistributionService.distributeData(client, parsedData, row.import_id);
        
        await client.query('COMMIT');
        successCount++;
        console.log('✓ Processed row', row.id);
        
      } catch (error) {
        await client.query('ROLLBACK');
        errorCount++;
        console.error('✗ Failed to process row', row.id, ':', error.message);
      } finally {
        client.release();
      }
    }
    
    console.log('Backfill completed. Success:', successCount, 'Errors:', errorCount);
    
  } catch (error) {
    console.error('Backfill failed:', error);
  } finally {
    pool.end();
  }
}

simpleBackfill();

