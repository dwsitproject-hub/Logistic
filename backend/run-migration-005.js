const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'klip_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('========================================');
    console.log('SAP Integration Schema Extension');
    console.log('Migration: 005_sap_integration_schema_extension.sql');
    console.log('========================================\n');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'src', 'database', 'migrations', '005_sap_integration_schema_extension.sql');
    console.log(`Reading migration file: ${migrationPath}\n`);
    
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Starting migration...\n');
    
    await client.query('BEGIN');
    
    // Execute the migration
    await client.query(sql);
    
    await client.query('COMMIT');
    
    console.log('✅ Migration completed successfully!\n');
    
    // Verify new tables
    console.log('Verifying new tables...\n');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('vessel_master', 'trucking_operations', 'surveyors', 'loading_ports')
      ORDER BY table_name
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ New tables created:');
      result.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }
    
    // Verify new columns in shipments table
    console.log('\nVerifying new columns in shipments table...\n');
    const columnsResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'shipments' 
      AND column_name IN ('voyage_no', 'vessel_code', 'vessel_owner', 'charter_type', 'loading_method')
      ORDER BY column_name
    `);
    
    if (columnsResult.rows.length > 0) {
      console.log('✅ New columns in shipments table:');
      columnsResult.rows.forEach(row => {
        console.log(`   - ${row.column_name}`);
      });
    }
    
    // Verify new columns in contracts table
    console.log('\nVerifying new columns in contracts table...\n');
    const contractsResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'contracts' 
      AND column_name IN ('group_name', 'po_number', 'sto_number', 'unit_price', 'transport_mode')
      ORDER BY column_name
    `);
    
    if (contractsResult.rows.length > 0) {
      console.log('✅ New columns in contracts table:');
      contractsResult.rows.forEach(row => {
        console.log(`   - ${row.column_name}`);
      });
    }
    
    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log('✅ Schema extended successfully');
    console.log(`✅ ${result.rows.length} new tables created`);
    console.log(`✅ ${columnsResult.rows.length + contractsResult.rows.length} sample new columns verified`);
    console.log('\nDatabase is now ready for SAP integration!');
    console.log('========================================\n');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    console.error('\nError details:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

