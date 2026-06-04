import pool from './src/database/connection';

async function debugDistribution() {
  try {
    console.log('🔍 Debugging SAP Data Distribution\n');
    
    // 1. Check recent import
    const imports = await pool.query(`
      SELECT id, status, total_records, processed_records, failed_records, import_timestamp
      FROM sap_data_imports 
      ORDER BY import_timestamp DESC 
      LIMIT 1
    `);
    
    if (imports.rows.length === 0) {
      console.log('❌ No imports found');
      process.exit(0);
    }
    
    const latestImport = imports.rows[0];
    console.log('📦 Latest Import:');
    console.log(`   ID: ${latestImport.id}`);
    console.log(`   Status: ${latestImport.status}`);
    console.log(`   Total: ${latestImport.total_records}`);
    console.log(`   Processed: ${latestImport.processed_records}`);
    console.log(`   Failed: ${latestImport.failed_records}`);
    console.log(`   Timestamp: ${latestImport.import_timestamp}\n`);
    
    // 2. Check processed data structure
    const processed = await pool.query(`
      SELECT id, contract_number, shipment_id, po_number, sto_number, data
      FROM sap_processed_data 
      WHERE import_id = $1 
      LIMIT 1
    `, [latestImport.id]);
    
    if (processed.rows.length > 0) {
      const sample = processed.rows[0];
      console.log('📄 Sample Processed Data Structure:');
      console.log(`   Contract Number: ${sample.contract_number || 'NULL'}`);
      console.log(`   PO Number: ${sample.po_number || 'NULL'}`);
      console.log(`   Shipment ID: ${sample.shipment_id || 'NULL'}`);
      console.log(`   STO Number: ${sample.sto_number || 'NULL'}`);
      console.log(`\n   Data Structure Keys:`);
      if (sample.data) {
        console.log(`     ${Object.keys(sample.data).join(', ')}`);
        
        if (sample.data.contract) {
          console.log(`\n   Contract Data Keys:`);
          console.log(`     ${Object.keys(sample.data.contract).join(', ')}`);
          console.log(`\n   Contract Data Sample:`);
          console.log(JSON.stringify(sample.data.contract, null, 2).substring(0, 500));
        }
        
        if (sample.data.shipment) {
          console.log(`\n   Shipment Data Keys:`);
          console.log(`     ${Object.keys(sample.data.shipment).join(', ')}`);
        }
        
        if (sample.data.trucking) {
          console.log(`\n   Trucking Data (array length): ${sample.data.trucking?.length || 0}`);
        }
      }
    } else {
      console.log('❌ No processed data found');
    }
    
    // 3. Check if data made it to main tables
    console.log('\n\n🎯 Checking Main Tables:');
    
    const contractCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM contracts 
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Contracts (last hour): ${contractCount.rows[0].count}`);
    
    const shipmentCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM shipments 
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Shipments (last hour): ${shipmentCount.rows[0].count}`);
    
    const truckingCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM trucking_operations 
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Trucking Operations (last hour): ${truckingCount.rows[0].count}`);
    
    const qualityCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM quality_surveys 
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Quality Surveys (last hour): ${qualityCount.rows[0].count}`);
    
    // 4. Check raw data to see if it has the fields
    const rawData = await pool.query(`
      SELECT data
      FROM sap_raw_data 
      WHERE import_id = $1 
      LIMIT 1
    `, [latestImport.id]);
    
    if (rawData.rows.length > 0 && rawData.rows[0].data) {
      console.log(`\n\n📋 Raw Excel Data Fields (first record):`);
      const fields = Object.keys(rawData.rows[0].data);
      console.log(`   Total fields: ${fields.length}`);
      console.log(`   Sample fields:`);
      fields.slice(0, 20).forEach(f => console.log(`     - ${f}`));
      
      // Check for specific key fields
      const keyFields = ['Contract No.', 'PO No.', 'Shipment ID', 'STO No.', 'Supplier', 'Product', 'Group'];
      console.log(`\n   Key field values:`);
      keyFields.forEach(field => {
        const value = rawData.rows[0].data[field];
        console.log(`     ${field}: ${value || 'NULL'}`);
      });
    }
    
    console.log('\n✅ Debug complete\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugDistribution();

