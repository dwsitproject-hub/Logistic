import { query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { buildContractDetailsForStoSql } from '../utils/contractDetailsForStoSql';
import {
  buildSeaContractsQtyMoveCte,
  PO_GLOBAL_OUTSTANDING_PLANNING_EXPR,
} from '../utils/contractPoGlobalMetricsSql';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import { resolveShipmentEditContext } from './shipmentEditContext.service';
import { groupPlantExpr } from '../utils/groupPlantSql';
import {
  contractExtNoSubquery,
  resolvedPlantCodeSql,
} from '../utils/portDisplaySql';
import { stoQtyAssignedMtToKg } from '../utils/userStoAssignmentQty';

const PO_LINE_SELECT_FIELDS = `
    c.id AS contract_row_id,
    c.contract_id,
    c.po_number,
    c.quantity_ordered,
    c.delivery_start_date,
    c.delivery_end_date,
    c.supplier,
    c.buyer,
    c.product,
    c.incoterm,
    c.transport_mode,
    ${resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code')} AS plant_code,
    ${groupPlantExpr(resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code'), 'c.company_name')} AS plant_site,
    ${contractExtNoSubquery('c.contract_id', 'c.po_number')} AS contract_ext_no,
    ${PO_GLOBAL_OUTSTANDING_PLANNING_EXPR} AS outstanding_quantity_planning,
    ${PO_GLOBAL_OUTSTANDING_PLANNING_EXPR} AS outstanding_quantity
`;

function buildPoLineByRowIdSql(): string {
  const qtyMoveCte = buildSeaContractsQtyMoveCte();
  return `
    WITH ${qtyMoveCte}
    SELECT
      ${PO_LINE_SELECT_FIELDS}
    FROM contracts c
    WHERE c.id = $1::uuid
    LIMIT 1
  `;
}

function buildGlobalAvailablePoLinesSql(): string {
  const qtyMoveCte = buildSeaContractsQtyMoveCte();
  return `
    WITH ${qtyMoveCte},
    candidates AS (
      SELECT
        ${PO_LINE_SELECT_FIELDS}
      FROM contracts c
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
        AND (
          $1::text = ''
          OR COALESCE(c.po_number::text, '') ILIKE $1::text
          OR COALESCE(c.contract_id::text, '') ILIKE $1::text
          OR COALESCE(c.supplier::text, '') ILIKE $1::text
          OR COALESCE(c.product::text, '') ILIKE $1::text
          OR COALESCE(c.buyer::text, '') ILIKE $1::text
        )
    )
    SELECT *
    FROM candidates
    WHERE COALESCE(outstanding_quantity_planning, 0)::numeric > 0
    ORDER BY COALESCE(po_number, contract_id), contract_id
    LIMIT $2::int
  `;
}

export function poLineKey(contractNumber: string, poNumber: string | null | undefined): string {
  return `${String(contractNumber).trim().toLowerCase()}::${String(poNumber ?? '').trim().toLowerCase()}`;
}

export async function upsertPoQtyAssignment(
  assignmentKey: string,
  contractNumber: string,
  poNumber: string | null,
  qtyKg: number,
): Promise<void> {
  await ensureUserStoContractAssignmentsTable();
  const poKey = poNumber ? String(poNumber).trim() : '';
  await query(
    `
    DELETE FROM user_sto_contract_assignments
    WHERE sto_number = $1
      AND contract_number = $2
      AND COALESCE(po_number, '') = $3
    `,
    [assignmentKey, contractNumber, poKey],
  );
  if (qtyKg > 0) {
    await query(
      `
      INSERT INTO user_sto_contract_assignments (sto_number, contract_number, po_number, sto_qty_assigned)
      VALUES ($1, $2, NULLIF($3, ''), $4::numeric)
      `,
      [assignmentKey, contractNumber, poKey || null, qtyKg],
    );
  }
}

/** @deprecated Prefer upsertPoQtyAssignment with kg. */
export async function upsertPoQtyAssignmentMt(
  assignmentKey: string,
  contractNumber: string,
  poNumber: string | null,
  qtyMt: number,
): Promise<void> {
  return upsertPoQtyAssignment(assignmentKey, contractNumber, poNumber, stoQtyAssignedMtToKg(qtyMt));
}

async function fetchExistingPoKeys(lookupKey: string, contractNumbersCsv: string): Promise<Set<string>> {
  await ensureUserStoContractAssignmentsTable();
  const contractList = contractNumbersCsv
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const keys = new Set<string>();

  const assignRes = await query(
    `
    SELECT contract_number, po_number
    FROM user_sto_contract_assignments
    WHERE TRIM(sto_number::text) = TRIM($1::text)
    `,
    [lookupKey],
  );
  for (const row of assignRes.rows as Array<{ contract_number?: string; po_number?: string | null }>) {
    keys.add(poLineKey(String(row.contract_number ?? ''), row.po_number));
  }

  const detailsSql = buildContractDetailsForStoSql();
  const result = await query(detailsSql, [lookupKey, contractList]);
  for (const row of result.rows as Array<{ contract_number?: string; po_number?: string | null }>) {
    keys.add(poLineKey(String(row.contract_number ?? ''), row.po_number));
  }
  return keys;
}

export async function listAvailablePurchaseOrdersForShipmentEdit(
  shipmentUuid: string,
  opts?: { search?: string; limit?: number },
): Promise<Array<Record<string, unknown>> | null> {
  const context = await resolveShipmentEditContext(shipmentUuid);
  if (!context?.lookup_key) return null;

  const anchorExists = await query(`SELECT 1 FROM shipments WHERE id = $1::uuid LIMIT 1`, [shipmentUuid]);
  if (anchorExists.rows.length === 0) return null;

  if (!context.can_add_po) return [];

  const searchRaw = String(opts?.search ?? '').trim();
  if (searchRaw.length < 2) return [];

  const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 100);
  const searchPattern = `%${searchRaw}%`;

  const existingKeys = await fetchExistingPoKeys(context.lookup_key, context.contract_numbers);
  const lines = await query(buildGlobalAvailablePoLinesSql(), [searchPattern, limit]);

  const out: Record<string, unknown>[] = [];
  const seenRowIds = new Set<string>();

  for (const row of lines.rows as Array<Record<string, unknown>>) {
    const rowId = String(row.contract_row_id ?? '');
    if (!rowId || seenRowIds.has(rowId)) continue;
    const outstandingPlan = Number(row.outstanding_quantity_planning ?? row.outstanding_quantity ?? 0);
    if (!Number.isFinite(outstandingPlan) || outstandingPlan <= 0) continue;
    const key = poLineKey(String(row.contract_id ?? ''), row.po_number as string | null);
    if (existingKeys.has(key)) continue;
    seenRowIds.add(rowId);
    out.push(row);
  }

  return out;
}

