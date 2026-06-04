require('dotenv').config();
const pool = require('./dist/database/connection').default;

async function finalCheck() {
  try {
    console.log('=== FINAL DATABASE CHECK ===\n');
    
    // Check imports
    const imports = await pool.query('SELECT id, import_timestamp, total_records, processed_records, failed_records FROM sap_data_imports ORDER BY import_timestamp DESC LIMIT 5');
    console.log('Recent Imports:', imports.rows.length);
    imports.rows.forEach((row, i) => {
      console.log(`${i+1}. Time: ${new Date(row.import_timestamp).toLocaleString()} | Total: ${row.total_records} | Success: ${row.processed_records} | Failed: ${row.failed_records}`);
    });
    
    if (imports.rows.length > 0) {
      const latestId = imports.rows[0].id;
      console.log(`\n=== Latest Import Data ===`);
      
      // Check processed data
      const processed = await pool.query(
        'SELECT contract_number, po_number, sto_number, supplier_name, product, vessel_name FROM sap_processed_data WHERE import_id = $1 LIMIT 5',
        [latestId]
      );
      
      console.log('Processed Records Found:', processed.rows.length);
      processed.rows.forEach((row, i) => {
        console.log(`\nRecord ${i+1}:`);
        console.log(`  Contract: ${row.contract_number || 'NULL'}`);
        console.log(`  PO: ${row.po_number || 'NULL'}`);
        console.log(`  STO: ${row.sto_number || 'NULL'}`);
        console.log(`  Supplier: ${row.supplier_name || 'NULL'}`);
        console.log(`  Product: ${row.product || 'NULL'}`);
        console.log(`  Vessel: ${row.vessel_name || 'NULL'}`);
      });
      
      const hasData = processed.rows.some(r => r.contract_number || r.supplier_name || r.product);
      
      console.log(`\n${'='.repeat(50)}`);
      if (hasData) {
        console.log('✅ SUCCESS: Data is populated in the database!');
        console.log('✅ The UI should display this data at:');
        console.log('   http://localhost:3001/sap-imports');
      } else {
        console.log('❌ FAILED: All fields are still NULL in the database');
        console.log('❌ The field mapping fix did not work as expected');
      }
      console.log(`${'='.repeat(50)}`);
    } else {
      console.log('\n❌ No imports found. Please try importing via the UI first.');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

finalCheck();
