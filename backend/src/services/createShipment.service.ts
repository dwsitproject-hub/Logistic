import { query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import logger from '../utils/logger';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import {
  allocateNextSyntheticSequenceDefault,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';
import { resolveShipmentPlanQtyAssignmentTargets } from '../utils/shipmentPlanQtyAssignmentKey';
import { stoQtyAssignedMtToKg } from '../utils/userStoAssignmentQty';
import {
  isOfficialSapStoNumber,
  officialSapStoHasRegisteredPlanning,
} from '../utils/sapStoShipmentPlanning';
import { invalidateShipmentsListCache } from './shipmentList.service';
import { invalidateShippingPerformanceRowCache } from './shippingPerformance.service';

export class CreateShipmentClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateShipmentClientError';
  }
}

export type CreateShipmentEtaByContract = Record<
  string,
  {
    port_of_loading?: string | null;
    eta_arrival?: string | null;
    eta_berthed?: string | null;
    eta_loading_start?: string | null;
    eta_loading_complete?: string | null;
    eta_sailed?: string | null;
    eta_discharge_arrival?: string | null;
    eta_discharge_berthed?: string | null;
    eta_discharge_start?: string | null;
    eta_discharge_complete?: string | null;
  }
>;

export interface CreateShipmentsFromContractsInput {
  operationId?: string | null;
  stoNumber?: string | null;
  contractNumbers: string[];
  contractQtyAssigned?: Record<string, unknown> | null;
  poQtyAssigned?: Record<string, unknown> | null;
  vesselName?: string | null;
  vesselCode?: string | null;
  voyageNo?: string | null;
  vesselOwner?: string | null;
  vesselDraft?: string | number | null;
  vesselCapacity?: string | number | null;
  vesselHullType?: string | null;
  charterType?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  quantityShipped?: string | number | null;
  quantityDelivered?: string | number | null;
  eta_arrival?: string | null;
  eta_berthed?: string | null;
  eta_loading_start?: string | null;
  eta_loading_complete?: string | null;
  eta_sailed?: string | null;
  eta_discharge_arrival?: string | null;
  eta_discharge_berthed?: string | null;
  eta_discharge_start?: string | null;
  eta_discharge_complete?: string | null;
  etaByContract?: CreateShipmentEtaByContract | null;
  prePlannedGroupId?: string | null;
  userId?: string;
}

export interface CreateShipmentsFromContractsResult {
  stoNumber: string | null;
  contractNumbers: string[];
  shipmentIds: string[];
}

