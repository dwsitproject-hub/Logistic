import { parsePlanningSheetToMatrix } from '../utils/planningSheetDate';
import {
  clusterShipmentGroupingRowsByGroup,
  matchGroupingRowsToContracts,
  parseShipmentGroupingMatrix,
  type EligibleGroupingIdentity,
  type ParsedShipmentGroupingRow,
} from '../utils/shipmentPreplannedGroupingUpload';
import { prefetchManualGroupingEligibleIdentities } from '../utils/shipmentPreplannedGroupingTemplateSql';
import { createManualPrePlannedGroup, type PrePlannedGroupDto } from './prePlannedGroup.service';
import {
  CreateShipmentClientError,
  createShipmentsFromContracts,
  type CreateShipmentEtaByContract,
} from './createShipment.service';
import {
  classifyGroupingClusterMode,
  isCifIncoterm,
  mergeClusterVoyageFields,
  normalizeDischargePortKey,
} from '../utils/shipmentGroupingPlannedClassify';
import {
  fetchMasterVesselsForPlanning,
  fetchSapPortsForContractUuids,
  matchMasterVesselForPlanning,
} from '../utils/shipmentGroupingPlannedResolve';
import logger from '../utils/logger';

export type GroupingBulkUploadFailure = {
  excelRowNumbers: number[];
  group?: string;
  reason: string;
};

export type GroupingBulkUploadWarning = {
  group: string;
  groupCode: string;
  reason: string;
};

export type GroupingBulkUploadGroup = {
  group: string;
  groupCode: string;
  contractCount: number;
  totalOsMt: number;
  outcome: 'preplanned' | 'planned';
};

export type GroupingBulkUploadResult = {
  processedGroups: number;
  succeeded: number;
  failed: number;
  skippedWithoutY: number;
  preplannedSucceeded: number;
  plannedSucceeded: number;
  groups: GroupingBulkUploadGroup[];
  failures: GroupingBulkUploadFailure[];
  warnings: GroupingBulkUploadWarning[];
};

function mixedPartitionWarning(group: PrePlannedGroupDto): string | null {
  const mixed: string[] = [];
  if (group.groupPlant === 'Mixed') mixed.push('plant');
  if (group.buyer === 'Mixed') mixed.push('buyer');
  if (group.incoterm === 'Mixed') mixed.push('incoterm');
  if (group.product === 'Mixed') mixed.push('product');
  if (mixed.length === 0) return null;
  return `mixed ${mixed.join('/')}`;
}

function uniqueContractIds(matches: Array<{ contractId: string }>): string[] {
  return [...new Set(matches.map((m) => m.contractId))];
}

function rowNumbers(rows: ParsedShipmentGroupingRow[]): number[] {
  return rows.map((r) => r.excelRowNumber);
}

function qtyMtForMatch(
  match: { contractId: string; row: ParsedShipmentGroupingRow },
  identity: EligibleGroupingIdentity | undefined,
): number {
  if (match.row.outstandingQtyMt != null && Number.isFinite(match.row.outstandingQtyMt)) {
    return match.row.outstandingQtyMt;
  }
  const kg = Number(identity?.outstandingQtyKg ?? 0);
  return Number.isFinite(kg) ? kg / 1000 : 0;
}

