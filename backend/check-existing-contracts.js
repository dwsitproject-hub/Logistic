const pool = require('./dist/database/connection').default;

async function checkExistingContracts() {
  try {
    const r = await pool.query('SELECT id, contract_id, po_number FROM contracts WHERE contract_id=$1 OR po_number=$2', ['2313586719', '1957265902']);
    console.log('Existing contracts:', r.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkExistingContracts();

