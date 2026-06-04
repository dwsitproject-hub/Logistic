const { pool } = require('./dist/database/connection');

async function testUIData() {
  try {
    console.log('=== TESTING UI DATA DISPLAY ===');
    
    // Get the latest import
    const importResult = await pool.query('SELECT id FROM sap_data_imports ORDER BY import_timestamp DESC LIMIT 1');
    if (importResult.rows.length === 0) {
      console.log('No imports found');
      return;
    }
    
    const latestImportId = importResult.rows[0].id;
    console.log('Latest import ID:', latestImportId);
    
    // Get processed data - this is what the UI displays
    const processedResult = await pool.query(
      'SELECT contract_number, shipment_id, po_number, sto_number, supplier_name, product, vessel_name, data FROM sap_processed_data WHERE import_id = $1 LIMIT 5',
      [latestImportId]
    );
    
    console.log('\n=== PROCESSED DATA FOR UI ===');
    console.log('Total records found:', processedResult.rows.length);
    
    processedResult.rows.forEach((row, index) => {
      console.log(`\nRecord ${index + 1}:`);
      console.log(`  Contract/PO: ${row.contract_number || 'NULL'}`);
      console.log(`  Shipment/STO: ${row.shipment_id || 'NULL'}`);
      console.log(`  PO Number: ${row.po_number || 'NULL'}`);
      console.log(`  STO Number: ${row.sto_number || 'NULL'}`);
      console.log(`  Supplier: ${row.supplier_name || 'NULL'}`);
      console.log(`  Product: ${row.product || 'NULL'}`);
      console.log(`  Vessel: ${row.vessel_name || 'NULL'}`);
      
      // Check the raw data object
      if (row.data && row.data.raw) {
        console.log(`  Raw data keys: ${Object.keys(row.data.raw).slice(0, 5).join(', ')}...`);
      }
    });
    
    // Check if any data is populated
    const hasData = processedResult.rows.some(row => 
      row.contract_number || row.shipment_id || row.po_number || 
      row.sto_number || row.supplier_name || row.product || row.vessel_name
    );
    
    console.log('\n=== FINAL RESULT ===');
    if (hasData) {
      console.log('✅ SUCCESS: Data is being populated correctly!');
      console.log('✅ The UI should now display the data properly.');
      console.log('✅ Go to: http://localhost:3001/sap-imports');
    } else {
      console.log('❌ FAILED: All fields are still NULL');
      console.log('❌ The fix is not working yet.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

testUIData();
