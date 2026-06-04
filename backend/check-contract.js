const pool = require('./dist/database/connection').default;

async function checkContract() {
  try {
    const cn = '2313586719';
    const sp = await pool.query('SELECT id,import_id,contract_number,shipment_id,po_number,sto_number FROM sap_processed_data WHERE contract_number=$1', [cn]);
    console.log('processed data count:', sp.rows.length);
    if (sp.rows[0]) {
      console.log('first row:', sp.rows[0]);
      
      // Check if contract exists
      const contract = await pool.query('SELECT id,contract_id FROM contracts WHERE contract_id=$1', [cn]);
      console.log('contract exists:', contract.rows.length > 0);
      
      if (contract.rows[0]) {
        const shipments = await pool.query('SELECT id,shipment_id FROM shipments WHERE contract_id=$1', [contract.rows[0].id]);
        console.log('shipments count:', shipments.rows.length);
        
        const trucking = await pool.query('SELECT id,shipment_id FROM trucking_operations WHERE contract_id=$1', [contract.rows[0].id]);
        console.log('trucking count:', trucking.rows.length);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkContract();

