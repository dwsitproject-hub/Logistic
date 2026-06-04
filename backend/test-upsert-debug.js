const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function testUpsertDebug() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    console.log('Testing upsert debug for contract:', cn);
    
    // Get one processed row
    const row = await client.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      
      console.log('Before upsert - checking if contract exists...');
      const beforeContract = await client.query('SELECT id FROM contracts WHERE contract_id=$1', [cn]);
      console.log('Contract exists before:', beforeContract.rows.length > 0);
      
      console.log('Running upsert...');
      const contractId = await SapDataDistributionService.upsertContract(client, data.contract, 'test-user');
      console.log('Upsert returned contract ID:', contractId);
      
      console.log('After upsert - checking if contract exists...');
      const afterContract = await client.query('SELECT id FROM contracts WHERE contract_id=$1', [cn]);
      console.log('Contract exists after:', afterContract.rows.length > 0);
      if (afterContract.rows[0]) {
        console.log('Contract ID from query:', afterContract.rows[0].id);
      }
      
      console.log('Checking by returned ID...');
      const byId = await client.query('SELECT id, contract_id FROM contracts WHERE id=$1', [contractId]);
      console.log('Contract by ID:', byId.rows);
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

testUpsertDebug();

