const { query } = require('./dist/database/connection');

async function checkImports() {
  try {
    // Get all imports
    const importResult = await query('SELECT id, import_timestamp, status, total_records, processed_records FROM sap_data_imports ORDER BY import_timestamp DESC LIMIT 5');
    
    console.log('Recent imports:');
    importResult.rows.forEach((imp, index) => {
      console.log(`${index + 1}. ID: ${imp.id}`);
      console.log(`   Timestamp: ${imp.import_timestamp}`);
      console.log(`   Status: ${imp.status}`);
      console.log(`   Total: ${imp.total_records}, Processed: ${imp.processed_records}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkImports();
