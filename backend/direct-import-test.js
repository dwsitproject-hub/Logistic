const { SapMasterV2ImportService } = require('./dist/services/sapMasterV2Import.service');
const path = require('path');

async function directImportTest() {
  try {
    console.log('=== DIRECT IMPORT TEST ===');
    
    const filePath = path.join(process.cwd(), '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    console.log('Testing import with file:', filePath);
    
    // Simulate the import process
    const result = await SapMasterV2ImportService.importMasterV2(filePath, 'test-user');
    
    console.log('Import result:', result);
    
    // Check the database for the latest import
    const { pool } = require('./dist/database/connection');
    
    // Get latest import
    const importResult = await pool.query('SELECT id FROM sap_data_imports ORDER BY import_timestamp DESC LIMIT 1');
    if (importResult.rows.length === 0) {
      console.log('No imports found');
      return;
    }
    
    const latestImportId = importResult.rows[0].id;
    console.log('Latest import ID:', latestImportId);
    
    // Get processed data
    const processedResult = await pool.query(
      'SELECT contract_number, shipment_id, po_number, sto_number, supplier_name, product, vessel_name FROM sap_processed_data WHERE import_id = $1 LIMIT 5',
      [latestImportId]
    );
    
    console.log('Processed data records:');
    processedResult.rows.forEach((row, index) => {
      console.log(`Record ${index + 1}:`);
      console.log(`  Contract/PO: ${row.contract_number || 'NULL'}`);
      console.log(`  Shipment/STO: ${row.shipment_id || 'NULL'}`);
      console.log(`  PO Number: ${row.po_number || 'NULL'}`);
      console.log(`  STO Number: ${row.sto_number || 'NULL'}`);
      console.log(`  Supplier: ${row.supplier_name || 'NULL'}`);
      console.log(`  Product: ${row.product || 'NULL'}`);
      console.log(`  Vessel: ${row.vessel_name || 'NULL'}`);
      console.log('');
    });
    
    // Check if any data is populated
    const hasData = processedResult.rows.some(row => 
      row.contract_number || row.shipment_id || row.po_number || 
      row.sto_number || row.supplier_name || row.product || row.vessel_name
    );
    
    if (hasData) {
      console.log('✅ SUCCESS: Data is being populated correctly!');
    } else {
      console.log('❌ FAILED: All fields are still NULL');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

directImportTest();
