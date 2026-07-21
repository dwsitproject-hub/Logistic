/**
 * Materialize UNPLANNED trucking_operations (OP-LAND-…) for open-PO backlog
 * rows that appear on the Unplanned hybrid table without an Operation ID.
 */
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  allocateNextSyntheticSequenceDefault,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';
import { findActiveTruckingOpsByContractId } from '../utils/truckingOperationUniqueness';
import {
  appendTruckingUnplannedBacklogColumnFilters,
  appendTruckingUnplannedBacklogGlobalSearch,
  buildTruckingUnplannedBacklogIdsWithOsQuery,
  buildTruckingUnplannedContractToolbarScope,
} from '../utils/truckingUnplannedHybridSql';
import { parseColumnFiltersQuery } from '../utils/contractListFilters';
import { invalidateTruckingListCache } from './truckingList.service';

export interface EnsureUnplannedOpsResult {
  created: number;
  operationIds: string[];
  skippedActive: number;
}

function buildEnsureFilterParts(req: AuthRequest): {
  contractScopeSql: string;
  toolbarSql: string;
  params: unknown[];
} {
  const { dateFrom, dateTo, contract, plant } = req.query;
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);

  const scope = buildTruckingUnplannedContractToolbarScope({
    dateFrom,
    dateTo,
    contract,
    plants,
  });
  let idx = scope.params.length + 1;
  const g = appendTruckingUnplannedBacklogGlobalSearch(globalSearch, idx);
  idx = g.nextIndex;
  const c = appendTruckingUnplannedBacklogColumnFilters(colFilters, idx);
  return {
    contractScopeSql: scope.sql,
    params: [...scope.params, ...g.params, ...c.params],
    toolbarSql: `${g.sql}${c.sql}`,
  };
}

export async function ensureUnplannedTruckingOpsForRequest(
  req: AuthRequest,
): Promise<EnsureUnplannedOpsResult> {
  const { contractScopeSql, toolbarSql, params } = buildEnsureFilterParts(req);
  const text = buildTruckingUnplannedBacklogIdsWithOsQuery(contractScopeSql, toolbarSql);
  const backlog = await query(text, params);

  const dmy = formatDDMMYYYY(new Date());
  const operationIds: string[] = [];
  let skippedActive = 0;

  for (const row of backlog.rows) {
    const contractUuid = String(row.id);
    const active = await findActiveTruckingOpsByContractId(contractUuid);
    if (active.length > 0) {
      skippedActive += 1;
      continue;
    }

    const seq = await allocateNextSyntheticSequenceDefault('trucking_operations', 'LAND', dmy);
    const operationId = buildSyntheticOperationId('LAND', dmy, seq);

    await query(
      `INSERT INTO trucking_operations (
         contract_id, operation_id, status, daily_deliverables
       ) VALUES (
         $1::uuid, $2, 'UNPLANNED', '[]'::jsonb
       )`,
      [contractUuid, operationId],
    );
    operationIds.push(operationId);
  }

  if (operationIds.length > 0) {
    invalidateTruckingListCache();
    logger.info('ensureUnplannedTruckingOpsForRequest: created ops', {
      created: operationIds.length,
      skippedActive,
    });
  }

  return {
    created: operationIds.length,
    operationIds,
    skippedActive,
  };
}
