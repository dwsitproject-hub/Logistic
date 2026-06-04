const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'klip_logistics',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123'
});

async function quickCheck() {
  try {
    console.log('=== QUICK DATABASE CHECK ===\n');
    
    // Check imports
    const imports = await pool.query('SELECT id, import_timestamp, total_records, processed_records, failed_records FROM sap_data_imports ORDER BY import_timestamp DESC LIMIT 5');
    console.log('Recent Imports:', imports.rows.length);
    imports.rows.forEach((row, i) => {
      console.log(`${i+1}. ID: ${row.id.substring(0,8)}... | Time: ${row.import_timestamp} | Total: ${row.total_records} | Success: ${row.processed_records} | Failed: ${row.failed_records}`);
    });
    
    if (imports.rows.length > 0) {
      const latestId = imports.rows[0].id;
      console.log(`\n=== Latest Import (${latestId.substring(0,8)}...) ===`);
      
      // Check processed data
      const processed = await pool.query(
        'SELECT contract_number, po_number, sto_number, supplier_name, product, vessel_name FROM sap_processed_data WHERE import_id = $1 LIMIT 3',
        [latestId]
      );
      
      console.log('\nProcessed Records:', processed.rows.length);
      processed.rows.forEach((row, i) => {
        console.log(`\n Record ${i+1}:`);
        console.log(`  Contract: ${row.contract_number || 'NULL'}`);
        console.log(`  PO: ${row.po_number || 'NULL'}`);
        console.log(`  STO: ${row.sto_number || 'NULL'}`);
        console.log(`  Supplier: ${row.supplier_name || 'NULL'}`);
        console.log(`  Product: ${row.product || 'NULL'}`);
        console.log(`  Vessel: ${row.vessel_name || 'NULL'}`);
      });
      
      const hasData = processed.rows.some(r => r.contract_number || r.supplier_name || r.product);
      console.log(`\n${hasData ? '✅ DATA EXISTS' : '❌ ALL NULL'}`);
    } else {
      console.log('\n❌ No imports found in database');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

quickCheck();
