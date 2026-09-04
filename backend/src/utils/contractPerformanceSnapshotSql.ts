import { buildLatePerformanceRowSetSql } from '../services/latePerformance.service';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import { resolveContractsStoAggCte } from '../services/contractStoAggSnapshot.service';
import { resolveContractsLatestSpdCte } from '../services/contractLatestSpdSnapshot.service';
import { sqlExcludeWithdrawnContracts } from './sapPresenceSql';

/**
 * Every `latest_spd_data` key the Contract Performance read path can reach, grouped by where it
 * lives in the SAP row JSON. Enumerated from the codebase rather than guessed, and safe to
 * enumerate because every access uses a literal key - nothing indexes the blob dynamically and
 * nothing enumerates it with Object.keys/entries/values (checked 2026-09-04).
 *
 * Why prune at all: the raw SAP row carries 80-90 columns, and storing it whole made 53MB of the
 * snapshot's 57MB TOAST. Selecting it cost ~980ms in the database plus JSON parsing in Node, so
 * the unfiltered default view sat at 3.3s while the same rows without the blob read in 20ms.
 *
 * Why prune in place instead of promoting these to real columns: the column keeps its name and
 * its shape, so every consumer - the SQL filters, the B2B-child exclusion, and the JS resolvers
 * that read spd.contract / spd.payment / spd.raw - keeps working untouched. Promoting them to
 * columns would mean rewiring all of those, on the code that decides delivery-end dates and
 * therefore late/on-time.
 *
 * Adding a new `latest_spd_data->...` reference anywhere on this page means adding the key here
 * too. The end-to-end check that catches a miss is comparing the aggregated summary/tree output
 * between the live and snapshot paths - a missing key changes the numbers, not just a raw field.
 */
export const CONTRACT_PERFORMANCE_SNAPSHOT_SPD_KEYS = {
  contract: [
    'company_code',
    'contract_reference_po',
    'contract_type',
    'due_date_delivery_end',
    'ltc_spot',
    'plant_code',
    'sea_land',
    'transport_mode',
  ],
  payment: [
    'dp_date',
    'dp_date_deviation_days',
    'due_date_payment',
    'payoff_date',
    'payoff_date_deviation_days',
  ],
  raw: [
    'Buyer',
    'CONTRACT REFF PO',
    'Company Code',
    'Contract Ext No',
    'Contract Reff PO Ini',
    'DP Date',
    'DP Date Deviation (Days) DP Date - Due Date',
    'Due Date Delivery (End)',
    'Due Date Delivery End',
    'Due Date Delivery\r\n(End)',
    'Due Date Payment',
    'Payoff Date',
    'Payoff Date Deviation (Days) Payoff Date - Due Date',
    'Plant Code',
    'Sea / Land',
    'Sea_Land',
    'Supplier',
    'company code',
    'plant code',
  ],
  top: [
    'B2B Flag',
    'Buyer',
    'CONTRACT REFF PO',
    'Company Code',
    'Contract Ext No',
    'Contract Reff PO Ini',
    'Supplier',
    'company code',
    'dp date',
    'due date payment',
    'payoff date',
  ],
} as const;

/**
 * SQL literal for a JSON key. Always the E'' form: one of these keys really does contain a
 * CR-LF ('Due Date Delivery\r\n(End)' - SAP exports it with the header wrapped), which a plain
 * '...' literal cannot carry.
 */
function sqlJsonKeyLiteral(key: string): string {
  const escaped = key
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `E'${escaped}'`;
}

/** Rebuilds `latest_spd_data` with only the keys above, preserving the original nesting. */
export function sqlPrunedLatestSpdData(srcExpr: string): string {
  const pairs = (keys: readonly string[], parentExpr: string) =>
    keys
      .map((k) => `${sqlJsonKeyLiteral(k)}, ${parentExpr}->>${sqlJsonKeyLiteral(k)}`)
      .join(',\n        ');

  return `jsonb_strip_nulls(jsonb_build_object(
        'contract', jsonb_build_object(
        ${pairs(CONTRACT_PERFORMANCE_SNAPSHOT_SPD_KEYS.contract, `${srcExpr}->'contract'`)}
        ),
        'payment', jsonb_build_object(
        ${pairs(CONTRACT_PERFORMANCE_SNAPSHOT_SPD_KEYS.payment, `${srcExpr}->'payment'`)}
        ),
        'raw', jsonb_build_object(
        ${pairs(CONTRACT_PERFORMANCE_SNAPSHOT_SPD_KEYS.raw, `${srcExpr}->'raw'`)}
        ),
        ${pairs(CONTRACT_PERFORMANCE_SNAPSHOT_SPD_KEYS.top, srcExpr)}
      ))`;
}

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
  const selectCols = CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS.map((c) =>
    c === 'latest_spd_data'
      ? `${sqlPrunedLatestSpdData('rs.latest_spd_data')} AS latest_spd_data`
      : `rs.${c}`,
  ).join(', ');

  return `
    INSERT INTO contract_performance_snapshot (${cols})
    SELECT ${selectCols}
    FROM (
${rowSet}
    ) rs
  `;
}
