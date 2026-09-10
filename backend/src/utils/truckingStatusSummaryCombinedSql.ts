/**
 * Trucking Section 1 — single STO expansion for status counts, status-card qty,
 * status-card OS, and Outstanding Qty strip (execution rows).
 * Strip OS is one row per contract_number; card OS stays GROUP BY status × contract.
 */

import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';
import {
  sqlTruckingOsPerContractSelect,
  sqlTruckingOutstandingQtyAggregateSelect,
  sqlTruckingStripLineQtyExpr,
} from './truckingOutstandingQtySummarySql';

export interface TruckingStatusSummaryCombinedBuiltQuery {
  preOuterQuery: string;
  outerSql: string;
  innerParams: unknown[];
  outerParams: unknown[];
  skipSapJoin: boolean;
}

export interface TruckingStatusSummaryCombinedOptions {
  /** When false, skip row-count aggregates (daily summary already supplies counts). */
  includeCounts?: boolean;
  /**
   * Live expansion only for GR-Open POs. GR-Close contract qty comes from the daily
   * snapshot (WB cannot change those rows). Completed via OS-tolerance stays live.
   */
  grOpenOnly?: boolean;
}

/**
 * The `filtered` CTE, from the live STO expansion.
 *
 * This is the expensive half - measured 2026-09-10 at ~23-37s and ~3.0M root buffers, with
 * `SELECT count(*) FROM filtered` costing the same as the whole summary, so producing these rows
 * *is* the cost. It is separated from the aggregates below so a precomputed source can reuse them
 * verbatim rather than restating the rules and risking a drift nothing would catch.
 */
export function buildTruckingSection1FilteredCteFromExpansion(
  built: TruckingStatusSummaryCombinedBuiltQuery,
  opts: TruckingStatusSummaryCombinedOptions = {},
): string {
  const innerSql = `${built.preOuterQuery}${built.outerSql}`;
  const expanded = wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: true,
    skipSapJoin: false,
  });
  const grOpenFilter = opts.grOpenOnly
    ? 'AND COALESCE(trucking_source.is_contract_sap_closed, FALSE) = FALSE'
    : '';
  return `
    filtered AS (
      SELECT
        status,
        status_db,
        contract_number,
        contract_qty,
        outstanding_quantity,
        source_type,
        incoterm,
        trucking_start_date,
        trucking_completion_date
      FROM (
        ${expanded}
      ) trucking_source
      WHERE COALESCE(trucking_source.sap_presence, 'PRESENT') = 'PRESENT'
        ${grOpenFilter}
    )`;
}

/**
 * Everything computed over `filtered`, whatever produced it.
 *
 * Kept as one shared string on purpose: the dedup key is `contract_number`, which in the trucking
 * expansion is a STRING_AGG of every LAND contract sharing the STO, so `MAX(contract_qty)` has to
 * be taken over the whole group. Re-deriving that at a different grain silently inflates the
 * totals - measured, when it was tried per dimension row: 7 of 13 figures wrong,
 * completed_contract_qty by +2,018,490 kg. So any second source plugs in here and changes nothing
 * below this line.
 */
export const TRUCKING_SECTION1_AGGREGATE_CTES = `
    per_contract AS (
      SELECT
        status,
        contract_number,
        MAX(COALESCE(contract_qty, 0))::numeric AS contract_qty,
        GREATEST(0, MAX(COALESCE(outstanding_quantity, 0)))::numeric AS outstanding_quantity,
        MAX(NULLIF(TRIM(COALESCE(source_type::text, '')), '')) AS source_type,
        MAX(NULLIF(TRIM(COALESCE(incoterm::text, '')), '')) AS incoterm
      FROM filtered
      WHERE NULLIF(TRIM(COALESCE(contract_number::text, '')), '') IS NOT NULL
      GROUP BY status, contract_number
    ),
    status_counts AS (
      SELECT
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE status = 'UNPLANNED')::bigint AS unplanned_count,
        COUNT(*) FILTER (WHERE status = 'PLANNED')::bigint AS planned_count,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint AS in_progress_count,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled_count,
        COUNT(*) FILTER (WHERE status_db = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE status_db = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE status_db = 'UNLOADING')::bigint AS unloading_count
      FROM filtered
    ),
    contract_qty AS (
      SELECT
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'UNPLANNED'), 0)::numeric AS unplanned_contract_qty,
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'PLANNED'), 0)::numeric AS planned_contract_qty,
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'IN_PROGRESS'), 0)::numeric AS in_progress_contract_qty,
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'COMPLETED'), 0)::numeric AS completed_contract_qty,
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'CANCELLED'), 0)::numeric AS cancelled_contract_qty
      FROM per_contract
    ),
    status_outstanding AS (
      SELECT
        COALESCE(SUM(outstanding_quantity) FILTER (WHERE status = 'UNPLANNED'), 0)::numeric AS unplanned_outstanding_qty,
        COALESCE(SUM(outstanding_quantity) FILTER (WHERE status = 'PLANNED'), 0)::numeric AS planned_outstanding_qty,
        COALESCE(SUM(outstanding_quantity) FILTER (WHERE status = 'IN_PROGRESS'), 0)::numeric AS in_progress_outstanding_qty
      FROM per_contract
      WHERE status IN ('UNPLANNED', 'PLANNED', 'IN_PROGRESS')
    ),
    os_per_contract AS (
      ${sqlTruckingOsPerContractSelect({ fromSql: 'per_contract', alias: 'per_contract' })}
    ),
    os_execution AS (
      SELECT
        ${sqlTruckingOutstandingQtyAggregateSelect(
          sqlTruckingStripLineQtyExpr('status', 'contract_qty', 'outstanding_quantity'),
          'source_type',
          'incoterm',
        )},
        COALESCE(SUM(${sqlTruckingStripLineQtyExpr('status', 'contract_qty', 'outstanding_quantity')}), 0)::numeric AS card_total_kg
      FROM os_per_contract
    )`;

