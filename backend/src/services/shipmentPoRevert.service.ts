import type { PoolClient } from 'pg';
import { getClient, query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { isSapSourcedShipmentId } from '../utils/klipLogisticsActivity';
import { poLineHasSapStoSql } from '../utils/poLineSapStoSql';
import { sqlShipmentListPrimaryOrderBy } from '../utils/shipmentListPrimaryShipmentSql';
import { resolveStoGroupShipmentIds } from '../utils/shipmentStoGroupMembersSql';
import logger from '../utils/logger';
import { AuditService } from './audit.service';
import { groupHasSapImportedShell, isKlipOnlyShipmentGroupEligible, sapStoExistsInSpd } from './cancelKlipShipment.service';
import { resolveShipmentEditContext } from './shipmentEditContext.service';
import { groupDischargeCompleteAta } from './shipmentPoAssignment.service';

/**
 * Take ONE PO out of an operation (Edit Shipment > Revert PO). The operation, its vessel and its other POs stay; the PO goes back to Unplanned.
 *
 * "Back to Unplanned" is what the page already does for a PO with no live shipment (contractBacklogCoreWhereSql), so the whole job is removing the PO's presence:
 * its shipment row and its Shipment Plan Qty. It is a DELETE, not a cancel: a cancel would also put a row on the Cancelled card, and this is a KLIP-only plan
 * the user is undoing, not a shipment that happened.
 *
 * What makes a plain delete wrong, and what this does instead:
 *   - Everything the modal saved on that row (legs, documents, manual ATA, surveys, remarks) hangs off shipments.id with ON DELETE CASCADE. When the PO was the
 *     operation's first one, its row may be the one holding all of it, so the rows are MOVED to a surviving member first (the one the list will pick as the
 *     operation's primary row), and only dropped when a surviving member already carries its own copy.
 *   - The PO's Preplanned membership. Left active, it would hold the PO and block Preplanned again (ux_ppgm_active_contract), and once the group's shipment link is
 *     cleared by the delete it would show the PO under Preplanned instead of Unplanned. It is released first.
 *
 * Refused (nothing is touched): the PO is the only one on the operation (use Cancel), the operation or the PO has an SAP STO, the row came from the SAP import,
 * the operation has finished discharging, or it has been sent to JPS (the JPS cargo lists the PO; amending it is a separate decision).
 */
export const REVERT_PO_CODES = {
  ONLY_PO: 'ONLY_PO_ON_OPERATION',
  SAP: 'SAP_STO',
  COMPLETED: 'OPERATION_COMPLETED',
  SENT_TO_JPS: 'SENT_TO_JPS',
  NOT_ON_SHIPMENT: 'PO_NOT_ON_SHIPMENT',
  AMBIGUOUS: 'PO_ON_SEVERAL_ROWS',
} as const;

export type RevertPoResult =
  | {
      ok: true;
      contractNumber: string;
      poNumber: string | null;
      removedShipmentId: string;
      /** The member that now carries the data the removed row held (and that the list uses as the operation's row). */
      survivorShipmentId: string;
      affectedShipmentIds: string[];
      movedRows: Record<string, number>;
      releasedPrePlannedMembers: number;
    }
  | { ok: false; status: number; message: string; code?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, message: string, code?: string): RevertPoResult => ({ ok: false, status, message, ...(code ? { code } : {}) });

interface MemberRow {
  id: string;
  shipment_id: string | null;
  operation_id: string | null;
  operation_id_source: string | null;
  status: string | null;
  contract_uuid: string;
  contract_no: string | null;
  po_number: string | null;
  vessel_name: string | null;
  created_at: string;
}

/** The checks, with no writes. Used by the endpoint and by the modal to show or hide the button. */
export async function checkRevertPurchaseOrder(args: { anchorShipmentUuid: string; contractRowId: string }): Promise<
  | { ok: true; lookupKey: string; members: MemberRow[]; target: MemberRow; remaining: MemberRow[] }
  | Extract<RevertPoResult, { ok: false }>
> {
  const anchorId = String(args.anchorShipmentUuid ?? '').trim();
  const contractRowId = String(args.contractRowId ?? '').trim();
  if (!UUID_RE.test(anchorId)) return fail(400, 'Shipment UUID is required') as Extract<RevertPoResult, { ok: false }>;
  if (!UUID_RE.test(contractRowId)) return fail(400, 'contractRowId is required') as Extract<RevertPoResult, { ok: false }>;

  const anchorRes = await query(`SELECT id, status, operation_id FROM shipments WHERE id = $1::uuid`, [anchorId]);
  const anchor = anchorRes.rows[0] as { id: string; status: string | null; operation_id: string | null } | undefined;
  if (!anchor) return fail(404, 'Shipment not found') as Extract<RevertPoResult, { ok: false }>;
  if (String(anchor.status ?? '').trim().toUpperCase() === 'CANCELLED') {
    return fail(403, 'Cannot revert a PO on a cancelled shipment') as Extract<RevertPoResult, { ok: false }>;
  }

  const context = await resolveShipmentEditContext(anchorId);
  const lookupKey = String(context?.lookup_key ?? '').trim();
  if (!lookupKey) return fail(400, 'Could not resolve shipment STO / operation group') as Extract<RevertPoResult, { ok: false }>;

  const memberIds = await resolveStoGroupShipmentIds(anchorId);
  const membersRes = await query(
    `SELECT s.id::text AS id, s.shipment_id, s.operation_id, s.operation_id_source, s.status, s.contract_id::text AS contract_uuid,
            c.contract_id AS contract_no, c.po_number, s.vessel_name, s.created_at::text AS created_at
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
      WHERE s.id = ANY($1::uuid[])
      ORDER BY s.created_at, s.id`,
    [memberIds],
  );
  const members = membersRes.rows as MemberRow[];
  const targets = members.filter((m) => m.contract_uuid === contractRowId);
  if (targets.length === 0) return fail(404, 'This PO is not on this shipment', REVERT_PO_CODES.NOT_ON_SHIPMENT) as Extract<RevertPoResult, { ok: false }>;
  if (targets.length > 1) {
    return fail(409, 'This PO has more than one row on the operation; it cannot be reverted automatically', REVERT_PO_CODES.AMBIGUOUS) as Extract<RevertPoResult, { ok: false }>;
  }
  const target = targets[0];
  const remaining = members.filter((m) => m.contract_uuid !== contractRowId && String(m.status ?? '').toUpperCase() !== 'CANCELLED');
  if (remaining.length === 0) {
    return fail(409, 'This is the only PO on the shipment. Use Cancel to remove the shipment.', REVERT_PO_CODES.ONLY_PO) as Extract<RevertPoResult, { ok: false }>;
  }

  // A KLIP-only plan: no SAP STO on the operation or on this PO, and no row that came from the SAP import.
  const sapMessage = 'This PO or its operation is linked to SAP STO data and cannot be reverted from KLIP';
  if (!isKlipOnlyShipmentGroupEligible(lookupKey) || (await sapStoExistsInSpd(lookupKey))) {
    return fail(403, sapMessage, REVERT_PO_CODES.SAP) as Extract<RevertPoResult, { ok: false }>;
  }
  if (isSapSourcedShipmentId(target.shipment_id) || String(target.operation_id_source ?? '').toUpperCase() === 'SAP_IMPORT') {
    return fail(403, sapMessage, REVERT_PO_CODES.SAP) as Extract<RevertPoResult, { ok: false }>;
  }
  if (await groupHasSapImportedShell(lookupKey, anchorId)) {
    return fail(403, sapMessage, REVERT_PO_CODES.SAP) as Extract<RevertPoResult, { ok: false }>;
  }
  const poSap = await query(`SELECT 1 FROM contracts c WHERE c.id = $1::uuid AND ${poLineHasSapStoSql('c')} LIMIT 1`, [contractRowId]);
  if (poSap.rows.length > 0) return fail(403, sapMessage, REVERT_PO_CODES.SAP) as Extract<RevertPoResult, { ok: false }>;

  // The operation has finished discharging. The Shipments page's rule for an operation: Completed only when EVERY active PO has finished, so one finished PO
  // does not make it so (operation OP-1004030473-15277540: the first PO finished on 15 Sep, four POs were added on 2 Oct and are still waiting - the table reads
  // Unloading, and those four are exactly what this feature is for).
  const finished = await Promise.all(
    members.map(async (m) => String(m.status ?? '').trim().toUpperCase() === 'COMPLETED' || Boolean(await groupDischargeCompleteAta([m.id]))),
  );
  if (finished.length > 0 && finished.every(Boolean)) {
    return fail(409, 'This operation has already finished discharging; a PO can no longer be reverted from it', REVERT_PO_CODES.COMPLETED) as Extract<
      RevertPoResult,
      { ok: false }
    >;
  }

  // Sent to JPS: the instruction's cargo lists this PO.
  const keys = [...new Set([lookupKey, String(anchor.operation_id ?? '').trim(), ...members.map((m) => String(m.operation_id ?? '').trim())].filter(Boolean))];
  const jps = await query(
    `SELECT 1 FROM jps_shipping_instructions WHERE sto_key = ANY($1::text[]) AND (jps_id IS NOT NULL OR submitted_at IS NOT NULL) LIMIT 1`,
    [keys],
  );
  if (jps.rows.length > 0) {
    return fail(409, 'This operation has been sent to JPS, so a PO can no longer be reverted from it', REVERT_PO_CODES.SENT_TO_JPS) as Extract<
      RevertPoResult,
      { ok: false }
    >;
  }

  return { ok: true, lookupKey, members, target, remaining };
}

/** The remaining member the Shipments list will use as the operation's row: the SAME ranking, so the data moved to it is what the modal opens. */
async function pickSurvivor(client: PoolClient, remainingIds: string[], lookupKey: string): Promise<string> {
  const orderBy = sqlShipmentListPrimaryOrderBy('$2::text', 'c', 'l', 's', undefined, 'sao');
  const res = await client.query(
    `SELECT s.id::text AS id
       FROM shipments s
       LEFT JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
      WHERE s.id = ANY($1::uuid[])
      ORDER BY ${orderBy}
      LIMIT 1`,
    [remainingIds, lookupKey],
  );
  return String(res.rows[0]?.id ?? remainingIds[0]);
}

export async function revertPurchaseOrderFromShipment(args: {
  anchorShipmentUuid: string;
  contractRowId: string;
  userId?: string | null;
}): Promise<RevertPoResult> {
  const checked = await checkRevertPurchaseOrder(args);
  if (!checked.ok) return checked;
  const { lookupKey, target, remaining } = checked;
  await ensureUserStoContractAssignmentsTable();

  const remainingIds = remaining.map((m) => m.id);
  const client = await getClient();
  const moved: Record<string, number> = {};
  let releasedMembers = 0;
  let survivor = remainingIds[0];
  try {
    await client.query('BEGIN');
    survivor = await pickSurvivor(client, remainingIds, lookupKey);

    // Rows that belong to the operation, not to one PO. Moved to the survivor so the cascade of the delete does not take them; a table the operation's other
    // members already fill (legs and surveys are read group-wide, and fanned out) keeps those and drops this row's copy.
    for (const table of ['vessel_loading_ports', 'loading_ports', 'quality_surveys', 'surveyors']) {
      const others = await client.query(`SELECT 1 FROM ${table} WHERE shipment_id = ANY($1::uuid[]) LIMIT 1`, [remainingIds]);
      if (others.rows.length === 0) {
        const res = await client.query(`UPDATE ${table} SET shipment_id = $2::uuid WHERE shipment_id = $1::uuid`, [target.id, survivor]);
        moved[table] = res.rowCount ?? 0;
      }
    }
    // A manual ATA override is unique per shipment: move it only when the survivor has none (the ATA fan-out keeps members equal anyway).
    const survivorOverride = await client.query(`SELECT 1 FROM shipment_ata_overrides WHERE shipment_id = $1::uuid`, [survivor]);
    if (survivorOverride.rows.length === 0) {
      const res = await client.query(`UPDATE shipment_ata_overrides SET shipment_id = $2::uuid WHERE shipment_id = $1::uuid`, [target.id, survivor]);
      moved.shipment_ata_overrides = res.rowCount ?? 0;
    }
    // Documents are listed per shipment row, remarks hang off the shipment: both always move.
    moved.documents = (await client.query(`UPDATE documents SET shipment_id = $2::uuid WHERE shipment_id = $1::uuid`, [target.id, survivor])).rowCount ?? 0;
    moved.remarks =
      (
        await client.query(
          `UPDATE remarks SET related_entity_id = $2::uuid WHERE related_entity_type = 'SHIPMENT' AND related_entity_id = $1::uuid`,
          [target.id, survivor],
        )
      ).rowCount ?? 0;
    // Trucking links would be CASCADE-deleted with the row: this PO's own go back to unlinked, another PO's follow the survivor.
    moved.trucking_operations =
      (
        await client.query(
          `UPDATE trucking_operations SET shipment_id = CASE WHEN contract_id = $3::uuid THEN NULL ELSE $2::uuid END WHERE shipment_id = $1::uuid`,
          [target.id, survivor, target.contract_uuid],
        )
      ).rowCount ?? 0;

    // Preplanned membership first: the delete below clears the group's shipment link (ON DELETE SET NULL), which would turn a still-active member into a
    // Preplanned PO. Same per-contract rule as the cancel: only while the PO has no other live shipment.
    releasedMembers =
      (
        await client.query(
          `UPDATE pre_planned_group_members pgm SET released_at = now()
             FROM pre_planned_groups pg
            WHERE pgm.group_id = pg.id AND pgm.released_at IS NULL AND pgm.contract_id = $1::uuid
              AND pg.status = 'ACCEPTED' AND pg.shipment_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM shipments ls
                 WHERE ls.contract_id = pgm.contract_id AND ls.id <> $2::uuid
                   AND UPPER(TRIM(COALESCE(ls.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'UNPLANNED')
              )`,
          [target.contract_uuid, target.id],
        )
      ).rowCount ?? 0;

    // The PO's Shipment Plan Qty on this operation.
    await client.query(
      `DELETE FROM user_sto_contract_assignments WHERE TRIM(sto_number::text) = TRIM($1::text) AND TRIM(contract_number) = TRIM($2::text)`,
      [lookupKey, String(target.contract_no ?? '')],
    );

    await client.query(`DELETE FROM shipments WHERE id = $1::uuid`, [target.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // Shown in the Activity History of every remaining row, so whichever member the modal opens carries it.
  const userId = args.userId ?? '00000000-0000-0000-0000-000000000000';
  const detail = {
    contractNumber: target.contract_no,
    poNumber: target.po_number,
    removedShipmentId: target.id,
    removedShipmentNo: target.shipment_id,
    operationId: target.operation_id,
  };
  for (const entityId of [...remainingIds, target.id]) {
    await AuditService.log({
      userId,
      action: 'REVERT_PO',
      entityType: 'SHIPMENT',
      entityId,
      beforeData: detail,
      afterData: { returnedTo: 'UNPLANNED', dataMovedTo: survivor, movedRows: moved },
    });
  }
  logger.info('PO reverted from shipment', { ...detail, survivor, moved, releasedPrePlannedMembers: releasedMembers });

  return {
    ok: true,
    contractNumber: String(target.contract_no ?? ''),
    poNumber: target.po_number,
    removedShipmentId: target.id,
    survivorShipmentId: survivor,
    affectedShipmentIds: remainingIds,
    movedRows: moved,
    releasedPrePlannedMembers: releasedMembers,
  };
}