export async function applyShipmentGroupingBulkUpload(
  buffer: Buffer,
  userId: string | undefined,
): Promise<GroupingBulkUploadResult> {
  const matrix = parsePlanningSheetToMatrix(buffer);
  const parsed = parseShipmentGroupingMatrix(matrix);

  const failures: GroupingBulkUploadFailure[] = parsed.issues.map((issue) => ({
    excelRowNumbers: [issue.excelRowNumber],
    reason: issue.reason,
  }));

  const result: GroupingBulkUploadResult = {
    processedGroups: 0,
    succeeded: 0,
    failed: 0,
    skippedWithoutY: parsed.skippedWithoutY,
    preplannedSucceeded: 0,
    plannedSucceeded: 0,
    groups: [],
    failures,
    warnings: [],
  };

  if (parsed.headerRowIndex < 0) {
    result.failed = 1;
    return result;
  }

  if (parsed.selectedRows.length === 0) {
    if (failures.length === 0) {
      failures.push({ excelRowNumbers: [], reason: 'No rows with Select=Y' });
    }
    result.failed = failures.length;
    return result;
  }

  const eligible = await prefetchManualGroupingEligibleIdentities();
  const eligibleById = new Map(eligible.map((row) => [row.id, row]));
  const matches = matchGroupingRowsToContracts(parsed.selectedRows, eligible);
  const matchedOk: Array<{ contractId: string; row: ParsedShipmentGroupingRow }> = [];
  for (const match of matches) {
    if (match.ok) {
      matchedOk.push({ contractId: match.contractId, row: match.row });
    } else {
      failures.push({
        excelRowNumbers: [match.row.excelRowNumber],
        group: match.row.group,
        reason: match.reason,
      });
    }
  }

  const clusters = clusterShipmentGroupingRowsByGroup(matchedOk.map((m) => m.row));
  result.processedGroups = clusters.length;

  let masterVessels: Awaited<ReturnType<typeof fetchMasterVesselsForPlanning>> | null = null;

  for (const cluster of clusters) {
    const clusterMatches = matchedOk.filter((m) => m.row.group.trim() === cluster.group);
    const contractIds = uniqueContractIds(clusterMatches);
    const merged = mergeClusterVoyageFields(cluster.rows);
    if (merged.reason) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: merged.reason,
      });
      continue;
    }

    const allCif =
      contractIds.length > 0 &&
      contractIds.every((id) => {
        const identity = eligibleById.get(id);
        const incoterm = identity?.incoterm || clusterMatches.find((m) => m.contractId === id)?.row.incoterm;
        return isCifIncoterm(incoterm);
      });

    const classified = classifyGroupingClusterMode({ fields: merged.fields, allCif });
    if (classified.mode === 'reject') {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: classified.reason || 'Incomplete Planned fields',
      });
      continue;
    }

    if (classified.mode === 'preplanned') {
      if (contractIds.length < 1) {
        failures.push({
          excelRowNumbers: rowNumbers(cluster.rows),
          group: cluster.group,
          reason: 'No eligible PO in Group',
        });
        continue;
      }
      try {
        const group = await createManualPrePlannedGroup(contractIds, userId, {
          excelGroupLabel: cluster.group,
        });
        result.succeeded += 1;
        result.preplannedSucceeded += 1;
        result.groups.push({
          group: cluster.group,
          groupCode: group.groupCode,
          contractCount: contractIds.length,
          totalOsMt: Number(group.totalOsMt) || 0,
          outcome: 'preplanned',
        });
        const mixed = mixedPartitionWarning(group);
        if (mixed) {
          result.warnings.push({
            group: cluster.group,
            groupCode: group.groupCode,
            reason: mixed,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Failed to create Preplanned group';
        logger.warn('grouping bulk upload group failed', {
          group: cluster.group,
          reason,
          contractCount: contractIds.length,
        });
        failures.push({
          excelRowNumbers: rowNumbers(cluster.rows),
          group: cluster.group,
          reason,
        });
      }
      continue;
    }

    if (contractIds.length < 1) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: 'No eligible PO in Group',
      });
      continue;
    }

    if (!masterVessels) {
      masterVessels = await fetchMasterVesselsForPlanning();
    }
    const vessel = matchMasterVesselForPlanning(masterVessels, merged.fields.vessel);
    if (!vessel) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: `Vessel "${merged.fields.vessel}" not found in Master Vessel`,
      });
      continue;
    }
    if (!vessel.charterType) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: `Vessel "${vessel.vesselName}" has no Terms (V/C or T/C) on Master Vessel`,
      });
      continue;
    }

    const sapPorts = await fetchSapPortsForContractUuids(contractIds);
    const missingLoading: string[] = [];
    const missingContract: string[] = [];
    const dischargeNames = new Set<string>();
    const etaByContract: CreateShipmentEtaByContract = {};
    const quantityDeliveredByContract: Record<string, number> = {};
    let firstLoadingPort = '';
    const contractQtyAssigned: Record<string, string> = {};
    const contractNumbers: string[] = [];

    for (const match of clusterMatches) {
      const identity = eligibleById.get(match.contractId);
      const ports = sapPorts.get(match.contractId);
      const contractNumber = String(ports?.contractNumber || identity?.contractNumber || '').trim();
      if (!contractNumber) {
        missingContract.push(match.row.poNumber);
        continue;
      }
      if (!contractNumbers.includes(contractNumber)) contractNumbers.push(contractNumber);
      const loadingPort = ports?.loadingPort ?? '';
      const dischargePort = ports?.dischargePort ?? '';
      const poCif = isCifIncoterm(identity?.incoterm || match.row.incoterm);
      if (!allCif && !poCif && !loadingPort) {
        missingLoading.push(match.row.poNumber);
      }
      if (dischargePort) dischargeNames.add(normalizeDischargePortKey(dischargePort));
      if (!firstLoadingPort && loadingPort) firstLoadingPort = loadingPort;
      etaByContract[contractNumber] = {
        port_of_loading: loadingPort || null,
        eta_arrival: merged.fields.etas.eta_arrival || null,
        eta_berthed: merged.fields.etas.eta_berthed || null,
        eta_loading_start: merged.fields.etas.eta_loading_start || null,
        eta_loading_complete: merged.fields.etas.eta_loading_complete || null,
        eta_sailed: merged.fields.etas.eta_sailed || null,
        eta_discharge_arrival: merged.fields.etas.eta_discharge_arrival || null,
        eta_discharge_berthed: merged.fields.etas.eta_discharge_berthed || null,
        eta_discharge_start: merged.fields.etas.eta_discharge_start || null,
        eta_discharge_complete: merged.fields.etas.eta_discharge_complete || null,
      };
      const qtyMt = qtyMtForMatch(match, identity);
      if (qtyMt > 0) {
        const po = String(match.row.poNumber || identity?.poNumber || '').trim();
        const assignmentKey = po ? `${contractNumber}::${po}` : contractNumber;
        contractQtyAssigned[assignmentKey] = String(qtyMt);
      }
      if (match.row.qtyDeliveryMt != null && Number.isFinite(match.row.qtyDeliveryMt) && match.row.qtyDeliveryMt > 0) {
        quantityDeliveredByContract[contractNumber] = match.row.qtyDeliveryMt * 1000;
      }
    }

    if (missingContract.length > 0) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: `Missing contract number for PO ${missingContract.join(', ')}`,
      });
      continue;
    }
    if (missingLoading.length > 0) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: `SAP Vessel Loading Port empty for PO ${missingLoading.join(', ')}`,
      });
      continue;
    }
    if (dischargeNames.size > 1) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: 'SAP Vessel Discharge Port differs across POs in the same Group',
      });
      continue;
    }
    const dischargePort =
      [...sapPorts.values()].map((p) => p.dischargePort).find((p) => Boolean(p)) ?? '';
    if (!allCif && !dischargePort) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: 'SAP Vessel Discharge Port is empty for this Group',
      });
      continue;
    }
    if (contractNumbers.length === 0) {
      continue;
    }

    try {
      const created = await createShipmentsFromContracts({
        contractNumbers,
        contractQtyAssigned,
        vesselName: vessel.vesselName,
        vesselCode: vessel.vesselCode,
        vesselOwner: vessel.vesselOwner,
        vesselCapacity: vessel.vesselCapacityMt,
        vesselHullType: vessel.vesselHullType,
        charterType: vessel.charterType,
        portOfLoading: firstLoadingPort || null,
        portOfDischarge: dischargePort || null,
        etaByContract,
        quantityDeliveredByContract:
          Object.keys(quantityDeliveredByContract).length > 0 ? quantityDeliveredByContract : null,
        userId,
      });
      const totalOsMt = clusterMatches.reduce((sum, m) => sum + qtyMtForMatch(m, eligibleById.get(m.contractId)), 0);
      result.succeeded += 1;
      result.plannedSucceeded += 1;
      result.groups.push({
        group: cluster.group,
        groupCode: created.shipmentIds[0] ? `PLN-${cluster.group}` : cluster.group,
        contractCount: contractIds.length,
        totalOsMt,
        outcome: 'planned',
      });
    } catch (err) {
      const reason =
        err instanceof CreateShipmentClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create Planned shipment';
      logger.warn('grouping bulk upload planned group failed', {
        group: cluster.group,
        reason,
        contractCount: contractIds.length,
      });
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason,
      });
    }
  }

  result.failed = failures.length;
  return result;
}
