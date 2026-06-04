const pool = require('./dist/database/connection').default;

async function debugHasContractData() {
  try {
    const cn = '2313586719';
    const row = await pool.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const contractData = data.contract;
      
      console.log('Contract data:', contractData);
      console.log('Contract number:', contractData.contract_no);
      console.log('PO number:', contractData.po_no);
      console.log('Has contract_no:', !!contractData.contract_no);
      console.log('Has po_no:', !!contractData.po_no);
      console.log('contract_no || po_no:', contractData.contract_no || contractData.po_no);
      console.log('Boolean result:', !!(contractData.contract_no || contractData.po_no));
      
      // Test the actual method
      const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');
      const result = SapDataDistributionService.hasContractData(contractData, data);
      console.log('hasContractData result:', result);
      console.log('Type of result:', typeof result);
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

debugHasContractData();

