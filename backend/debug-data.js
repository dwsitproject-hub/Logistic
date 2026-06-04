const { query } = require('./dist/database/connection');

async function debugData() {
  try {
    // Get the latest import
    const importResult = await query('SELECT id FROM sap_data_imports ORDER BY import_timestamp DESC LIMIT 1');
    if (importResult.rows.length === 0) {
      console.log('No imports found');
      return;
    }
    
    const importId = importResult.rows[0].id;
    console.log('Latest import ID:', importId);
    
    // Get raw data to see the actual structure
    const rawResult = await query('SELECT data FROM sap_raw_data WHERE import_id = $1 LIMIT 1', [importId]);
    if (rawResult.rows.length === 0) {
      console.log('No raw data found');
      return;
    }
    
    const rawData = rawResult.rows[0].data;
    console.log('Raw data type:', typeof rawData);
    console.log('Raw data:', rawData);
    
    if (Array.isArray(rawData)) {
      console.log('Raw data length:', rawData.length);
      console.log('First 30 elements:', rawData.slice(0, 30));
    } else {
      console.log('Raw data is not an array, it is:', typeof rawData);
    }
    
    // Get processed data to see the parsed structure
    const processedResult = await query('SELECT data FROM sap_processed_data WHERE import_id = $1 LIMIT 1', [importId]);
    if (processedResult.rows.length === 0) {
      console.log('No processed data found');
      return;
    }
    
    const processedDataRaw = processedResult.rows[0].data;
    console.log('\nProcessed data type:', typeof processedDataRaw);
    console.log('Processed data:', processedDataRaw);
    
    let processedData;
    try {
      processedData = JSON.parse(processedDataRaw);
    } catch (e) {
      console.log('Processed data is not JSON, it is:', typeof processedDataRaw);
      processedData = processedDataRaw;
    }
    
    console.log('\nProcessed data structure:');
    console.log('Raw object keys:', Object.keys(processedData.raw || {}));
    console.log('Sample raw data:', Object.entries(processedData.raw || {}).slice(0, 10));
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

debugData();
