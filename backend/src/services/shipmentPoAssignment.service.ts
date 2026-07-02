import { query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { buildContractDetailsForStoSql } from '../utils/contractDetailsForStoSql';
import {
  buildQtyMoveCte,
  sqlContractGlobalOutstandingExpr,
} from '../utils/contractGlobalOutstandingSql';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import { resolveShipmentEditContext } from './shipmentEditContext.service';
import { groupPlantExpr } from '../utils/groupPlantSql';
import { poLineHasSapStoSql } from '../utils/poLineSapStoSql';
import {
  contractExtNoSubquery,
  resolvedPlantCodeSql,
} from '../utils/portDisplaySql';
import { stoQtyAssignedMtToKg } from '../utils/userStoAssignmentQty';

const GLOBAL_OUTSTANDING_EXPR = sqlContractGlobalOutstandingExpr({
  contractQtyExpr: 'c.quantity_ordered',
  incotermExpr: 'c.incoterm',
  contractNumberExpr: 'c.contract_id',
});

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
    ${GLOBAL_OUTSTANDING_EXPR} AS outstanding_quantity,
    ${poLineHasSapStoSql('c')} AS has_sap_sto
`;

function buildPoLineByRowIdSql(): string {
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `(SELECT contract_id FROM contracts WHERE id = $1::uuid)`,
  });
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
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `
      SELECT c2.contract_id
      FROM contracts c2
      WHERE UPPER(COALESCE(NULLIF(TRIM(c2.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
    `,
  });
  return `
    WITH ${qtyMoveCte},
    candidates AS (
      SELECT
        ${PO_LINE_SELECT_FIELDS}
      FROM contracts c
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
        AND NOT (${poLineHasSapStoSql('c')})
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
    WHERE COALESCE(outstanding_quantity, 0)::numeric > 0
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
  qtyMt: number,
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
  if (qtyMt > 0) {
    await query(
      `
      INSERT INTO user_sto_contract_assignments (sto_number, contract_number, po_number, sto_qty_assigned)
      VALUES ($1, $2, NULLIF($3, ''), $4::numeric)
      `,
      [assignmentKey, contractNumber, poKey || null, stoQtyAssignedMtToKg(qtyMt)],
    );
  }
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
    const outstanding = Number(row.outstanding_quantity ?? 0);
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
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
  stoQtyAssignedMt: number;
}): Promise<AttachPurchaseOrderResult> {
  const contractRowId = String(args.contractRowId ?? '').trim();
  const stoQtyAssignedMt = Number(args.stoQtyAssignedMt);
  if (!contractRowId) {
    return { ok: false, status: 400, message: 'contractRowId is required' };
  }
  if (!Number.isFinite(stoQtyAssignedMt) || stoQtyAssignedMt <= 0) {
    return { ok: false, status: 400, message: 'stoQtyAssignedMt must be greater than 0' };
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
  const hasSapSto = poLine.has_sap_sto === true || poLine.has_sap_sto === 't';
  if (hasSapSto) {
    return {
      ok: false,
      status: 400,
      message: 'This PO already has an STO from SAP and cannot be added to a planned shipment',
    };
  }
  const transportMode = String(poLine.transport_mode ?? 'SEA').trim().toUpperCase();
  if (transportMode !== 'SEA' && transportMode !== 'MIXED' && transportMode !== 'MIX') {
    return { ok: false, status: 400, message: 'Only SEA / MIXED contract PO lines can be added to a shipment' };
  }

  const contractNumber = String(poLine.contract_id ?? '').trim();
  const poNumber = poLine.po_number != null ? String(poLine.po_number).trim() : null;
  const outstandingMt = Number(poLine.outstanding_quantity ?? 0) / 1000;
  const outstandingKg = Number(poLine.outstanding_quantity ?? 0);
  if (!Number.isFinite(outstandingKg) || outstandingKg <= 0) {
    return { ok: false, status: 400, message: 'This PO has no outstanding quantity remaining' };
  }
  if (stoQtyAssignedMt > outstandingMt + 1e-9) {
    return {
      ok: false,
      status: 400,
      message: `Assigned quantity (${stoQtyAssignedMt} MT) exceeds outstanding (${Math.round(outstandingMt * 100) / 100} MT)`,
    };
  }

  const vesselCapacity = anchor.vessel_capacity != null ? Number(anchor.vessel_capacity) : null;
  if (vesselCapacity != null && Number.isFinite(vesselCapacity) && vesselCapacity > 0) {
    if (stoQtyAssignedMt > vesselCapacity + 1e-9) {
      return {
        ok: false,
        status: 400,
        message: `Assigned quantity (${stoQtyAssignedMt} MT) exceeds vessel capacity (${vesselCapacity} MT)`,
      };
    }
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

  await upsertPoQtyAssignment(context.lookup_key, contractNumber, poNumber, stoQtyAssignedMt);

  return {
    ok: true,
    shipmentUuid: resultShipmentUuid,
    contractNumber,
    poNumber,
  };
}
