const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function testManualDistribution() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    console.log('Manual distribution test for contract:', cn);
    
    // Get one processed row
    const row = await client.query('SELECT data, import_id FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const importId = row.rows[0].import_id;
      
      console.log('Before distribution - checking if contract exists...');
      const beforeContract = await client.query('SELECT id FROM contracts WHERE contract_id=$1', [cn]);
      console.log('Contract exists before:', beforeContract.rows.length > 0);
      
      console.log('Running distribution...');
      const result = await SapDataDistributionService.distributeData(client, data, importId);
      console.log('Distribution result:', result);
      
      console.log('After distribution - checking if contract exists...');
      const afterContract = await client.query('SELECT id FROM contracts WHERE contract_id=$1', [cn]);
      console.log('Contract exists after:', afterContract.rows.length > 0);
      if (afterContract.rows[0]) {
        console.log('Contract ID:', afterContract.rows[0].id);
      }
    }
    
    await client.query('COMMIT');
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e);
  } finally {
    client.release();
    pool.end();
  }
}

testManualDistribution();

