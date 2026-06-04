const pool = require('./dist/database/connection').default;

async function testInsertValues() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cn = '2313586719';
    const row = await client.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const contractData = data.contract;
      
      const contractNumber = contractData.contract_no;
      const poNumber = contractData.po_no;
      
      console.log('Values being passed to INSERT:');
      console.log('1. contractNumber || `PO-${poNumber}`:', contractNumber || `PO-${poNumber}`);
      console.log('2. contractData.group:', contractData.group);
      console.log('3. contractData.supplier:', contractData.supplier);
      console.log('4. contractData.group || \'Unknown\':', contractData.group || 'Unknown');
      console.log('5. this.parseDate(contractData.contract_date):', contractData.contract_date);
      console.log('6. contractData.product:', contractData.product);
      console.log('7. poNumber:', poNumber);
      console.log('8. contractData.incoterm:', contractData.incoterm);
      console.log('9. contractData.sea_land:', contractData.sea_land);
      console.log('10. this.parseNumber(contractData.contract_quantity):', contractData.contract_quantity);
      
      // Test the actual INSERT with these values
      const result = await client.query(`
        INSERT INTO contracts (
          contract_id, group_name, supplier, buyer, contract_date, product, po_number,
          incoterm, transport_mode, quantity_ordered, unit, unit_price,
          delivery_start_date, delivery_end_date, source_type, contract_type,
          status, sto_number, sto_quantity, logistics_classification, po_classification,
          created_by
        ) VALUES (
          $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10::numeric, 'MT', $11::numeric,
          $12::date, $13::date, $14, $15, $16, $17, $18::numeric, $19, $20, $21
        ) RETURNING id, contract_id
      `, [
        contractNumber || `PO-${poNumber}`,
        contractData.group,
        contractData.supplier,
        contractData.group || 'Unknown',
        contractData.contract_date,
        contractData.product,
        poNumber,
        contractData.incoterm,
        contractData.sea_land,
        contractData.contract_quantity,
        contractData.unit_price,
        contractData.due_date_delivery_start,
        contractData.due_date_delivery_end,
        contractData.source,
        contractData.ltc_spot,
        'ACTIVE',
        contractData.sto_no,
        contractData.sto_quantity,
        contractData.logistics_area_classification,
        contractData.po_classification,
        'test-user'
      ]);
      
      console.log('INSERT result:', result.rows[0]);
    }
    
    await client.query('ROLLBACK');
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e);
  } finally {
    client.release();
    pool.end();
  }
}

testInsertValues();

