const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function backfillContract() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    console.log('Backfilling contract:', cn);
    
    // Get all processed data for this contract
    const processedRows = await client.query(
      'SELECT * FROM sap_processed_data WHERE contract_number=$1 ORDER BY created_at',
      [cn]
    );
    
    console.log('Found', processedRows.rows.length, 'processed rows');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const row of processedRows.rows) {
      try {
        console.log('Processing row:', row.id);
        
        // Parse the data JSON
        const parsedData = row.data;
        console.log('Parsed data keys:', Object.keys(parsedData));
        
        // Run distribution for this row
        await SapDataDistributionService.distributeData(client, parsedData, row.import_id);
        successCount++;
        console.log('✓ Processed row', row.id);
        
      } catch (error) {
        errorCount++;
        console.error('✗ Failed to process row', row.id, ':', error.message);
      }
    }
    
    await client.query('COMMIT');
    console.log('Backfill completed. Success:', successCount, 'Errors:', errorCount);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Backfill failed:', error);
  } finally {
    client.release();
    pool.end();
  }
}

backfillContract();

