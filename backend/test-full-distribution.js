const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function testFullDistribution() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    console.log('Testing full distribution for contract:', cn);
    
    // Get one processed row
    const row = await client.query('SELECT data, import_id FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const importId = row.rows[0].import_id;
      
      console.log('Contract data keys:', Object.keys(data.contract));
      console.log('Has contract data:', SapDataDistributionService.hasContractData(data.contract, data));
      
      console.log('Running full distribution...');
      try {
        const result = await SapDataDistributionService.distributeData(client, data, importId);
        console.log('Distribution result:', result);
      } catch (error) {
        console.error('Distribution failed:', error.message);
        console.error('Stack:', error.stack);
      }
    }
    
    await client.query('ROLLBACK'); // Don't commit, just test
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}

testFullDistribution();