/** One STO expansion → counts + contract qty + card OS + strip OS (execution). */
export function buildTruckingStatusSummaryCombinedQuery(
  built: TruckingStatusSummaryCombinedBuiltQuery,
  opts: TruckingStatusSummaryCombinedOptions = {},
): { text: string; params: unknown[] } {
  const cteBlock = `${buildTruckingSection1FilteredCteFromExpansion(built, opts)},${TRUCKING_SECTION1_AGGREGATE_CTES}`;
  const text = buildTruckingSection1Sql(cteBlock, opts.includeCounts !== false);
  return { text, params: [...built.innerParams, ...built.outerParams] };
}

/**
 * The outer SELECT, shared by both sources.
 *
 * Extracted rather than copied so the snapshot path cannot come to report a different set of
 * figures - or the same figures in a different shape - from the live one. The parsers on the
 * service side read this column list by name, and there is only one of it.
 */
export function buildTruckingSection1Sql(cteBlock: string, includeCounts: boolean): string {
  const countSelect = includeCounts
    ? `sc.total_count,
        sc.unplanned_count,
        sc.planned_count,
        sc.in_progress_count,
        sc.completed_count,
        sc.cancelled_count,
        sc.loading_count,
        sc.in_transit_count,
        sc.unloading_count,`
    : '';

  const countJoin = includeCounts ? 'CROSS JOIN status_counts sc' : '';

  return `
    WITH ${cteBlock}
    SELECT
      ${countSelect}
      cq.unplanned_contract_qty,
      cq.planned_contract_qty,
      cq.in_progress_contract_qty,
      cq.completed_contract_qty,
      cq.cancelled_contract_qty,
      so.unplanned_outstanding_qty,
      so.planned_outstanding_qty,
      so.in_progress_outstanding_qty,
      oe.third_party_frc_kg,
      oe.third_party_lco_kg,
      oe.interco_frc_kg,
      oe.interco_lco_kg,
      oe.card_total_kg
    FROM contract_qty cq
    CROSS JOIN status_outstanding so
    CROSS JOIN os_execution oe
    ${countJoin}`;
}

/**
 * The same Section 1 figures, read from the precomputed rows instead of expanding them.
 *
 * `trucking_list_stage_snapshot` is written by the pipeline refresh from the very expansion this
 * used to run per request, and at the same grain - verified before building this: 6,496 rows for
 * the default YTD window, the identical count to the live `filtered` CTE. So only the source of
 * `filtered` changes; every rule above it is TRUCKING_SECTION1_AGGREGATE_CTES, unchanged.
 *
 * The dedup MAX stays at read time on purpose. `contract_number` is a STRING_AGG of every LAND
 * contract sharing the STO, so grouping any finer than the whole string inflates the totals -
 * measured at +2,018,490 kg on completed contract qty when it was tried per dimension row.
 *
 * `whereSql` is the caller's dimension scope, already parameterised; the same predicate
 * `loadTruckingStagePageFromSnapshot` applies to this table.
 */
export function buildTruckingSection1FromSnapshotQuery(opts: {
  tableName: string;
  whereSql: string;
  includeCounts?: boolean;
}): string {
  const filtered = `
    filtered AS (
      SELECT
        s.stage AS status,
        s.status_db,
        s.contract_number,
        s.contract_qty,
        s.outstanding_quantity,
        s.source_type,
        s.incoterm_eff AS incoterm,
        NULL::date AS trucking_start_date,
        NULL::date AS trucking_completion_date
      FROM ${opts.tableName} s
      ${opts.whereSql}
        AND COALESCE(s.sap_presence, 'PRESENT') = 'PRESENT'
    )`;
  return buildTruckingSection1Sql(
    `${filtered},${TRUCKING_SECTION1_AGGREGATE_CTES}`,
    opts.includeCounts === true,
  );
}
