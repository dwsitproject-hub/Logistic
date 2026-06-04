import pool from './connection'
import logger from '../utils/logger'

const run = async () => {
  try {
    logger.info('Migrating company_notes...')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_company_notes_company_id ON company_notes(company_id);`)
    logger.info('company_notes migration done')
    process.exit(0)
  } catch (err) {
    logger.error('company_notes migration failed', err as any)
    process.exit(1)
  }
}

run()


