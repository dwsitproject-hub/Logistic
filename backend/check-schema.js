const pool = require('./dist/database/connection').default;

async function checkSchema() {
  try {
    const r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='contracts' AND column_name='contract_id'");
    console.log('contract_id column:', r.rows[0]);
    
    // Check a few sample contracts
    const samples = await pool.query("SELECT id, contract_id, po_number, product FROM contracts LIMIT 5");
    console.log('Sample contracts:', samples.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkSchema();

