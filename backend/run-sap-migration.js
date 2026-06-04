const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function runSapMigration() {
  try {
    console.log('🚀 Starting SAP tables migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'src/database/migrations/003_create_sap_data_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await pool.query(migrationSQL);
    
    console.log('✅ SAP tables migration completed successfully!');
    
    // Create default field mappings
    console.log('🔧 Creating default field mappings...');
    
    const defaultMappings = [
      // Trading Team Fields
      { sap_field_name: 'Contract Number', display_name: 'Contract Number', field_type: 'text', user_role: 'TRADING', is_required: true, color_code: '#FFA500', sort_order: 1 },
      { sap_field_name: 'Trader Name', display_name: 'Trader Name', field_type: 'text', user_role: 'TRADING', is_required: true, color_code: '#FFA500', sort_order: 2 },
      { sap_field_name: 'Estimated Date', display_name: 'Estimated Date', field_type: 'date', user_role: 'TRADING', is_required: false, color_code: '#FFA500', sort_order: 3 },
      { sap_field_name: 'Actual Date', display_name: 'Actual Date', field_type: 'date', user_role: 'TRADING', is_required: false, color_code: '#FFA500', sort_order: 4 },
      
      // Logistics Team Fields
      { sap_field_name: 'Shipment ID', display_name: 'Shipment ID', field_type: 'text', user_role: 'LOGISTICS', is_required: true, color_code: '#00FF00', sort_order: 1 },
      { sap_field_name: 'Logistics Team', display_name: 'Logistics Team', field_type: 'text', user_role: 'LOGISTICS', is_required: true, color_code: '#00FF00', sort_order: 2 },
      { sap_field_name: 'Status', display_name: 'Status', field_type: 'text', user_role: 'LOGISTICS', is_required: true, color_code: '#00FF00', sort_order: 3 },
      { sap_field_name: 'Priority', display_name: 'Priority', field_type: 'text', user_role: 'LOGISTICS', is_required: false, color_code: '#00FF00', sort_order: 4 },
      
      // Finance Team Fields
      { sap_field_name: 'Cost', display_name: 'Cost', field_type: 'number', user_role: 'FINANCE', is_required: false, color_code: '#0000FF', sort_order: 1 },
      { sap_field_name: 'Payment Status', display_name: 'Payment Status', field_type: 'text', user_role: 'FINANCE', is_required: false, color_code: '#0000FF', sort_order: 2 },
      
      // Management Fields
      { sap_field_name: 'Dashboard', display_name: 'Dashboard View', field_type: 'boolean', user_role: 'MANAGEMENT', is_required: false, color_code: '#800080', sort_order: 1 },
    ];
    
    for (const mapping of defaultMappings) {
      await pool.query(
        `INSERT INTO sap_field_mappings 
         (sap_field_name, display_name, field_type, user_role, is_required, color_code, sort_order) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         ON CONFLICT (sap_field_name, user_role) DO NOTHING`,
        [
          mapping.sap_field_name,
          mapping.display_name,
          mapping.field_type,
          mapping.user_role,
          mapping.is_required,
          mapping.color_code,
          mapping.sort_order
        ]
      );
    }
    
    console.log('✅ Default field mappings created successfully!');
    console.log('🎉 SAP integration setup completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSapMigration();
