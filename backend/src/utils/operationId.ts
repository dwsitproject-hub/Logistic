/**
 * Synthetic operation IDs when SAP STO is missing (grouping key for Shipments / Trucking UIs).
 * Format: OP-{SEA|LAND}-DDMMYYYYxxxx (xxxx = daily running sequence, min 4 digits).
 */

import type { QueryResult } from 'pg';
import { query } from '../database/connection';

export function formatDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

export function buildSyntheticOperationId(
  mode: 'SEA' | 'LAND',
  dmy: string,
  sequence: number
): string {
  const tag = mode === 'SEA' ? 'OP-SEA-' : 'OP-LAND-';
  const suffix =
    sequence < 10000 ? String(sequence).padStart(4, '0') : String(sequence);
  return `${tag}${dmy}${suffix}`;
}

type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>;

/**
 * Next daily sequence for OP-SEA-/OP-LAND- ids (max existing numeric suffix + 1).
 */
export async function allocateNextSyntheticSequence(
  queryFn: QueryFn,
  table: 'shipments' | 'trucking_operations',
  mode: 'SEA' | 'LAND',
  dmy: string
): Promise<number> {
  const kind = mode === 'SEA' ? 'SEA' : 'LAND';
  const r = await queryFn(
    `
    SELECT COALESCE((
      SELECT MAX((regexp_match(t.operation_id::text, '^OP-' || $2::text || '-' || $1::text || '([0-9]+)$'))[1]::bigint)
      FROM ${table} t
      WHERE t.operation_id::text ~ ('^OP-' || $2::text || '-' || $1::text || '[0-9]+$')
    ), 0)::bigint + 1 AS n
    `,
    [dmy, kind]
  );
  const n = r.rows[0]?.n;
  const num = typeof n === 'bigint' ? Number(n) : Number(n ?? 1);
  return Number.isFinite(num) ? num : 1;
}

/** Convenience using shared pool `query`. */
export async function allocateNextSyntheticSequenceDefault(
  table: 'shipments' | 'trucking_operations',
  mode: 'SEA' | 'LAND',
  dmy: string
): Promise<number> {
  return allocateNextSyntheticSequence(query as QueryFn, table, mode, dmy);
}
