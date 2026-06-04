const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function testUpsert() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    console.log('Testing upsert for contract:', cn);
    
    // Get one processed row
    const row = await client.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      console.log('Contract data keys:', Object.keys(data.contract));
      console.log('Contract number:', data.contract.contract_no);
      console.log('PO number:', data.contract.po_no);
      console.log('Product:', data.contract.product);
      console.log('Contract quantity:', data.contract.contract_quantity);
      
      // Test the hasContractData method
      const hasContract = SapDataDistributionService.hasContractData(data.contract, data);
      console.log('Has contract data:', hasContract);
      
      if (hasContract) {
        console.log('Attempting to upsert contract...');
        try {
          const contractId = await SapDataDistributionService.upsertContract(client, data.contract, 'test-user');
          console.log('Contract upserted with ID:', contractId);
        } catch (error) {
          console.error('Upsert failed:', error.message);
          console.error('Stack:', error.stack);
        }
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

testUpsert();

