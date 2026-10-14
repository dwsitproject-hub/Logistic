/**
 * Operation ID for the SEA shipments the SAP import creates (the "shell" a SAP STO becomes in KLIP).
 *
 * Operation ID is KLIP's own identifier of a transaction (STO is SAP's). A row with a SAP STO is Planned from the moment it exists, so the import gives it its id.
 * The id is marked `operation_id_source = 'SAP_IMPORT'`: hasKlipShipmentActivity() treats a non-empty operation_id as "a user planned this" and switches the SAP
 * re-import's field protection on, which must not happen for an id KLIP assigned itself.
 *
 * ONE id per STO (shipment_id): the rows of one STO - one per contract - share it, because Shipping Performance and the missing-ETA alerts take operation_id before
 * shipment_id. A sibling's id is adopted when it is a KLIP id no OTHER STO carries (an id shared by several STOs is a multi-STO operation; borrowing it would pull this
 * row into that operation) or the plain number equal to the STO itself. Otherwise a new OP-SEA-DDMMYYYYnnnn is allocated (utils/operationId.ts).
 */

import type { QueryResult } from 'pg';
import { allocateNextSyntheticSequence, buildSyntheticOperationId, formatDDMMYYYY } from './operationId';

export const SAP_IMPORT_OPERATION_ID_SOURCE = 'SAP_IMPORT';

type QueryFn = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

/** True for an id KLIP assigned to a SAP-imported row (not a user plan). */
export function isSapImportOperationIdSource(source: unknown): boolean {
  return String(source ?? '').trim().toUpperCase() === SAP_IMPORT_OPERATION_ID_SOURCE;
}

/** The STO of a SAP-imported shell: digits only (KLIP manual rows carry MNL-/MSEA- ids and are not SAP-imported). */
export function isSapStoShipmentId(shipmentId: unknown): boolean {
  return /^\d+$/.test(String(shipmentId ?? '').trim());
}

/**
 * Give the shipment its operation id when it has none. Returns the id now on the row, or null when the row is not a SAP STO shell / does not exist.
 * Never changes a value that is already there.
 */
export async function ensureSapShellOperationId(db: QueryFn, shipmentUuid: string, now: Date = new Date()): Promise<string | null> {
  const rowRes = await db.query(
    `SELECT shipment_id, operation_id FROM shipments WHERE id = $1::uuid LIMIT 1`,
    [shipmentUuid],
  );
  const row = rowRes.rows[0] as { shipment_id: string | null; operation_id: string | null } | undefined;
  if (!row) return null;
  const existing = String(row.operation_id ?? '').trim();
  if (existing) return existing;
  const sto = String(row.shipment_id ?? '').trim();
  if (!isSapStoShipmentId(sto)) return null;

  const sibling = await db.query(
    `SELECT sib.operation_id
     FROM shipments sib
     WHERE sib.shipment_id = $1
       AND sib.id <> $2::uuid
       AND NULLIF(BTRIM(sib.operation_id), '') IS NOT NULL
       AND (
         sib.operation_id = sib.shipment_id
         OR (
           sib.operation_id ~ '^OP-'
           AND NOT EXISTS (
             SELECT 1 FROM shipments other
             WHERE other.operation_id = sib.operation_id AND other.shipment_id IS DISTINCT FROM sib.shipment_id
           )
         )
       )
     ORDER BY (sib.operation_id ~ '^OP-') DESC, sib.operation_id
     LIMIT 1`,
    [sto, shipmentUuid],
  );
  let operationId = String(sibling.rows[0]?.operation_id ?? '').trim();
  if (!operationId) {
    const dmy = formatDDMMYYYY(now);
    const sequence = await allocateNextSyntheticSequence(
      (text, params) => db.query(text, params),
      'shipments',
      'SEA',
      dmy,
    );
    operationId = buildSyntheticOperationId('SEA', dmy, sequence);
  }

  const updated = await db.query(
    `UPDATE shipments
     SET operation_id = $2, operation_id_source = $3
     WHERE id = $1::uuid AND NULLIF(BTRIM(operation_id), '') IS NULL
     RETURNING operation_id`,
    [shipmentUuid, operationId, SAP_IMPORT_OPERATION_ID_SOURCE],
  );
  // The row was filled by someone else between the read and the write: that value wins.
  if (updated.rows.length === 0) {
    const again = await db.query(`SELECT operation_id FROM shipments WHERE id = $1::uuid LIMIT 1`, [shipmentUuid]);
    return String(again.rows[0]?.operation_id ?? '').trim() || null;
  }
  return operationId;
}
