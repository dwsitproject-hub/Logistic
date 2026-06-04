const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'klip_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function runMigration() {
  try {
    console.log('🔄 Running migration 004: Fix VARCHAR length...');
    
    const migrationPath = path.join(__dirname, 'src', 'database', 'migrations', '004_fix_varchar_length.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    await pool.query(migrationSQL);
    
    console.log('✅ Migration 004 completed successfully!');
    console.log('   - Updated status columns to VARCHAR(50-100)');
    console.log('   - Updated priority column to VARCHAR(50)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Details:', error);
    process.exit(1);
  }
}

runMigration();

