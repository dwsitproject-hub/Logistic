const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');

async function testParseNumber() {
  try {
    const cn = '2313586719';
    const row = await pool.query('SELECT data FROM sap_processed_data WHERE contract_number=$1 LIMIT 1', [cn]);
    
    if (row.rows[0]) {
      const data = row.rows[0].data;
      const contractData = data.contract;
      
      console.log('Original contract_quantity:', contractData.contract_quantity);
      console.log('Type:', typeof contractData.contract_quantity);
      
      const parsed = SapDataDistributionService.parseNumber(contractData.contract_quantity);
      console.log('Parsed result:', parsed);
      console.log('Type of parsed:', typeof parsed);
      
      // Test the actual INSERT with parsed value
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
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
          contractData.contract_no || `PO-${contractData.po_no}`,
          contractData.group,
          contractData.supplier,
          contractData.group || 'Unknown',
          contractData.contract_date,
          contractData.product,
          contractData.po_no,
          contractData.incoterm,
          contractData.sea_land,
          parsed, // Use parsed value
          SapDataDistributionService.parseNumber(contractData.unit_price),
          contractData.due_date_delivery_start,
          contractData.due_date_delivery_end,
          contractData.source,
          contractData.ltc_spot,
          'ACTIVE',
          contractData.sto_no,
          SapDataDistributionService.parseNumber(contractData.sto_quantity),
          contractData.logistics_area_classification,
          contractData.po_classification,
          'test-user'
        ]);
        
        console.log('INSERT result:', result.rows[0]);
        
        await client.query('ROLLBACK');
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('INSERT error:', e.message);
      } finally {
        client.release();
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

testParseNumber();

