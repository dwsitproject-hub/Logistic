import { buildLatePerformanceRowSetSql } from '../services/latePerformance.service';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import { resolveContractsStoAggCte } from '../services/contractStoAggSnapshot.service';
import { resolveContractsLatestSpdCte } from '../services/contractLatestSpdSnapshot.service';
import { sqlExcludeWithdrawnContracts } from './sapPresenceSql';

/** Column order shared by the INSERT and the row-set SELECT - see the SELECT list note below. */
export const CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS = [
  'contract_id',
  'contract_date',
  'id',
  'product',
  'group_name',
  'supplier',
  'incoterm',
  'quantity_ordered',
  'transport_mode',
  'source_type',
  'status',
  'plant_code',
  'plant_site',
  'company_name',
  'import_status',
  'delivery_end_date',
  'cargo_readiness_date',
  'latest_spd_data',
  'total_sto_quantity',
  'quantity_delivery',
  'quantity_receive',
  'quantity_delivery_sap',
  'outstanding_quantity',
  'last_trucking_daily_deliverable_date',
  'last_trucking_completion_date',
  'last_trucking_wb_actuals_date',
  'last_ata_vessel_complete_discharge',
  'last_eta_vessel_complete_discharge',
  'open_standard_eta_trucking',
  'open_standard_eta_vessel_loading',
  'in_logistics_open_os',
] as const;

/**
 * INSERT that rebuilds the Contract Performance snapshot from the same builder the live query
 * uses, so the materialised values cannot drift from the computed ones.
 *
 * Scope is deliberately everything except withdrawn contracts: no date range and no user filters.
 * A contract's row is date-independent, so one global snapshot serves every date range and every
 * filter combination, and the read path keeps applying filters and the B2B-child /
 * PO-placeholder exclusions exactly as it does today.
 *
 * `sqlExcludeWithdrawnContracts` stays in scope because it is not a user filter: a contract whose
 * PO was cancelled or deleted in SAP is permanently out of the late/on-time population, and
 * leaving it in would put permanently-unfulfillable contracts in the denominator. It can change
 * on import, which is exactly when the snapshot is refreshed.
 *
 * The column list is written out explicitly rather than relying on `base.*` ordering: the
 * row-set builder emits contract_date immediately after contract_id (via extraBaseColumns), and
 * an INSERT that silently depended on that position would break the moment the base SELECT list
 * is reordered.
 */
export async function buildContractPerformanceSnapshotRefreshSql(): Promise<string> {
  const [contractsQtyMoveCte, contractsStoAggCte, contractsLatestSpdCte] = await Promise.all([
    resolveContractsQtyMoveCte('contract_scope'),
    resolveContractsStoAggCte('contract_scope'),
    resolveContractsLatestSpdCte('contract_scope'),
  ]);

  const rowSet = buildLatePerformanceRowSetSql({
    contractScopeWhere: sqlExcludeWithdrawnContracts('c'),
    contractsLatestSpdCte,
    contractsQtyMoveCte,
    contractsStoAggCte,
    extraBaseColumns: '          MAX(c.contract_date) AS contract_date,\n',
  });

  const cols = CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS.join(', ');
  const selectCols = CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS.map((c) => `rs.${c}`).join(', ');

  return `
    INSERT INTO contract_performance_snapshot (${cols})
    SELECT ${selectCols}
    FROM (
${rowSet}
    ) rs
  `;
}
