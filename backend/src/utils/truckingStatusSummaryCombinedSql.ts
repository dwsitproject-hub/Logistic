/**
 * Trucking Section 1 — single STO expansion for status counts, status-card qty,
 * status-card OS, and Outstanding Qty strip (execution rows).
 */

import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';
import {
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

function buildTruckingExpandedFilteredCte(
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
    ),
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
    os_execution AS (
      SELECT
        ${sqlTruckingOutstandingQtyAggregateSelect(
          sqlTruckingStripLineQtyExpr('status', 'contract_qty', 'outstanding_quantity'),
          'source_type',
          'incoterm',
        )},
        COALESCE(SUM(${sqlTruckingStripLineQtyExpr('status', 'contract_qty', 'outstanding_quantity')}), 0)::numeric AS card_total_kg
      FROM per_contract
      WHERE status IN ('UNPLANNED', 'PLANNED', 'IN_PROGRESS')
    )`;
}

/** One STO expansion → counts + contract qty + card OS + strip OS (execution). */
export function buildTruckingStatusSummaryCombinedQuery(
  built: TruckingStatusSummaryCombinedBuiltQuery,
  opts: TruckingStatusSummaryCombinedOptions = {},
): { text: string; params: unknown[] } {
  const includeCounts = opts.includeCounts !== false;
  const cteBlock = buildTruckingExpandedFilteredCte(built, opts);

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

  const text = `
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

  return { text, params: [...built.innerParams, ...built.outerParams] };
}
