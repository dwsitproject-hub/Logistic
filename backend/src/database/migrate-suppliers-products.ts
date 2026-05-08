import pool from './connection'
import logger from '../utils/logger'

const run = async () => {
  try {
    logger.info('Starting incremental migration for suppliers/products...')

    // Ensure suppliers table exists and add new columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        plant_code VARCHAR(100) NOT NULL,
        mills VARCHAR(255),
        group_id VARCHAR(100),
        parent_company VARCHAR(255),
        group_holding VARCHAR(255),
        controlling_shareholder VARCHAR(255),
        other_shareholders VARCHAR(500),
        group_type VARCHAR(100),
        group_scale VARCHAR(100),
        integrated_status VARCHAR(100),
        cap VARCHAR(100),
        cpo_prod_est DECIMAL(15,2),
        pk_prod_est DECIMAL(15,2),
        pome_prod_est DECIMAL(15,2),
        shell_prod_est DECIMAL(15,2),
        cpo_prod_est_month DECIMAL(15,2),
        pk_prod_est_month DECIMAL(15,2),
        pome_prod_est_month DECIMAL(15,2),
        shell_prod_est_month DECIMAL(15,2),
        cpo_prod_est_year DECIMAL(15,2),
        pk_prod_est_year DECIMAL(15,2),
        pome_prod_est_year DECIMAL(15,2),
        shell_prod_est_year DECIMAL(15,2),
        city_regency VARCHAR(255),
        province VARCHAR(255),
        island VARCHAR(255),
        longitude DECIMAL(10,6),
        latitude DECIMAL(10,6),
        kml_folder VARCHAR(255),
        map VARCHAR(255),
        rspo VARCHAR(100),
        rspo_type VARCHAR(100),
        ispo VARCHAR(100),
        iscc VARCHAR(100),
        year_commence INTEGER,
        updated_date DATE,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_suppliers_plant_code UNIQUE (plant_code)
      );
    `)

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_group_id ON suppliers(group_id);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_parent_company ON suppliers(parent_company);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_province ON suppliers(province);`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_city ON suppliers(city_regency);`)

    // Ensure new columns exist (idempotent)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cpo_prod_est_month DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pk_prod_est_month DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pome_prod_est_month DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS shell_prod_est_month DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cpo_prod_est_year DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pk_prod_est_year DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pome_prod_est_year DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS shell_prod_est_year DECIMAL(15,2);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS prov_code VARCHAR(50);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS prov_no VARCHAR(50);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mill_no VARCHAR(50);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mill_code VARCHAR(100);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ggl VARCHAR(100);`)
    await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS update_year INTEGER;`)

    // Products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_name VARCHAR(255) NOT NULL UNIQUE,
        percent_produce DECIMAL(7,4),
        working_hours_per_day INTEGER,
        working_days_per_month INTEGER,
        working_days_per_year INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_name ON products(product_name);`)

    // Drop old unique constraint on plant_code to allow multi-rows per plant when other attributes differ
    await pool.query(`ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS uq_suppliers_plant_code;`)

    logger.info('Incremental migration completed successfully')
    process.exit(0)
  } catch (error) {
    logger.error('Incremental migration failed:', error as any)
    process.exit(1)
  }
}

run()


