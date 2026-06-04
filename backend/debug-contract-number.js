const pool = require('./dist/database/connection').default;

async function debugContractNumber() {
  try {
    const cn = '2313586719';
    const row = await pool.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const contractData = data.contract;
      
      console.log('Contract data:', contractData);
      console.log('contract_no:', contractData.contract_no);
      console.log('po_no:', contractData.po_no);
      
      const contractNumber = contractData.contract_no;
      const poNumber = contractData.po_no;
      
      console.log('contractNumber:', contractNumber);
      console.log('poNumber:', poNumber);
      console.log('contractNumber || `PO-${poNumber}`:', contractNumber || `PO-${poNumber}`);
      
      // Test the parseNumber function
      const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');
      const parsedQuantity = SapDataDistributionService.parseNumber(contractData.contract_quantity);
      console.log('Parsed quantity:', parsedQuantity);
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

debugContractNumber();

