import pool from './connection'
import logger from '../utils/logger'

async function run() {
  try {
    logger.info('Applying VARCHAR length fixes for SAP tables...')

    await pool.query(`ALTER TABLE sap_data_imports ALTER COLUMN status TYPE VARCHAR(50);`)
    await pool.query(`ALTER TABLE sap_raw_data ALTER COLUMN status TYPE VARCHAR(50);`)
    await pool.query(`ALTER TABLE sap_processed_data ALTER COLUMN status TYPE VARCHAR(100);`)
    await pool.query(`ALTER TABLE sap_processed_data ALTER COLUMN priority TYPE VARCHAR(50);`)
    await pool.query(`ALTER TABLE user_data_inputs ALTER COLUMN status TYPE VARCHAR(50);`)

    logger.info('VARCHAR length fixes applied successfully')
    process.exit(0)
  } catch (err) {
    logger.error('Failed to apply VARCHAR length fixes', err as any)
    process.exit(1)
  }
}

run()


