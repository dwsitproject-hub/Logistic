import { query } from './connection';
import logger from '../utils/logger';

let ensured = false;

/** Idempotent schema for user_sto_contract_assignments (GET /contracts outstanding qty). */
export async function ensureUserStoContractAssignmentsTable(): Promise<void> {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      sto_number VARCHAR(255) NOT NULL,
      contract_number VARCHAR(255) NOT NULL,
      sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sto_number, contract_number)
    )
  `);
  await query(`
    ALTER TABLE user_sto_contract_assignments
    ADD COLUMN IF NOT EXISTS po_number VARCHAR(255)
  `);
  await query(`
    ALTER TABLE user_sto_contract_assignments
    DROP CONSTRAINT IF EXISTS user_sto_contract_assignments_sto_number_contract_number_key
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_sto_contract_assignments_sto_contract_po_key
    ON user_sto_contract_assignments (sto_number, contract_number, COALESCE(po_number, ''))
  `);
  ensured = true;
  logger.info('user_sto_contract_assignments table ready');
}
