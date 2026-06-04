import pool from './connection'
import logger from '../utils/logger'

const run = async () => {
  try {
    logger.info('Altering company_notes to add user_id...')
    await pool.query(`ALTER TABLE company_notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);`)
    logger.info('company_notes user_id added')
    process.exit(0)
  } catch (err) {
    logger.error('Alter company_notes failed', err as any)
    process.exit(1)
  }
}

run()


