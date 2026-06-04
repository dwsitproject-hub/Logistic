import pool from './connection'
import logger from '../utils/logger'

const run = async () => {
  try {
    logger.info('Starting migration for companies (Customer 360)...')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL UNIQUE,
        primary_contact VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        latest_interaction_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);`)

    logger.info('Companies migration completed')
    process.exit(0)
  } catch (err) {
    logger.error('Companies migration failed', err as any)
    process.exit(1)
  }
}

run()