export type AttachPurchaseOrderResult =
  | { ok: true; shipmentUuid: string; contractNumber: string; poNumber: string | null }
  | { ok: false; status: number; message: string };

export async function attachPurchaseOrderToShipment(args: {
  anchorShipmentUuid: string;
  contractRowId: string;
  stoQtyAssignedMt?: number;
  stoQtyAssignedKg?: number;
}): Promise<AttachPurchaseOrderResult> {
  const contractRowId = String(args.contractRowId ?? '').trim();
  if (!contractRowId) {
    return { ok: false, status: 400, message: 'contractRowId is required' };
  }

  let qtyKg = 0;
  if (args.stoQtyAssignedKg != null) {
    qtyKg = Number(args.stoQtyAssignedKg);
  } else if (args.stoQtyAssignedMt != null) {
    qtyKg = stoQtyAssignedMtToKg(Number(args.stoQtyAssignedMt));
  }
  if (!Number.isFinite(qtyKg) || qtyKg < 0) {
    return { ok: false, status: 400, message: 'Shipment Plan Qty must be zero or greater' };
  }

  const anchorRes = await query(
    `SELECT s.*, c.contract_id AS business_contract_id
     FROM shipments s
     LEFT JOIN contracts c ON c.id = s.contract_id
     WHERE s.id = $1::uuid
     LIMIT 1`,
    [args.anchorShipmentUuid],
  );
  if (anchorRes.rows.length === 0) {
    return { ok: false, status: 404, message: 'Shipment not found' };
  }
  const anchor = anchorRes.rows[0] as Record<string, unknown>;
  if (String(anchor.status ?? '').trim().toUpperCase() === 'CANCELLED') {
    return { ok: false, status: 403, message: 'Cannot add PO to a cancelled shipment' };
  }

  const context = await resolveShipmentEditContext(args.anchorShipmentUuid);
  if (!context?.lookup_key) {
    return { ok: false, status: 400, message: 'Could not resolve shipment STO / operation group' };
  }
  if (!context.can_add_po) {
    return {
      ok: false,
      status: 403,
      message: context.add_po_blocked_reason ?? 'Cannot add PO to this shipment',
    };
  }

  await ensureUserStoContractAssignmentsTable();

  const poLineRes = await query(buildPoLineByRowIdSql(), [contractRowId]);
  if (poLineRes.rows.length === 0) {
    return { ok: false, status: 404, message: 'Contract / PO line not found' };
  }
  const poLine = poLineRes.rows[0] as Record<string, unknown>;
  const transportMode = String(poLine.transport_mode ?? 'SEA').trim().toUpperCase();
  if (transportMode !== 'SEA' && transportMode !== 'MIXED' && transportMode !== 'MIX') {
    return { ok: false, status: 400, message: 'Only SEA / MIXED contract PO lines can be added to a shipment' };
  }

  const contractNumber = String(poLine.contract_id ?? '').trim();
  const poNumber = poLine.po_number != null ? String(poLine.po_number).trim() : null;
  const outstandingPlanKg = Number(poLine.outstanding_quantity_planning ?? poLine.outstanding_quantity ?? 0);
  if (!Number.isFinite(outstandingPlanKg) || outstandingPlanKg <= 0) {
    return { ok: false, status: 400, message: 'This PO has no outstanding planning quantity remaining' };
  }
  if (qtyKg > outstandingPlanKg + 1e-6) {
    return {
      ok: false,
      status: 400,
      message: `Shipment Plan Qty exceeds global OS Qty (Plan) (${Math.round(outstandingPlanKg)} kg)`,
    };
  }

  const existingKeys = await fetchExistingPoKeys(context.lookup_key, context.contract_numbers);
  if (existingKeys.has(poLineKey(contractNumber, poNumber))) {
    return { ok: false, status: 409, message: 'This PO is already linked to this shipment group' };
  }

  const contractUuidRes = await query(`SELECT id FROM contracts WHERE id = $1::uuid LIMIT 1`, [contractRowId]);
  if (contractUuidRes.rows.length === 0) {
    return { ok: false, status: 404, message: 'Contract row not found' };
  }
  const contractUuid = contractUuidRes.rows[0].id as string;

  const operationId =
    anchor.operation_id != null && String(anchor.operation_id).trim() !== ''
      ? String(anchor.operation_id).trim()
      : null;

  let existingShipmentId: string | null = null;
  if (operationId) {
    const byOp = await query(
      `SELECT id FROM shipments
       WHERE contract_id = $1::uuid AND operation_id = $2
         AND COALESCE(status, '') <> 'CANCELLED'
       LIMIT 1`,
      [contractUuid, operationId],
    );
    if (byOp.rows.length > 0) existingShipmentId = String(byOp.rows[0].id);
  }
  if (!existingShipmentId && anchor.vessel_name) {
    const byVessel = await query(
      `SELECT id FROM shipments
       WHERE contract_id = $1::uuid
         AND LOWER(TRIM(vessel_name)) = LOWER(TRIM($2))
         AND COALESCE(status, '') <> 'CANCELLED'
       LIMIT 1`,
      [contractUuid, String(anchor.vessel_name)],
    );
    if (byVessel.rows.length > 0) existingShipmentId = String(byVessel.rows[0].id);
  }

  const derivedStatus = deriveShipmentStatus({
    eta_arrival_at_loading_port: anchor.eta_arrival,
    eta_berthed_at_loading_port: anchor.eta_berthed,
    eta_start_loading: anchor.eta_loading_start,
    eta_completed_loading: anchor.eta_loading_complete,
    eta_sailed_from_loading_port: anchor.eta_sailed,
    eta_arrive_at_discharge_port: anchor.eta_discharge_arrival,
    eta_berthed_at_discharge_port: anchor.eta_discharge_berthed,
    eta_start_discharging: anchor.eta_discharge_start,
    eta_complete_discharge: anchor.eta_discharge_complete,
  });

  let resultShipmentUuid: string;

  if (existingShipmentId) {
    await query(
      `
      UPDATE shipments SET
        operation_id = COALESCE($2, operation_id),
        vessel_name = COALESCE($3, vessel_name),
        vessel_code = COALESCE($4, vessel_code),
        voyage_no = COALESCE($5, voyage_no),
        vessel_owner = COALESCE($6, vessel_owner),
        vessel_draft = COALESCE($7::numeric, vessel_draft),
        vessel_capacity = COALESCE($8::numeric, vessel_capacity),
        vessel_hull_type = COALESCE($9, vessel_hull_type),
        charter_type = COALESCE($10, charter_type),
        port_of_loading = COALESCE($11, port_of_loading),
        port_of_discharge = COALESCE($12, port_of_discharge),
        eta_arrival = COALESCE($13::date, eta_arrival),
        eta_berthed = COALESCE($14::date, eta_berthed),
        eta_loading_start = COALESCE($15::date, eta_loading_start),
        eta_loading_complete = COALESCE($16::date, eta_loading_complete),
        eta_sailed = COALESCE($17::date, eta_sailed),
        eta_discharge_arrival = COALESCE($18::date, eta_discharge_arrival),
        eta_discharge_berthed = COALESCE($19::date, eta_discharge_berthed),
        eta_discharge_start = COALESCE($20::date, eta_discharge_start),
        eta_discharge_complete = COALESCE($21::date, eta_discharge_complete),
        status = $22,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::uuid
      `,
      [
        existingShipmentId,
        operationId,
        anchor.vessel_name,
        anchor.vessel_code,
        anchor.voyage_no,
        anchor.vessel_owner,
        anchor.vessel_draft,
        anchor.vessel_capacity,
        anchor.vessel_hull_type,
        anchor.charter_type,
        anchor.port_of_loading,
        anchor.port_of_discharge,
        anchor.eta_arrival,
        anchor.eta_berthed,
        anchor.eta_loading_start,
        anchor.eta_loading_complete,
        anchor.eta_sailed,
        anchor.eta_discharge_arrival,
        anchor.eta_discharge_berthed,
        anchor.eta_discharge_start,
        anchor.eta_discharge_complete,
        derivedStatus,
      ],
    );
    resultShipmentUuid = existingShipmentId;
  } else {
    const stoDigits = String(context.lookup_key).trim();
    const hasNumericSto = /^[0-9]+$/.test(stoDigits);
    const shipmentBusinessId = hasNumericSto
      ? `${stoDigits}-${contractNumber}`
      : `MNL-${Date.now().toString().slice(-8)}-${contractNumber}`;

    const insertRes = await query(
      `
      INSERT INTO shipments (
        shipment_id, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner,
        vessel_draft, vessel_capacity, vessel_hull_type, charter_type,
        port_of_loading, port_of_discharge,
        eta_arrival, eta_berthed, eta_loading_start, eta_loading_complete, eta_sailed,
        eta_discharge_arrival, eta_discharge_berthed, eta_discharge_start, eta_discharge_complete,
        status
      ) VALUES (
        $1, $2, $3::uuid, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11,
        $12, $13,
        $14::date, $15::date, $16::date, $17::date, $18::date,
        $19::date, $20::date, $21::date, $22::date,
        $23
      ) RETURNING id
      `,
      [
        shipmentBusinessId,
        operationId,
        contractUuid,
        anchor.vessel_name,
        anchor.vessel_code,
        anchor.voyage_no,
        anchor.vessel_owner,
        anchor.vessel_draft,
        anchor.vessel_capacity,
        anchor.vessel_hull_type,
        anchor.charter_type,
        anchor.port_of_loading,
        anchor.port_of_discharge,
        anchor.eta_arrival,
        anchor.eta_berthed,
        anchor.eta_loading_start,
        anchor.eta_loading_complete,
        anchor.eta_sailed,
        anchor.eta_discharge_arrival,
        anchor.eta_discharge_berthed,
        anchor.eta_discharge_start,
        anchor.eta_discharge_complete,
        derivedStatus,
      ],
    );
    resultShipmentUuid = String(insertRes.rows[0].id);
  }

  if (qtyKg > 0) {
    await upsertPoQtyAssignment(context.lookup_key, contractNumber, poNumber, qtyKg);
  }

  return {
    ok: true,
    shipmentUuid: resultShipmentUuid,
    contractNumber,
    poNumber,
  };
}

