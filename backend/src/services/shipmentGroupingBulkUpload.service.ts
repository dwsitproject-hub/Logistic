import { parsePlanningSheetToMatrix } from '../utils/planningSheetDate';
import {
  clusterShipmentGroupingRowsByGroup,
  matchGroupingRowsToContracts,
  parseShipmentGroupingMatrix,
  type ParsedShipmentGroupingRow,
} from '../utils/shipmentPreplannedGroupingUpload';
import { prefetchManualGroupingEligibleIdentities } from '../utils/shipmentPreplannedGroupingTemplateSql';
import { createManualPrePlannedGroup, type PrePlannedGroupDto } from './prePlannedGroup.service';
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

export type GroupingBulkUploadResult = {
  processedGroups: number;
  succeeded: number;
  failed: number;
  skippedWithoutY: number;
  groups: Array<{ group: string; groupCode: string; contractCount: number; totalOsMt: number }>;
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

  for (const cluster of clusters) {
    const clusterMatches = matchedOk.filter((m) => m.row.group.trim() === cluster.group);
    const contractIds = uniqueContractIds(clusterMatches);
    if (contractIds.length < 2) {
      failures.push({
        excelRowNumbers: rowNumbers(cluster.rows),
        group: cluster.group,
        reason: 'Same Group with 1 eligible PO (need at least 2)',
      });
      continue;
    }

    try {
      const group = await createManualPrePlannedGroup(contractIds, userId, {
        excelGroupLabel: cluster.group,
      });
      result.succeeded += 1;
      result.groups.push({
        group: cluster.group,
        groupCode: group.groupCode,
        contractCount: contractIds.length,
        totalOsMt: Number(group.totalOsMt) || 0,
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
  }

  result.failed = failures.length;
  return result;
}
