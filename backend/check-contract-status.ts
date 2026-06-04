import pool from './src/database/connection';

async function checkContracts() {
  try {
    console.log('📊 Contract Status Check\n');
    
    // All contracts
    const all = await pool.query(`
      SELECT contract_id, supplier, product, quantity_ordered, 
             DATE(created_at) as create_date, DATE(updated_at) as update_date
      FROM contracts
      ORDER BY created_at DESC
    `);
    
    console.log(`Total Contracts: ${all.rows.length}\n`);
    all.rows.forEach((c, i) => {
      console.log(`${i + 1}. Contract: ${c.contract_id}`);
      console.log(`   Supplier: ${c.supplier}`);
      console.log(`   Product: ${c.product}`);
      console.log(`   Quantity: ${c.quantity_ordered} MT`);
      console.log(`   Created: ${c.create_date} | Updated: ${c.update_date}`);
      console.log('');
    });
    
    console.log('\n✅ Check complete\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkContracts();