export interface PoPlanQtyRow {
  contractNumber: string;
  poNumber?: string | null;
  shipmentPlanQtyKg: number;
}

export type BatchSavePoPlanResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export async function batchSaveShipmentPoPlanQty(args: {
  anchorShipmentUuid: string;
  rows: PoPlanQtyRow[];
}): Promise<BatchSavePoPlanResult> {
  const context = await resolveShipmentEditContext(args.anchorShipmentUuid);
  if (!context?.lookup_key) {
    return { ok: false, status: 400, message: 'Could not resolve shipment STO / operation group' };
  }

  await ensureUserStoContractAssignmentsTable();

  const contractList = context.contract_numbers
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const detailsSql = buildContractDetailsForStoSql();
  const detailsRes = await query(detailsSql, [context.lookup_key, contractList]);
  const budgetByKey = new Map<string, number>();
  for (const row of detailsRes.rows as Array<Record<string, unknown>>) {
    const key = poLineKey(String(row.contract_number ?? ''), row.po_number as string | null);
    budgetByKey.set(key, Number(row.outstanding_qty_planning_budget ?? row.outstanding_qty_planning ?? 0));
  }

  for (const row of args.rows) {
    const contractNumber = String(row.contractNumber ?? '').trim();
    if (!contractNumber) continue;
    const poNumber = row.poNumber != null ? String(row.poNumber).trim() : null;
    const qtyKg = Number(row.shipmentPlanQtyKg);
    if (!Number.isFinite(qtyKg) || qtyKg < 0) {
      return { ok: false, status: 400, message: `Invalid Shipment Plan Qty for ${contractNumber}` };
    }

    const budget = budgetByKey.get(poLineKey(contractNumber, poNumber)) ?? 0;
    if (qtyKg > budget + 1e-6) {
      return {
        ok: false,
        status: 400,
        message: `Shipment Plan Qty for ${contractNumber} exceeds OS Qty (Plan)`,
      };
    }

    await upsertPoQtyAssignment(context.lookup_key, contractNumber, poNumber, qtyKg);
  }

  return { ok: true };
}

