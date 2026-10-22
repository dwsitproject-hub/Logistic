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

  // A multi-PO STO whose PO members are exactly the POs of a voyage a user planned in KLIP earlier belongs to THAT voyage.
  const planned = await findPlannedOperationForMultiPoSto(db, shipmentUuid, sto);
  if (planned) {
    return await writeOperationId(db, shipmentUuid, planned, sto);
  }

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

  return await writeOperationId(db, shipmentUuid, operationId, sto);
}

/** Write the id on an EMPTY operation_id, then pull the STO's other SAP-assigned rows onto one operation. Returns the id now on the row. */
async function writeOperationId(db: QueryFn, shipmentUuid: string, operationId: string, sto: string): Promise<string | null> {
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
  await convergeStoOperationIds(db, sto);
  return operationId;
}

/**
 * The operation a user planned in KLIP for exactly the POs of this multi-PO STO, when it is the only one.
 *
 * Operation ID is KLIP's id, STO is SAP's. A voyage planned in KLIP before SAP delivers its STO carries no STO; when the STO arrives its PO members are the
 * voyage's PO members (STO 1006020666 = PO 1001032425 + 1001032737 = operation OP-1004032737-34122029). The shell then takes that operation instead of a
 * new OP-SEA, which would show one voyage as two operations.
 *
 * Deliberately narrow: more than one PO (a one-PO match says nothing about which voyage it is), a user-planned id (operation_id_source IS NULL), no shell of
 * ANOTHER STO in the operation (a second STO over the same POs is a second voyage), and exactly one candidate.
 */
export async function findPlannedOperationForMultiPoSto(db: QueryFn, shipmentUuid: string, sto: string): Promise<string | null> {
  const res = await db.query(
    `WITH sto_pos AS (
       SELECT DISTINCT TRIM(spd.po_number::text) AS po
         FROM sap_processed_data spd
        WHERE TRIM(COALESCE(spd.sto_number::text, '')) = $1::text
          AND NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') IS NOT NULL
     ),
     my_ops AS (
       SELECT DISTINCT m.operation_id
         FROM shipments me
         JOIN shipments m ON m.contract_id = me.contract_id
        WHERE me.id = $2::uuid
          AND m.operation_id ~ '^OP-'
          AND m.operation_id_source IS NULL
          AND COALESCE(m.status, '') <> 'CANCELLED'
     ),
     op_pos AS (
       SELECT s.operation_id, ARRAY_AGG(DISTINCT TRIM(c.po_number::text)) AS pos
         FROM shipments s
         JOIN contracts c ON c.id = s.contract_id
        WHERE s.operation_id IN (SELECT operation_id FROM my_ops)
          AND COALESCE(s.status, '') <> 'CANCELLED'
        GROUP BY s.operation_id
     )
     SELECT o.operation_id
       FROM op_pos o
      WHERE (SELECT COUNT(*) FROM sto_pos) > 1
        AND o.pos @> ARRAY(SELECT po FROM sto_pos)
        AND o.pos <@ ARRAY(SELECT po FROM sto_pos)
        AND NOT EXISTS (
          SELECT 1 FROM shipments x
           WHERE x.operation_id = o.operation_id
             AND COALESCE(x.status, '') <> 'CANCELLED'
             AND x.shipment_id ~ '^[0-9]+$'
             AND x.shipment_id <> $1::text
        )
      LIMIT 2`,
    [sto, shipmentUuid],
  );
  return res.rows.length === 1 ? String(res.rows[0].operation_id) : null;
}

/**
 * One STO, one operation: the STO's rows that KLIP gave an id by itself (SAP_IMPORT) are moved onto the operation the STO's other rows already share.
 *
 * The id is assigned row by row while the import runs in parallel chunks, so two shells of one STO can each find no sibling and allocate an id of their own
 * (STO 1006020667: six POs on OP-SEA-191020260001, one on ...0003, same vessel, same day).
 * Target: a user-planned operation first, then the one with most of the STO's rows, then the lowest id.
 * A row only moves when it is SAP-assigned, its id is carried by no other STO, and its vessel is empty or one the target already has for this STO.
 */
export async function convergeStoOperationIds(db: QueryFn, sto: string): Promise<number> {
  const res = await db.query(
    `WITH sto_rows AS (
       SELECT s.id, s.operation_id, s.operation_id_source, LOWER(BTRIM(s.vessel_name)) AS vessel
         FROM shipments s
        WHERE s.shipment_id = $1::text
          AND COALESCE(s.status, '') <> 'CANCELLED'
          AND NULLIF(BTRIM(s.operation_id), '') IS NOT NULL
     ),
     sto_ops AS (
       SELECT operation_id, COUNT(*) AS cnt, BOOL_OR(operation_id_source IS NULL) AS user_planned
         FROM sto_rows GROUP BY operation_id
     ),
     target AS (
       SELECT operation_id FROM sto_ops ORDER BY user_planned DESC, cnt DESC, operation_id LIMIT 1
     ),
     target_vessels AS (
       SELECT DISTINCT vessel FROM sto_rows
        WHERE operation_id = (SELECT operation_id FROM target) AND NULLIF(vessel, '') IS NOT NULL
     )
     UPDATE shipments s
        SET operation_id = (SELECT operation_id FROM target), updated_at = CURRENT_TIMESTAMP
       FROM sto_rows r
      WHERE s.id = r.id
        AND r.operation_id_source = $2::text
        AND r.operation_id <> (SELECT operation_id FROM target)
        AND (NULLIF(r.vessel, '') IS NULL OR r.vessel IN (SELECT vessel FROM target_vessels))
        AND NOT EXISTS (
          SELECT 1 FROM shipments o2
           WHERE o2.operation_id = r.operation_id
             AND o2.shipment_id IS DISTINCT FROM $1::text
             AND COALESCE(o2.status, '') <> 'CANCELLED'
        )
      RETURNING s.id`,
    [sto, SAP_IMPORT_OPERATION_ID_SOURCE],
  );
  return res.rows.length;
}
