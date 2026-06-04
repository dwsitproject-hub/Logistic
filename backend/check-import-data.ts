import pool from './src/database/connection';

async function checkData() {
  try {
    console.log('🔍 Checking imported data structure...\n');
    
    // Check what got parsed
    const result = await pool.query(`
      SELECT 
        contract_number,
        po_number,
        shipment_id,
        sto_number,
        data->'contract' as contract_data
      FROM sap_processed_data 
      WHERE import_id = 'd82816d4-17ed-4ab6-b8aa-bef1f0c2b497'
      LIMIT 2
    `);
    
    console.log('📊 Processed Data:');
    result.rows.forEach((row, i) => {
      console.log(`\nRecord ${i + 1}:`);
      console.log(`  contract_number: ${row.contract_number}`);
      console.log(`  po_number: ${row.po_number}`);
      console.log(`  sto_number: ${row.sto_number}`);
      console.log(`\n  Contract JSON:`);
      console.log(JSON.stringify(row.contract_data, null, 2));
    });
    
    // Check what's in contracts table
    const contracts = await pool.query(`
      SELECT id, contract_id, supplier, product, quantity_ordered, created_at
      FROM contracts
      WHERE created_at > NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC
    `);
    
    console.log(`\n\n📋 Contracts Created (last hour): ${contracts.rows.length}`);
    contracts.rows.forEach((c, i) => {
      console.log(`\n${i + 1}. Contract ID: ${c.contract_id}`);
      console.log(`   Supplier: ${c.supplier}`);
      console.log(`   Product: ${c.product}`);
      console.log(`   Quantity: ${c.quantity_ordered}`);
    });
    
    console.log('\n✅ Check complete\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkData();

