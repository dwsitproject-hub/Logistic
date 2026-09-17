/**
 * One active trucking operation per contract (PO).
 * Inserts use ON CONFLICT against trucking_operations_one_active_per_contract_uidx.
 */

import type { QueryResult } from 'pg';
import { sqlTruckingOpIsActiveForMatchingSql } from './truckingOperationUniqueness';

export type TruckingQueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>;

export interface ActiveTruckingOpRef {
  id: string;
  operation_id: string | null;
  status: string | null;
  created: boolean;
}

/** Must match the partial UNIQUE index predicate (migration 141). */
export const SQL_TRUCKING_ONE_ACTIVE_PER_CONTRACT_PREDICATE = `deduped_at IS NULL AND COALESCE(status, '') <> 'CANCELLED'`;

export const SQL_TRUCKING_ONE_ACTIVE_PER_CONTRACT_CONFLICT = `(contract_id) WHERE ${SQL_TRUCKING_ONE_ACTIVE_PER_CONTRACT_PREDICATE}`;

export function isPgUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '23505');
}

const SELECT_ACTIVE_OP_SQL = `
    SELECT t.id, t.operation_id, t.status
    FROM trucking_operations t
    WHERE t.contract_id = $1::uuid
      AND ${sqlTruckingOpIsActiveForMatchingSql('t')}
    ORDER BY t.created_at ASC NULLS LAST, t.id ASC
    LIMIT 1
    FOR UPDATE
`;

const INSERT_ACTIVE_UNPLANNED_SQL = `
    INSERT INTO trucking_operations (
      contract_id, operation_id, status, daily_deliverables
    ) VALUES ($1::uuid, $2, 'UNPLANNED', '[]'::jsonb)
    ON CONFLICT ${SQL_TRUCKING_ONE_ACTIVE_PER_CONTRACT_CONFLICT}
    DO NOTHING
    RETURNING id, operation_id, status
`;

async function selectActiveOp(
  db: TruckingQueryFn,
  contractUuid: string,
): Promise<Omit<ActiveTruckingOpRef, 'created'> | null> {
  const res = await db(SELECT_ACTIVE_OP_SQL, [contractUuid]);
  const row = res.rows[0] as { id?: string; operation_id?: string | null; status?: string | null } | undefined;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    operation_id: row.operation_id != null ? String(row.operation_id) : null,
    status: row.status != null ? String(row.status) : null,
  };
}

export interface GetOrCreateActiveTruckingOpOptions {
  operationId?: string | null;
  allocateOperationId?: () => Promise<string>;
}

/**
 * Return the active trucking op for a contract, creating a minimal UNPLANNED row if none exists.
 * Concurrent callers serialize on the unique index (loser SELECT the winner).
 */
export async function getOrCreateActiveTruckingOp(
  db: TruckingQueryFn,
  contractUuid: string,
  options?: GetOrCreateActiveTruckingOpOptions,
): Promise<ActiveTruckingOpRef> {
  const existing = await selectActiveOp(db, contractUuid);
  if (existing) return { ...existing, created: false };

  const operationId =
    options?.operationId != null && String(options.operationId).trim() !== ''
      ? String(options.operationId).trim()
      : options?.allocateOperationId
        ? await options.allocateOperationId()
        : null;

  const inserted = await db(INSERT_ACTIVE_UNPLANNED_SQL, [contractUuid, operationId]);
  const ins = inserted.rows[0] as
    | { id?: string; operation_id?: string | null; status?: string | null }
    | undefined;
  if (ins?.id) {
    return {
      id: String(ins.id),
      operation_id: ins.operation_id != null ? String(ins.operation_id) : operationId,
      status: ins.status != null ? String(ins.status) : 'UNPLANNED',
      created: true,
    };
  }

  const winner = await selectActiveOp(db, contractUuid);
  if (!winner) {
    throw new Error(`Failed to get or create active trucking operation for contract ${contractUuid}`);
  }
  return { ...winner, created: false };
}
