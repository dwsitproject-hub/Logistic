const pool = require('./dist/database/connection').default;

async function debugDistribution() {
  try {
    const cn = '2313586719';
    const row = await pool.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      console.log('Contract data:', JSON.stringify(data.contract, null, 2));
      console.log('Shipment data:', JSON.stringify(data.shipment, null, 2));
      console.log('Trucking data:', JSON.stringify(data.trucking, null, 2));
      
      // Check if contract has required fields
      const contract = data.contract;
      console.log('Contract has contract_no:', !!contract?.contract_no);
      console.log('Contract has po_no:', !!contract?.po_no);
      console.log('Contract has product:', !!contract?.product);
      console.log('Contract has quantity_ordered:', !!contract?.quantity_ordered);
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

debugDistribution();