async function upsertPoQtyAssignment(
  assignmentKey: string,
  contractNumber: string,
  poNumber: string | null,
  qtyMt: number,
): Promise<void> {
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

export async function createShipmentsFromContracts(
  input: CreateShipmentsFromContractsInput,
): Promise<CreateShipmentsFromContractsResult> {
  const {
    operationId,
    stoNumber,
    contractNumbers,
    contractQtyAssigned,
    poQtyAssigned,
    vesselName,
    vesselCode,
    voyageNo,
    vesselOwner,
    vesselDraft,
    vesselCapacity,
    vesselHullType,
    charterType,
    portOfLoading,
    portOfDischarge,
    quantityShipped,
    quantityDelivered,
    eta_arrival,
    eta_berthed,
    eta_loading_start,
    eta_loading_complete,
    eta_sailed,
    eta_discharge_arrival,
    eta_discharge_berthed,
    eta_discharge_start,
    eta_discharge_complete,
    etaByContract,
    prePlannedGroupId,
    userId,
  } = input;

  if (!contractNumbers || !Array.isArray(contractNumbers) || contractNumbers.length === 0) {
    throw new CreateShipmentClientError('At least one Contract Number is required');
  }

  const hasStoNumber = Boolean(stoNumber && String(stoNumber).trim() !== '');
  if (hasStoNumber) {
    const stoTrim = String(stoNumber).trim();
    if (isOfficialSapStoNumber(stoTrim)) {
      if (await officialSapStoHasRegisteredPlanning(stoTrim)) {
        throw new CreateShipmentClientError(
          `STO Number ${stoTrim} already has shipment planning. Please update the existing shipment instead of creating a new one.`,
        );
      }
    } else {
      const stoCheck = await query(`SELECT sto_number FROM contracts WHERE sto_number = $1 LIMIT 1`, [
        stoTrim,
      ]);
      if (stoCheck.rows.length > 0) {
        throw new CreateShipmentClientError(
          `STO Number ${stoTrim} already exists. Please update the existing shipment instead of creating a new one.`,
        );
      }
    }
  }

  const contractCheck = await query(
    `SELECT contract_id, id FROM contracts WHERE contract_id = ANY($1)`,
    [contractNumbers],
  );

  if (contractCheck.rows.length !== contractNumbers.length) {
    const foundContracts = contractCheck.rows.map((row: { contract_id: string }) => row.contract_id);
    const missingContracts = contractNumbers.filter((id) => !foundContracts.includes(id));
    throw new CreateShipmentClientError(
      `The following contract numbers do not exist: ${missingContracts.join(', ')}`,
    );
  }

  const shipmentIds: string[] = [];
  const timestamp = Date.now().toString();

  let resolvedOperationId: string | null =
    operationId != null && String(operationId).trim() !== '' ? String(operationId).trim() : null;
  if (!resolvedOperationId && hasStoNumber) {
    const stoTrimForOp = String(stoNumber).trim();
    if (isOfficialSapStoNumber(stoTrimForOp)) {
      resolvedOperationId = stoTrimForOp;
    }
  }
  if (!resolvedOperationId && !hasStoNumber) {
    const dmy = formatDDMMYYYY(new Date());
    const seq = await allocateNextSyntheticSequenceDefault('shipments', 'SEA', dmy);
    resolvedOperationId = buildSyntheticOperationId('SEA', dmy, seq);
  }

  type PerContractEtaPayload = {
    port_of_loading?: string | null;
    eta_arrival?: string | null;
    eta_berthed?: string | null;
    eta_loading_start?: string | null;
    eta_loading_complete?: string | null;
    eta_sailed?: string | null;
    eta_discharge_arrival?: string | null;
    eta_discharge_berthed?: string | null;
    eta_discharge_start?: string | null;
    eta_discharge_complete?: string | null;
  };

  const legacyEta: PerContractEtaPayload = {
    port_of_loading: portOfLoading || null,
    eta_arrival: eta_arrival || null,
    eta_berthed: eta_berthed || null,
    eta_loading_start: eta_loading_start || null,
    eta_loading_complete: eta_loading_complete || null,
    eta_sailed: eta_sailed || null,
    eta_discharge_arrival: eta_discharge_arrival || null,
    eta_discharge_berthed: eta_discharge_berthed || null,
    eta_discharge_start: eta_discharge_start || null,
    eta_discharge_complete: eta_discharge_complete || null,
  };

  const etaByContractMap =
    etaByContract && typeof etaByContract === 'object' && !Array.isArray(etaByContract)
      ? etaByContract
      : {};

  for (const contract of contractCheck.rows as Array<{ contract_id: string; id: string }>) {
    const contractIdKey = String(contract.contract_id).trim();
    const perContractEta =
      etaByContractMap[contractIdKey] && typeof etaByContractMap[contractIdKey] === 'object'
        ? etaByContractMap[contractIdKey]
        : legacyEta;

    const shipmentId = hasStoNumber
      ? `${stoNumber}-${contract.contract_id}`
      : `MNL-${timestamp.slice(-8)}-${contract.contract_id}`;

    const derivedStatus = deriveShipmentStatus({
      eta_arrival_at_loading_port: perContractEta.eta_arrival,
      eta_berthed_at_loading_port: perContractEta.eta_berthed,
      eta_start_loading: perContractEta.eta_loading_start,
      eta_completed_loading: perContractEta.eta_loading_complete,
      eta_sailed_from_loading_port: perContractEta.eta_sailed,
      eta_arrive_at_discharge_port: perContractEta.eta_discharge_arrival,
      eta_berthed_at_discharge_port: perContractEta.eta_discharge_berthed,
      eta_start_discharging: perContractEta.eta_discharge_start,
      eta_complete_discharge: perContractEta.eta_discharge_complete,
    });

    let existingShipmentId: string | null = null;
    if (resolvedOperationId) {
      const byOp = await query(
        `SELECT id FROM shipments WHERE contract_id = $1::uuid AND operation_id = $2 LIMIT 1`,
        [contract.id, resolvedOperationId],
      );
      if (byOp.rows.length > 0) existingShipmentId = byOp.rows[0].id;
    }
    if (!existingShipmentId && vesselName) {
      const byVessel = await query(
        `SELECT id FROM shipments WHERE contract_id = $1::uuid AND LOWER(TRIM(vessel_name)) = LOWER(TRIM($2)) LIMIT 1`,
        [contract.id, vesselName],
      );
      if (byVessel.rows.length > 0) existingShipmentId = byVessel.rows[0].id;
    }
    if (!existingShipmentId) {
      const byActiveContract = await query(
        `SELECT id FROM shipments
         WHERE contract_id = $1::uuid
           AND COALESCE(status, '') <> 'CANCELLED'
         ORDER BY created_at DESC
         LIMIT 1`,
        [contract.id],
      );
      if (byActiveContract.rows.length > 0) {
        existingShipmentId = byActiveContract.rows[0].id;
      }
    }

    let resultId: string;
    if (existingShipmentId) {
      await query(
        `
          UPDATE shipments SET
            operation_id  = COALESCE($1, operation_id),
            vessel_name   = COALESCE($2, vessel_name),
            vessel_code   = COALESCE($3, vessel_code),
            voyage_no     = COALESCE($4, voyage_no),
            vessel_owner  = COALESCE($5, vessel_owner),
            vessel_draft  = COALESCE($6::numeric, vessel_draft),
            vessel_capacity = COALESCE($7::numeric, vessel_capacity),
            vessel_hull_type = COALESCE($8, vessel_hull_type),
            charter_type  = COALESCE($9, charter_type),
            port_of_loading = COALESCE($10, port_of_loading),
            port_of_discharge = COALESCE($11, port_of_discharge),
            quantity_shipped = COALESCE($12::numeric, quantity_shipped),
            quantity_delivered = COALESCE($13::numeric, quantity_delivered),
            eta_arrival   = COALESCE($14::date, eta_arrival),
            eta_berthed   = COALESCE($15::date, eta_berthed),
            eta_loading_start = COALESCE($16::date, eta_loading_start),
            eta_loading_complete = COALESCE($17::date, eta_loading_complete),
            eta_sailed    = COALESCE($18::date, eta_sailed),
            eta_discharge_arrival = COALESCE($19::date, eta_discharge_arrival),
            eta_discharge_berthed = COALESCE($20::date, eta_discharge_berthed),
            eta_discharge_start = COALESCE($21::date, eta_discharge_start),
            eta_discharge_complete = COALESCE($22::date, eta_discharge_complete),
            status        = $23,
            updated_at    = CURRENT_TIMESTAMP
          WHERE id = $24
        `,
        [
          resolvedOperationId,
          vesselName || null,
          vesselCode || null,
          voyageNo || null,
          vesselOwner || null,
          vesselDraft ? parseFloat(String(vesselDraft)) : null,
          vesselCapacity ? parseFloat(String(vesselCapacity)) : null,
          vesselHullType || null,
          charterType || null,
          perContractEta.port_of_loading || portOfLoading || null,
          portOfDischarge || null,
          quantityShipped ? parseFloat(String(quantityShipped)) : null,
          quantityDelivered ? parseFloat(String(quantityDelivered)) : null,
          perContractEta.eta_arrival || null,
          perContractEta.eta_berthed || null,
          perContractEta.eta_loading_start || null,
          perContractEta.eta_loading_complete || null,
          perContractEta.eta_sailed || null,
          perContractEta.eta_discharge_arrival || null,
          perContractEta.eta_discharge_berthed || null,
          perContractEta.eta_discharge_start || null,
          perContractEta.eta_discharge_complete || null,
          derivedStatus,
          existingShipmentId,
        ],
      );
      resultId = existingShipmentId;
    } else {
      const result = await query(
        `
          INSERT INTO shipments (
            shipment_id, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner,
            vessel_draft, vessel_capacity, vessel_hull_type, charter_type,
            port_of_loading, port_of_discharge, quantity_shipped, quantity_delivered,
            eta_arrival, eta_berthed, eta_loading_start, eta_loading_complete, eta_sailed,
            eta_discharge_arrival, eta_discharge_berthed, eta_discharge_start, eta_discharge_complete,
            status
          ) VALUES (
            $1, $2, $3::uuid, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11,
            $12, $13, $14::numeric, $25::numeric,
            $15::date, $16::date, $17::date, $18::date, $19::date,
            $20::date, $21::date, $22::date, $23::date,
            $24
          ) RETURNING id
        `,
        [
          shipmentId,
          resolvedOperationId,
          contract.id,
          vesselName || null,
          vesselCode || null,
          voyageNo || null,
          vesselOwner || null,
          vesselDraft ? parseFloat(String(vesselDraft)) : null,
          vesselCapacity ? parseFloat(String(vesselCapacity)) : null,
          vesselHullType || null,
          charterType || null,
          perContractEta.port_of_loading || portOfLoading || null,
          portOfDischarge || null,
          quantityShipped ? parseFloat(String(quantityShipped)) : null,
          perContractEta.eta_arrival || null,
          perContractEta.eta_berthed || null,
          perContractEta.eta_loading_start || null,
          perContractEta.eta_loading_complete || null,
          perContractEta.eta_sailed || null,
          perContractEta.eta_discharge_arrival || null,
          perContractEta.eta_discharge_berthed || null,
          perContractEta.eta_discharge_start || null,
          perContractEta.eta_discharge_complete || null,
          derivedStatus,
          quantityDelivered ? parseFloat(String(quantityDelivered)) : null,
        ],
      );
      resultId = result.rows[0].id;
    }

    shipmentIds.push(resultId);
  }

  const assignmentKey =
    hasStoNumber && stoNumber && String(stoNumber).trim()
      ? String(stoNumber).trim()
      : resolvedOperationId && String(resolvedOperationId).trim()
        ? String(resolvedOperationId).trim()
        : `MNL-${timestamp.slice(-8)}`;

  const mergedPlanQtyEntries: Record<string, unknown> = {
    ...(contractQtyAssigned && typeof contractQtyAssigned === 'object' ? contractQtyAssigned : {}),
    ...(poQtyAssigned && typeof poQtyAssigned === 'object' ? poQtyAssigned : {}),
  };

  if (Object.keys(mergedPlanQtyEntries).length > 0) {
    await ensureUserStoContractAssignmentsTable();
    const targets = await resolveShipmentPlanQtyAssignmentTargets(mergedPlanQtyEntries, async (ids) => {
      const rowsResult = await query(
        `SELECT id, contract_id, po_number FROM contracts WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      return new Map(
        rowsResult.rows.map((r: { id: string; contract_id: string; po_number: string | null }) => [
          String(r.id),
          {
            contractNumber: String(r.contract_id).trim(),
            poNumber: r.po_number ? String(r.po_number).trim() : null,
          },
        ]),
      );
    });
    for (const target of targets) {
      await upsertPoQtyAssignment(assignmentKey, target.contractNumber, target.poNumber, target.qtyMt);
    }
  }

  if (hasStoNumber) {
    await query(
      `
        UPDATE contracts
        SET sto_number = $1, updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = ANY($2)
      `,
      [stoNumber, contractNumbers],
    );
  }

  invalidateShipmentsListCache();
  if (shipmentIds.length > 0) {
    try {
      const { ContractQtyMoveSnapshotService } = await import('./contractQtyMoveSnapshot.service');
      await ContractQtyMoveSnapshotService.refreshForShipmentIds(shipmentIds);
      const { scheduleContractPerformanceRefreshForShipments } = await import(
        './contractPerformanceSnapshot.service'
      );
      scheduleContractPerformanceRefreshForShipments(shipmentIds);
      /** A new shipment changes Shipping Performance rows directly - drop its 5-minute row cache. */
      invalidateShippingPerformanceRowCache();
    } catch (err) {
      logger.warn('Contract qty_move snapshot refresh after shipment create failed', {
        err,
        shipmentIds,
      });
    }
  }

  const attachedContractUuids = contractCheck.rows.map((row: { id: string }) => String(row.id));
  void import('./prePlannedGroup.service').then(({ releaseContractsFromPrePlanned }) =>
    releaseContractsFromPrePlanned(attachedContractUuids),
  );
  if (prePlannedGroupId && typeof prePlannedGroupId === 'string' && shipmentIds.length > 0) {
    void import('./prePlannedGroup.service').then(({ acceptPrePlannedGroupLink }) =>
      acceptPrePlannedGroupLink(prePlannedGroupId, String(shipmentIds[0]), userId),
    );
  }
  if (shipmentIds.length > 0) {
    void import('./prePlannedGroup.service').then(({ linkAcceptedPrePlannedGroupsForContracts }) =>
      linkAcceptedPrePlannedGroupsForContracts(attachedContractUuids, String(shipmentIds[0]), userId),
    );
  }

  return {
    stoNumber: stoNumber ? String(stoNumber) : null,
    contractNumbers,
    shipmentIds,
  };
}