export interface PoKlipQtyRow {
  contractNumber: string;
  poNumber?: string | null;
  quantityDeliveredKlipKg: number | null;
  quantityReceiveKlipKg: number | null;
}

export type BatchSavePoKlipResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

async function findSiblingShipmentIdForContract(
  lookupKey: string,
  contractNumber: string,
  anchorShipmentUuid: string,
): Promise<string | null> {
  const result = await query(
    `
    SELECT s.id::text AS shipment_id
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    WHERE COALESCE(s.status, '') <> 'CANCELLED'
      AND TRIM(c.contract_id) = TRIM($1::text)
      AND (
        TRIM(COALESCE(s.operation_id::text, '')) = TRIM($2::text)
        OR TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($2::text)
        OR s.id = $3::uuid
        OR (
          NULLIF(TRIM(COALESCE(s.operation_id::text, '')), '') IS NOT NULL
          AND TRIM(s.operation_id::text) = (
            SELECT NULLIF(TRIM(COALESCE(a.operation_id::text, '')), '')
            FROM shipments a
            WHERE a.id = $3::uuid
          )
        )
      )
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
    LIMIT 1
    `,
    [contractNumber, lookupKey, anchorShipmentUuid],
  );
  const id = result.rows[0]?.shipment_id;
  return id != null && String(id).trim() !== '' ? String(id).trim() : null;
}

