const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function testActualUpsert() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    console.log('Testing actual upsert for contract:', cn);
    
    // Get one processed row
    const row = await client.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const contractData = data.contract;
      
      console.log('Contract data keys:', Object.keys(contractData));
      console.log('contract_no:', contractData.contract_no);
      console.log('po_no:', contractData.po_no);
      console.log('contract_quantity:', contractData.contract_quantity);
      console.log('due_date_delivery_start:', contractData.due_date_delivery_start);
      console.log('due_date_delivery_end:', contractData.due_date_delivery_end);
      
      // Test parseDate
      console.log('parseDate(due_date_delivery_start):', SapDataDistributionService.parseDate(contractData.due_date_delivery_start));
      console.log('parseDate(due_date_delivery_end):', SapDataDistributionService.parseDate(contractData.due_date_delivery_end));
      
      // Test parseNumber
      console.log('parseNumber(contract_quantity):', SapDataDistributionService.parseNumber(contractData.contract_quantity));
      console.log('parseNumber(unit_price):', SapDataDistributionService.parseNumber(contractData.unit_price));
      
      console.log('Running upsert...');
      try {
        const contractId = await SapDataDistributionService.upsertContract(client, contractData, 'test-user');
        console.log('Upsert returned contract ID:', contractId);
        
        // Check what was actually inserted
        const inserted = await client.query('SELECT id, contract_id, po_number, product, quantity_ordered FROM contracts WHERE id=$1', [contractId]);
        console.log('Inserted contract:', inserted.rows[0]);
        
      } catch (error) {
        console.error('Upsert error:', error.message);
        console.error('Stack:', error.stack);
      }
    }
    
    await client.query('ROLLBACK');
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e);
  } finally {
    client.release();
    pool.end();
  }
}

testActualUpsert();