/** Persist Delivered/Received Qty (KLIP) onto each sibling shipment (one contract/PO row). */
export async function batchSaveShipmentPoKlipQty(args: {
  anchorShipmentUuid: string;
  rows: PoKlipQtyRow[];
}): Promise<BatchSavePoKlipResult> {
  const context = await resolveShipmentEditContext(args.anchorShipmentUuid);
  if (!context?.lookup_key) {
    return { ok: false, status: 400, message: 'Could not resolve shipment STO / operation group' };
  }

  for (const row of args.rows) {
    const contractNumber = String(row.contractNumber ?? '').trim();
    if (!contractNumber) continue;

    const delivered =
      row.quantityDeliveredKlipKg == null || row.quantityDeliveredKlipKg === undefined
        ? null
        : Number(row.quantityDeliveredKlipKg);
    const receive =
      row.quantityReceiveKlipKg == null || row.quantityReceiveKlipKg === undefined
        ? null
        : Number(row.quantityReceiveKlipKg);

    if (delivered != null && (!Number.isFinite(delivered) || delivered < 0)) {
      return {
        ok: false,
        status: 400,
        message: `Invalid Delivered Qty (KLIP) for ${contractNumber}`,
      };
    }
    if (receive != null && (!Number.isFinite(receive) || receive < 0)) {
      return {
        ok: false,
        status: 400,
        message: `Invalid Received Qty (KLIP) for ${contractNumber}`,
      };
    }
    if (delivered == null && receive == null) continue;

    const siblingId = await findSiblingShipmentIdForContract(
      context.lookup_key,
      contractNumber,
      args.anchorShipmentUuid,
    );
    if (!siblingId) {
      return {
        ok: false,
        status: 400,
        message: `No sibling shipment found for contract ${contractNumber} under this STO / operation`,
      };
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    if (delivered != null) {
      sets.push(`quantity_delivered = $${paramIndex}::numeric`);
      values.push(delivered);
      paramIndex++;
      sets.push(`quantity_delivered_klip = $${paramIndex}::numeric`);
      values.push(delivered);
      paramIndex++;
    }
    if (receive != null) {
      sets.push(`actual_vessel_qty_receive = $${paramIndex}::numeric`);
      values.push(receive);
      paramIndex++;
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(siblingId);

    await query(
      `UPDATE shipments SET ${sets.join(', ')} WHERE id = $${paramIndex}::uuid`,
      values,
    );
  }

  return { ok: true };
}
