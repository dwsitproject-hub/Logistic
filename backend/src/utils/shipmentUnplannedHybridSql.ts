/**
 * Shipments page — Unplanned hybrid list (contract backlog + shipment execution rows).
 */

import {
  sqlIsContractSapCancelledExpr,
  sqlIsContractSapInactiveForShipmentBacklogExpr,
  sqlContractImportStatusExpr,
} from './contractDeliveryStatus';
import { sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import { sqlContractOutstandingFromFields, sqlQtyMoveJoinIncotermDelivery } from './sapIncotermMetrics';
import { appendRegionSiteFilter, sqlRegionSiteDisplayForContract, sqlRegionSiteRawForContract } from './regionSiteSql';
import { contractExtNoSubquery, resolvedPlantCodeSql } from './portDisplaySql';
import { parseColumnFiltersQuery, type ColumnFilterPayload } from './contractListFilters';
import {
  buildShipmentPageUnplannedOpenContractsCte,
  shipmentPageExcludeB2bChildCond,
  shipmentPagePipelineUnplannedRowPredicate,
  shipmentPipelineVesselKeyExpr,
  sqlContractHasNoRegisteredEtaExpr,
} from './shipmentPagePipelineSql';
import {
  buildShipmentPageSeaIncotermColumnSql,
  buildShipmentPageSeaIncotermScopeSql,
} from './shipmentIncotermScope';
import { contractInAcceptedUnlinkedPrePlannedGroupExistsSql } from './prePlannedEligibilitySql';
import { sqlContractSharesNumericStoWithActiveSeaShipmentExpr } from './seaStoSiblingSql';

import {
  buildShipmentContractBacklogOrderBy,
  buildShipmentContractBacklogOuterOrderBy,
} from './shipmentListSortSql';
import { isContractLatestSpdSnapshotFresh } from '../services/contractLatestSpdSnapshot.service';
import {
  LATEST_SPD_DERIVED_COLUMNS,
  latestSpdDerivedSelectList,
} from './contractLatestSpdDerivedSql';

export { buildShipmentPageUnplannedOpenContractsCte };

const CB_COL: Record<string, string> = {
  contract_numbers: 'c.contract_id',
  contract_number: 'c.contract_id',
  po_numbers: 'c.po_number',
  supplier: 'c.supplier',
  buyer: 'c.buyer',
  product: 'c.product',
  group_name: 'c.group_name',
  incoterm: 'c.incoterm',
  plant_site: sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number'),
  contract_date: 'c.contract_date',
  delivery_start: 'c.delivery_start_date',
  delivery_end: 'c.delivery_end_date',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
  created_at: 'c.created_at',
  status: `'UNPLANNED'`,
};

export function appendUnplannedContractBacklogGlobalSearch(
  searchTrim: string,
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  if (!searchTrim || searchTrim.length < 2) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  const p = startIndex;
  const likeExpr = `$${p}::text`;
  const sql = `
    AND (
      COALESCE(c.contract_id::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.po_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.supplier::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.product::text, '') ILIKE ${likeExpr}
      OR COALESCE(${sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number')}::text, '') ILIKE ${likeExpr}
    )`;
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 };
}

export function appendUnplannedContractBacklogColumnFilters(
  filters: ColumnFilterPayload,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let pi = startIndex;

  for (const [colId, raw] of Object.entries(filters)) {
    const expr = CB_COL[colId];
    if (!expr || !raw || typeof raw !== 'object') continue;
    const f = raw as ColumnFilterPayload[string];
    if (f.emptyOnly) {
      parts.push(` AND (${expr} IS NULL OR TRIM(${expr}::text) = '')`);
      continue;
    }
    if (f.type === 'text') {
      const v = String(f.value ?? '').trim();
      if (!v) continue;
      if (f.exact) {
        parts.push(` AND LOWER(TRIM(${expr}::text)) = LOWER($${pi}::text)`);
        params.push(v);
        pi += 1;
      } else {
        parts.push(` AND ${expr}::text ILIKE $${pi}`);
        params.push(`%${v}%`);
        pi += 1;
      }
      continue;
    }

    if (f.type === 'multi') {
      const vals = Array.isArray(f.values)
        ? f.values.filter((x) => x != null && String(x).trim() !== '')
        : [];
      const incBlank = Boolean(f.includeBlank);
      const ors: string[] = [];
      if (incBlank) {
        ors.push(`(${expr} IS NULL OR TRIM(${expr}::text) = '')`);
      }
      if (vals.length > 0) {
        ors.push(`${expr}::text = ANY($${pi}::text[])`);
        params.push(vals);
        pi += 1;
      }
      if (ors.length > 0) {
        parts.push(` AND (${ors.join(' OR ')})`);
      }
    }
  }
  return { sql: parts.join(''), params, nextIndex: pi };
}

/** Product / Incoterm toolbar filters on contract rows (summary unplanned + core scope). */
export function appendContractScopeToolbarFilters(
  filters: ColumnFilterPayload,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let pi = startIndex;

  for (const colId of ['product', 'incoterm', 'supplier'] as const) {
    const raw = filters[colId];
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as ColumnFilterPayload[string];
    if (f.type !== 'multi') continue;

    const expr =
      colId === 'product' ? 'c.product' : colId === 'incoterm' ? 'c.incoterm' : 'c.supplier';
    const vals = Array.isArray(f.values)
      ? f.values.filter((x) => x != null && String(x).trim() !== '')
      : [];
    const incBlank = Boolean(f.includeBlank);
    const ors: string[] = [];
    if (incBlank) {
      ors.push(`(${expr} IS NULL OR TRIM(${expr}::text) = '')`);
    }
    if (vals.length > 0) {
      ors.push(`${expr}::text = ANY($${pi}::text[])`);
      params.push(vals);
      pi += 1;
    }
    if (ors.length > 0) {
      parts.push(`(${ors.join(' OR ')})`);
    }
  }

  return {
    sql: parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '',
    params,
    nextIndex: pi,
  };
}

/**
 * Core WHERE for open CIF/FOB/CFR contracts without shipment and without registered ETA
 * (shared by Unplanned backlog and Preplanned backlog).
 */
export function contractBacklogCoreWhereSql(contractAlias = 'c', spdAlias = 'l'): string {
  return `
    ${buildShipmentPageSeaIncotermScopeSql(contractAlias)}
    AND NOT (${sqlIsContractSapInactiveForShipmentBacklogExpr(contractAlias)})
    AND ${shipmentPageExcludeB2bChildCond(spdAlias)}
    AND ${sqlContractHasNoRegisteredEtaExpr(contractAlias)}
    AND NOT EXISTS (
      SELECT 1 FROM shipments s_ns WHERE s_ns.contract_id = ${contractAlias}.id
    )
    AND NOT (${sqlContractSharesNumericStoWithActiveSeaShipmentExpr(`${contractAlias}.id`)})`;
}

/** Remaining OS ≤ 1.0 MT (1000 kg) → Completed card (no shipment row). */
export const BACKLOG_OS_COMPLETED_MAX_KG = 1000;

/** Clamp-at-zero remaining OS from joined `qty_move qm` (same formula as Unplanned OS). */
export function sqlBacklogRemainingOsJoinExpr(): string {
  return sqlContractOutstandingFromFields({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    receiveExpr: 'qm.quantity_receive',
    deliveryExpr: sqlQtyMoveJoinIncotermDelivery('c.incoterm', 'qm', 'c.transport_mode'),
    clampAtZero: true,
  });
}

/** Still Unplanned/Preplanned: remaining OS > 1 MT (missing qty_move → remaining = contract qty). */
export function sqlBacklogOsStillActiveSql(): string {
  return `(${sqlBacklogRemainingOsJoinExpr()}) > ${BACKLOG_OS_COMPLETED_MAX_KG}`;
}

/** PO backlog Completed: remaining OS ≤ 1 MT (over-delivery clamps to 0). */
export function sqlBacklogOsCompletedSql(): string {
  return `(${sqlBacklogRemainingOsJoinExpr()}) <= ${BACKLOG_OS_COMPLETED_MAX_KG}`;
}

function sqlBacklogOsStillActiveCorrelated(outstandingExpr: string): string {
  return `(${outstandingExpr}) > ${BACKLOG_OS_COMPLETED_MAX_KG}`;
}

function sqlBacklogOsCompletedCorrelated(outstandingExpr: string): string {
  return `(${outstandingExpr}) <= ${BACKLOG_OS_COMPLETED_MAX_KG}`;
}

/** Shared WHERE for Unplanned contract backlog (excludes Preplanned / ACCEPTED-unlinked). */
export function unplannedContractBacklogBaseWhereSql(contractAlias = 'c', spdAlias = 'l'): string {
  return `
    ${contractBacklogCoreWhereSql(contractAlias, spdAlias)}
    AND NOT ${contractInAcceptedUnlinkedPrePlannedGroupExistsSql(contractAlias)}`;
}

/** Shared WHERE for Preplanned contract backlog (ACCEPTED group, no shipment yet). */
export function preplannedContractBacklogBaseWhereSql(contractAlias = 'c', spdAlias = 'l'): string {
  return `
    ${contractBacklogCoreWhereSql(contractAlias, spdAlias)}
    AND ${contractInAcceptedUnlinkedPrePlannedGroupExistsSql(contractAlias)}`;
}

/** Open SEA PO without shipment — Unplanned + Preplanned members (Completed OS gate applied by caller). */
export function completedContractBacklogBaseWhereSql(contractAlias = 'c', spdAlias = 'l'): string {
  return contractBacklogCoreWhereSql(contractAlias, spdAlias);
}

/**
 * Cancelled SEA PO without any shipment row (Delete PO/STO / Cancelled import status).
 * Intentionally does NOT reuse open-backlog core (which excludes SAP-inactive contracts).
 */
export function cancelledContractBacklogBaseWhereSql(contractAlias = 'c', spdAlias = 'l'): string {
  return `
    ${buildShipmentPageSeaIncotermScopeSql(contractAlias)}
    AND ${sqlIsContractSapCancelledExpr(contractAlias)}
    AND ${shipmentPageExcludeB2bChildCond(spdAlias)}
    AND NOT EXISTS (
      SELECT 1 FROM shipments s_ns WHERE s_ns.contract_id = ${contractAlias}.id
    )`;
}

/** SELECT list aligned with shipment list row shape for contract backlog rows. */
/** SAP qty_move scalars — same CTE as OS (`sqlContractGlobalOutstandingExpr`). */
function qtyMoveScalarSql(
  column: 'quantity_delivery' | 'quantity_receive',
  contractNumberExpr = 'c.contract_id',
): string {
  return `(SELECT qm.${column} FROM qty_move qm WHERE qm.contract_number = ${contractNumberExpr})`;
}

export function unplannedContractBacklogRowSelectSql(
  outstandingExpr: string,
  statusLiteral: 'UNPLANNED' | 'PREPLANNED' | 'COMPLETED' | 'CANCELLED' = 'UNPLANNED',
  options?: { promoteLowOsToCompleted?: boolean },
): string {
  const plantCode = resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code');
  const plant = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const contractExtNoExpr = `COALESCE(
    NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), ''),
    ${contractExtNoSubquery('c.contract_id', 'c.po_number')}
  )`;
  const sapDelivery = qtyMoveScalarSql('quantity_delivery');
  const sapReceive = qtyMoveScalarSql('quantity_receive');
  const statusSql =
    options?.promoteLowOsToCompleted && statusLiteral !== 'COMPLETED'
      ? `CASE WHEN (${outstandingExpr}) <= ${BACKLOG_OS_COMPLETED_MAX_KG} THEN 'COMPLETED' ELSE '${statusLiteral}' END`
      : `'${statusLiteral}'::text`;
  return `
    c.id::text AS id,
    'contract_backlog'::text AS row_kind,
    ('contract:' || c.id::text) AS sto_key,
    NULL::text AS sto_number,
    NULL::text AS shipment_id,
    NULL::text AS operation_id,
    c.contract_id AS contract_number,
    c.contract_id AS contract_numbers,
    NULLIF(TRIM(c.po_number::text), '') AS po_numbers,
    c.supplier AS supplier,
    c.supplier AS suppliers,
    c.buyer AS buyer,
    c.buyer AS buyers,
    c.product AS product,
    c.product AS products,
    c.group_name AS group_name,
    c.group_name AS group_names,
    ${plantCode} AS plant_code,
    ${plant} AS plant_site,
    c.incoterm AS incoterm,
    c.contract_date AS contract_date,
    c.delivery_start_date AS delivery_start_date,
    c.delivery_end_date AS delivery_end_date,
    NULL::text AS vessel_name,
    NULL::text AS vessel_code,
    NULL::text AS vessel_owner,
    NULL::text AS port_of_loading,
    NULL::text AS port_of_discharge,
    NULL::date AS shipment_date,
    NULL::date AS arrival_date,
    0::numeric AS quantity_shipped,
    ${sapDelivery} AS quantity_delivered,
    NULL::numeric AS quantity_delivered_klip,
    0::numeric AS inbound_weight,
    0::numeric AS outbound_weight,
    0::numeric AS gain_loss_percentage,
    0::numeric AS gain_loss_amount,
    ${statusSql} AS status,
    FALSE AS is_contract_sap_closed,
    c.transport_mode AS transport_mode,
    (${sqlContractImportStatusExpr('c')}) AS import_status,
    c.created_at AS created_at,
    c.id::text AS contract_row_id,
    ${contractExtNoExpr} AS contract_ext_no,
    NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') AS contract_reference_po,
    1::bigint AS contract_count,
    NULL::date AS eta_arrival,
    NULL::date AS eta_berthed,
    NULL::date AS eta_loading_start,
    NULL::date AS eta_loading_complete,
    NULL::date AS eta_sailed,
    NULL::date AS eta_discharge_arrival,
    NULL::date AS eta_discharge_berthed,
    NULL::date AS eta_discharge_start,
    NULL::date AS eta_discharge_complete,
    NULL::date AS eta_vessel_complete_discharge,
    NULL::date AS ata_vessel_arrival_at_loading_port,
    NULL::date AS ata_vessel_berthed_at_loading_port,
    NULL::date AS ata_vessel_start_loading,
    NULL::date AS ata_vessel_completed_loading,
    NULL::date AS ata_vessel_sailed_from_loading_port,
    NULL::date AS ata_vessel_arrive_at_discharge_port,
    NULL::date AS ata_vessel_berthed_at_discharge_port,
    NULL::date AS ata_vessel_start_discharging,
    NULL::date AS ata_vessel_complete_discharge,
    c.quantity_ordered AS contract_qty,
    NULL::numeric AS sto_quantity,
    ${sapReceive} AS quantity_receive,
    ${sapDelivery} AS quantity_delivered_sap,
    NULL::numeric AS planning_qty,
    (${outstandingExpr})::numeric AS outstanding_qty_planning,
    (${outstandingExpr}) AS outstanding_quantity`;
}

/** LEFT JOIN active SUGGESTED pre-planned group (Grouping Suggestion column + sort). */
export function sqlSuggestedPrePlannedGroupJoin(contractAlias = 'c'): string {
  return `
    LEFT JOIN pre_planned_group_members pgm_sugg
      ON pgm_sugg.contract_id = ${contractAlias}.id
     AND pgm_sugg.released_at IS NULL
    LEFT JOIN pre_planned_groups pg_sugg
      ON pg_sugg.id = pgm_sugg.group_id
     AND pg_sugg.status = 'SUGGESTED'`;
}

export function backlogQueryNeedsSuggestedGroupJoin(sortKey: string): boolean {
  return sortKey === 'pre_planned_group';
}

function sqlUnplannedSuggestedGroupIdExpr(sortKey: string): string {
  return backlogQueryNeedsSuggestedGroupJoin(sortKey)
    ? 'pg_sugg.id::text'
    : 'NULL::text';
}

function sqlUnplannedSuggestedGroupCodeExpr(sortKey: string): string {
  return backlogQueryNeedsSuggestedGroupJoin(sortKey)
    ? 'pg_sugg.group_code'
    : 'NULL::text';
}

/**
 * The backlog latest-SPD CTE with its source resolved.
 *
 * Freshness is read here rather than threaded through eighteen call sites, matching how
 * resolveContractsQtyMoveCte is already used by these same builders. Callers that cannot await
 * pass the flag to buildUnplannedContractBacklogLatestSpdCte directly.
 */
export async function resolveUnplannedContractBacklogLatestSpdCte(): Promise<string> {
  return buildUnplannedContractBacklogLatestSpdCte(await isContractLatestSpdSnapshotFresh());
}

/**
 * Latest SAP row per contract, for the contract-backlog queries.
 *
 * `snapshotFresh` decides the source. `contract_latest_spd_snapshot` already holds exactly this -
 * one row per contract - and reading it avoids a full scan of `sap_processed_data`, which EXPLAIN
 * measured at 164,331 buffers in the completed and cancelled backlog counts (43% and 47% of each)
 * and 763,222 of the preplanned count's 771,573 (99%). This CTE is used by eleven queries, so the
 * source is chosen in one place.
 *
 * Two things make the swap output-preserving, both verified against all 18,711 contracts when the
 * same swap was made for the Shipments summary:
 *
 * - the snapshot has no `sto_number` column, but that first COALESCE arm adds nothing over the
 *   JSON arms - column and JSON-only forms agreed on every contract;
 * - the live form had no tiebreaker, so ties on `created_at` were broken arbitrarily and it
 *   disagreed with the snapshot on `effective_sto` for 1,484 contracts. `spd.id DESC` is now
 *   appended to the live form, which brought all projected columns to zero differences.
 *
 * The snapshot is unique per contract, so it needs no tiebreaker of its own.
 */
export function buildUnplannedContractBacklogLatestSpdCte(snapshotFresh: boolean): string {
  /**
   * When the snapshot is fresh, read its stored derived columns instead of re-deriving them.
   *
   * The projection below makes 26 `data->` accesses per row, and this CTE feeds 18 query sites.
   * Migration 161 stores the six results on the snapshot; reading them took the completed-backlog
   * count from 326,763 buffers to 214,555 (-34%), with identical results.
   */
  if (snapshotFresh) {
    return `
      latest_spd_contract AS (
        SELECT
          lss.contract_number,
          ${LATEST_SPD_DERIVED_COLUMNS.map((c) => `lss.${c}`).join(',\n          ')},
          lss.spd_created_at AS created_at
        FROM contract_latest_spd_snapshot lss
        WHERE lss.contract_number IS NOT NULL AND TRIM(lss.contract_number) != ''
      )`;
  }
  const source = 'sap_processed_data spd';
  const orderTail = ', spd.id DESC';
  return `
      latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          ${latestSpdDerivedSelectList('spd.data', 'spd.sto_number')},
          spd.created_at
        FROM ${source}
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST${orderTail}
      )`;
}

/**
 * Backlog count + contract qty + outstanding qty (kg) in one scan.
 */
export async function buildUnplannedContractBacklogCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): Promise<string> {
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  /** JOIN-based OS (same formula as correlated qty_move expr used on page rows). */
  const outstandingExpr = sqlContractOutstandingFromFields({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    receiveExpr: 'qm.quantity_receive',
    deliveryExpr: sqlQtyMoveJoinIncotermDelivery('c.incoterm', 'qm', 'c.transport_mode'),
    clampAtZero: true,
  });
  // The backlog predicate is the single most expensive thing in this query - EXPLAIN ANALYZE
  // 2026-09-04 put its Seq Scan on contracts at 22.3s of the query's 60.9s, with a planner cost
  // of 24.6M for an 18,612-row table (the predicate carries ~8 correlated SubPlans per row; the
  // whole plan has 92 SubPlans and 97 scans of sap_processed_data). It used to appear twice -
  // once scoping qty_move and once filtering the backlog rows - so all of that ran twice.
  // Materialise the matching contracts once and have both consumers read the CTE.
  //
  // Rewrite only, no semantic change: the same predicate over the same tables, evaluated once.
  // The final CTE keeps alias `c` so outstandingExpr and sqlBacklogOsStillActiveSql (both of
  // which reference c./qm. directly) are untouched, and rejoins on the PRIMARY KEY so the join
  // cannot fan out even if several contracts rows ever shared a contract_id. `l` is dropped from
  // the final CTE because only the predicate referenced it.
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte},
    unplanned_contract_backlog AS (
      SELECT
        c.id,
        c.quantity_ordered,
        (${outstandingExpr})::numeric AS outstanding_qty
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
      WHERE ${sqlBacklogOsStillActiveSql()}
    )
    SELECT
      COUNT(*)::bigint AS c,
      COALESCE(SUM(COALESCE(quantity_ordered, 0)), 0)::numeric AS contract_qty_kg,
      COALESCE(SUM(COALESCE(outstanding_qty, 0)), 0)::numeric AS outstanding_qty_kg
    FROM unplanned_contract_backlog`;
}

/**
 * ALL status hybrid: unplanned + preplanned contract backlog rows (no shipment yet).
 * Flat contract-level pagination — distinct from PREPLANNED card group paging.
 */
export async function buildAllHybridContractBacklogCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): Promise<string> {
  const unplannedWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const preplannedWhere = `${preplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  /**
   * Hot path for ALL hybrid list — keep this free of qty_move.
   * Card Unplanned OS uses buildUnplannedContractBacklogCountQuery (scoped) instead.
   */
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    unplanned_contract_backlog AS (
      SELECT c.id, c.quantity_ordered
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${unplannedWhere}
    ),
    preplanned_contract_backlog AS (
      SELECT c.id, c.quantity_ordered
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      INNER JOIN pre_planned_group_members pgm
        ON pgm.contract_id = c.id AND pgm.released_at IS NULL
      INNER JOIN pre_planned_groups pg
        ON pg.id = pgm.group_id
       AND pg.status = 'ACCEPTED'
       AND pg.shipment_id IS NULL
      WHERE ${preplannedWhere}
    ),
    all_contract_backlog AS (
      SELECT id, quantity_ordered FROM unplanned_contract_backlog
      UNION ALL
      SELECT id, quantity_ordered FROM preplanned_contract_backlog
    )
    SELECT
      COUNT(*)::bigint AS c,
      COALESCE(SUM(COALESCE(quantity_ordered, 0)), 0)::numeric AS contract_qty_kg,
      0::numeric AS outstanding_qty_kg
    FROM all_contract_backlog`;
}

function backlogPageSortNeedsQtyMove(sortKey: string): boolean {
  return (
    sortKey === 'outstanding_quantity' ||
    sortKey === 'outstanding_qty_planning' ||
    sortKey === 'quantity_delivered' ||
    sortKey === 'quantity_receive'
  );
}

export async function buildAllHybridContractBacklogPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
  sortKey = 'created_at',
  sortDir: 'ASC' | 'DESC' = 'DESC',
): Promise<string> {
  const unplannedWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const preplannedWhere = `${preplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const unplannedSelect = unplannedContractBacklogRowSelectSql(outstandingExpr, 'UNPLANNED', {
    promoteLowOsToCompleted: true,
  });
  const preplannedSelect = unplannedContractBacklogRowSelectSql(outstandingExpr, 'PREPLANNED', {
    promoteLowOsToCompleted: true,
  });
  const outerOrder = buildShipmentContractBacklogOuterOrderBy(sortKey, sortDir);

  /**
   * Page ids first (cheap), then qty_move only for those contracts.
   * OS-column sort still needs full qty_move before LIMIT.
   */
  if (!backlogPageSortNeedsQtyMove(sortKey)) {
    return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    all_contract_candidates AS (
      SELECT
        c.id AS contract_uuid,
        c.contract_id AS contract_number,
        c.contract_date,
        c.created_at,
        c.po_number AS po_numbers,
        c.plant_code AS plant_site,
        c.supplier,
        c.product,
        c.incoterm,
        c.delivery_start_date,
        c.delivery_end_date,
        c.quantity_ordered AS contract_qty,
        c.contract_id,
        COALESCE(NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), ''), '') AS contract_ext_no,
        'UNPLANNED'::text AS status,
        'UNPLANNED'::text AS backlog_status,
        ${sqlUnplannedSuggestedGroupIdExpr(sortKey)} AS pre_planned_group_id,
        ${sqlUnplannedSuggestedGroupCodeExpr(sortKey)} AS pre_planned_group_code
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      ${backlogQueryNeedsSuggestedGroupJoin(sortKey) ? sqlSuggestedPrePlannedGroupJoin('c') : ''}
      WHERE ${unplannedWhere}
      UNION ALL
      SELECT
        c.id AS contract_uuid,
        c.contract_id AS contract_number,
        c.contract_date,
        c.created_at,
        c.po_number AS po_numbers,
        c.plant_code AS plant_site,
        c.supplier,
        c.product,
        c.incoterm,
        c.delivery_start_date,
        c.delivery_end_date,
        c.quantity_ordered AS contract_qty,
        c.contract_id,
        COALESCE(NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), ''), '') AS contract_ext_no,
        'PREPLANNED'::text AS status,
        'PREPLANNED'::text AS backlog_status,
        pg.id::text AS pre_planned_group_id,
        pg.group_code AS pre_planned_group_code
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      INNER JOIN pre_planned_group_members pgm
        ON pgm.contract_id = c.id AND pgm.released_at IS NULL
      INNER JOIN pre_planned_groups pg
        ON pg.id = pgm.group_id
       AND pg.status = 'ACCEPTED'
       AND pg.shipment_id IS NULL
      WHERE ${preplannedWhere}
    ),
    paged_contracts AS (
      SELECT *
      FROM all_contract_candidates
      ORDER BY ${outerOrder}
      LIMIT ${limit} OFFSET ${offset}
    ),
    ${await resolveContractsQtyMoveCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_id FROM paged_contracts',
    })},
    all_contract_backlog AS (
      SELECT ${unplannedSelect},
        pc.pre_planned_group_id,
        pc.pre_planned_group_code
      FROM paged_contracts pc
      INNER JOIN contracts c ON c.id = pc.contract_uuid
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE pc.backlog_status = 'UNPLANNED'
      UNION ALL
      SELECT ${preplannedSelect},
        pc.pre_planned_group_id,
        pc.pre_planned_group_code
      FROM paged_contracts pc
      INNER JOIN contracts c ON c.id = pc.contract_uuid
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE pc.backlog_status = 'PREPLANNED'
    )
    SELECT * FROM all_contract_backlog
    ORDER BY ${outerOrder}`;
  }

  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE (${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql})
         OR (${preplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}
             AND EXISTS (
               SELECT 1
               FROM pre_planned_group_members pgm
               INNER JOIN pre_planned_groups pg ON pg.id = pgm.group_id
               WHERE pgm.contract_id = c.id
                 AND pgm.released_at IS NULL
                 AND pg.status = 'ACCEPTED'
                 AND pg.shipment_id IS NULL
             ))`,
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    ${qtyMoveCte},
    all_contract_backlog AS (
      SELECT ${unplannedSelect},
        ${sqlUnplannedSuggestedGroupIdExpr(sortKey)} AS pre_planned_group_id,
        ${sqlUnplannedSuggestedGroupCodeExpr(sortKey)} AS pre_planned_group_code
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      ${backlogQueryNeedsSuggestedGroupJoin(sortKey) ? sqlSuggestedPrePlannedGroupJoin('c') : ''}
      WHERE ${unplannedWhere}
      UNION ALL
      SELECT ${preplannedSelect},
        pg.id::text AS pre_planned_group_id,
        pg.group_code AS pre_planned_group_code
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      INNER JOIN pre_planned_group_members pgm
        ON pgm.contract_id = c.id AND pgm.released_at IS NULL
      INNER JOIN pre_planned_groups pg
        ON pg.id = pgm.group_id
       AND pg.status = 'ACCEPTED'
       AND pg.shipment_id IS NULL
      WHERE ${preplannedWhere}
    )
    SELECT * FROM all_contract_backlog
    ORDER BY ${outerOrder}
    LIMIT ${limit} OFFSET ${offset}`;
}

export async function buildUnplannedContractBacklogPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
  sortKey = 'created_at',
  sortDir: 'ASC' | 'DESC' = 'DESC',
): Promise<string> {
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const pageOrder = buildShipmentContractBacklogOrderBy(sortKey, sortDir);
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte},
    unplanned_contract_backlog AS (
      SELECT ${unplannedContractBacklogRowSelectSql(outstandingExpr, 'UNPLANNED')},
        ${sqlUnplannedSuggestedGroupIdExpr(sortKey)} AS pre_planned_group_id,
        ${sqlUnplannedSuggestedGroupCodeExpr(sortKey)} AS pre_planned_group_code
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      ${backlogQueryNeedsSuggestedGroupJoin(sortKey) ? sqlSuggestedPrePlannedGroupJoin('c') : ''}
      WHERE ${sqlBacklogOsStillActiveCorrelated(outstandingExpr)}
      ORDER BY ${pageOrder}
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT * FROM unplanned_contract_backlog`;
}

export async function buildPreplannedContractsCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): Promise<string> {
  const backlogWhere = `${preplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte},
    preplanned_contracts AS (
      SELECT
        c.id AS contract_uuid,
        c.quantity_ordered,
        (${outstandingExpr})::numeric AS outstanding_qty,
        (
          SELECT pg.id
          FROM pre_planned_group_members pgm
          INNER JOIN pre_planned_groups pg ON pg.id = pgm.group_id
          WHERE pgm.contract_id = c.id
            AND pgm.released_at IS NULL
            AND pg.status = 'ACCEPTED'
            AND pg.shipment_id IS NULL
          ORDER BY pg.group_code
          LIMIT 1
        ) AS group_id
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${sqlBacklogOsStillActiveCorrelated(outstandingExpr)}
    )
    SELECT
      COUNT(*)::bigint AS contract_count,
      COUNT(DISTINCT group_id)::bigint AS group_count,
      COALESCE(SUM(COALESCE(quantity_ordered, 0)), 0)::numeric AS contract_qty_kg,
      COALESCE(SUM(COALESCE(outstanding_qty, 0)), 0)::numeric AS outstanding_qty_kg
    FROM preplanned_contracts`;
}

export async function buildPreplannedContractsPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
): Promise<string> {
  const backlogWhere = `${preplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte},
    preplanned_contracts AS (
      SELECT
        ${unplannedContractBacklogRowSelectSql(outstandingExpr, 'PREPLANNED')},
        pg.id::text AS pre_planned_group_id,
        pg.group_code AS pre_planned_group_code
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      INNER JOIN pre_planned_group_members pgm
        ON pgm.contract_id = c.id AND pgm.released_at IS NULL
      INNER JOIN pre_planned_groups pg
        ON pg.id = pgm.group_id
       AND pg.status = 'ACCEPTED'
       AND pg.shipment_id IS NULL
      WHERE ${sqlBacklogOsStillActiveCorrelated(outstandingExpr)}
    ),
    preplanned_groups_page AS (
      SELECT pre_planned_group_id AS group_id
      FROM preplanned_contracts
      GROUP BY pre_planned_group_id
      ORDER BY MIN(pre_planned_group_code) ASC NULLS LAST,
               MIN(contract_date) DESC NULLS LAST,
               MIN(contract_number) ASC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT pc.*
    FROM preplanned_contracts pc
    WHERE pc.pre_planned_group_id IN (SELECT group_id FROM preplanned_groups_page)
    ORDER BY pc.pre_planned_group_code ASC NULLS LAST,
             pc.contract_date DESC NULLS LAST,
             pc.contract_number ASC`;
}

export async function buildCompletedContractBacklogCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): Promise<string> {
  const backlogWhere = `${completedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractOutstandingFromFields({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    receiveExpr: 'qm.quantity_receive',
    deliveryExpr: sqlQtyMoveJoinIncotermDelivery('c.incoterm', 'qm', 'c.transport_mode'),
    clampAtZero: true,
  });
  // Same duplication and same fix as buildUnplannedContractBacklogCountQuery - see the note there
  // for the measured cost of evaluating this predicate more than once.
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte},
    completed_contract_backlog AS (
      SELECT
        c.id,
        c.quantity_ordered,
        (${outstandingExpr})::numeric AS outstanding_qty
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
      WHERE ${sqlBacklogOsCompletedSql()}
    )
    SELECT
      COUNT(*)::bigint AS c,
      COALESCE(SUM(COALESCE(quantity_ordered, 0)), 0)::numeric AS contract_qty_kg,
      COALESCE(SUM(COALESCE(outstanding_qty, 0)), 0)::numeric AS outstanding_qty_kg
    FROM completed_contract_backlog`;
}

export async function buildCompletedContractBacklogPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
  sortKey = 'created_at',
  sortDir: 'ASC' | 'DESC' = 'DESC',
): Promise<string> {
  const backlogWhere = `${completedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const pageOrder = buildShipmentContractBacklogOrderBy(sortKey, sortDir);
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte},
    completed_contract_backlog AS (
      SELECT ${unplannedContractBacklogRowSelectSql(outstandingExpr, 'COMPLETED')}
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${sqlBacklogOsCompletedCorrelated(outstandingExpr)}
      ORDER BY ${pageOrder}
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT * FROM completed_contract_backlog`;
}

export async function buildCancelledContractBacklogCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): Promise<string> {
  const backlogWhere = `${cancelledContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    cancelled_contract_backlog AS (
      SELECT
        c.id,
        c.quantity_ordered
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    )
    SELECT
      COUNT(*)::bigint AS c,
      COALESCE(SUM(COALESCE(quantity_ordered, 0)), 0)::numeric AS contract_qty_kg,
      0::numeric AS outstanding_qty_kg
    FROM cancelled_contract_backlog`;
}

export async function buildCancelledContractBacklogPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
  sortKey = 'created_at',
  sortDir: 'ASC' | 'DESC' = 'DESC',
): Promise<string> {
  const backlogWhere = `${cancelledContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  /** Cancelled POs contribute 0 OS on Shipments cards (same as Contracts OS gate). */
  const outstandingExpr = '0';
  const pageOrder = buildShipmentContractBacklogOrderBy(sortKey, sortDir);
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}`,
  });
  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    ${qtyMoveCte},
    cancelled_contract_backlog AS (
      SELECT ${unplannedContractBacklogRowSelectSql(outstandingExpr, 'CANCELLED')}
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
      ORDER BY ${pageOrder}
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT * FROM cancelled_contract_backlog`;
}

/** Shipment-side unplanned filter (toolbar + unplanned execution predicate). */
export function unplannedShipmentExecutionOuterSql(toolbarOuterSql: string): string {
  return `${toolbarOuterSql} AND ${shipmentPagePipelineUnplannedRowPredicate('sb')} AND ${buildShipmentPageSeaIncotermColumnSql('sb.incoterm')}`;
}

export function buildUnplannedShipmentExecutionCountQuery(
  shipmentBaseCteSql: string,
  outerSql: string,
): string {
  return `
    ${shipmentBaseCteSql},
    filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${outerSql}
    )
    SELECT COUNT(*)::bigint AS c FROM filtered_shipments`;
}

/**
 * Distinct vessel names on Unplanned hybrid execution rows (toolbar scope).
 * Matches the shipment_execution slice of the Unplanned table — not contract backlog rows.
 */
export function buildUnplannedExecutionVesselNamesQuery(
  shipmentBaseCteSql: string,
  executionOuterSql: string,
): string {
  const vessel = shipmentPipelineVesselKeyExpr('sb.vessel_name');
  return `
    ${shipmentBaseCteSql},
    filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${executionOuterSql}
        AND COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'
    )
    SELECT ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${vessel} IS NOT NULL) AS unplanned_vessel_names
    FROM filtered_shipments sb`;
}

export function buildUnplannedContractBacklogTableCountCte(contractScopeSql = ''): string {
  return `,
      unplanned_contract_backlog_table AS (
        SELECT COUNT(*)::bigint AS backlog_count
        FROM contracts c
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')}
          ${contractScopeSql}
      ),
      preplanned_contract_table AS (
        SELECT
          COUNT(*)::bigint AS preplanned_contract_count,
          COUNT(DISTINCT pg.id)::bigint AS preplanned_group_count
        FROM contracts c
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        INNER JOIN pre_planned_group_members pgm
          ON pgm.contract_id = c.id AND pgm.released_at IS NULL
        INNER JOIN pre_planned_groups pg
          ON pg.id = pgm.group_id
         AND pg.status = 'ACCEPTED'
         AND pg.shipment_id IS NULL
        WHERE ${preplannedContractBacklogBaseWhereSql('c', 'l')}
          ${contractScopeSql}
      )`;
}

export function parseColumnFiltersFromQuery(raw: unknown): ColumnFilterPayload {
  return parseColumnFiltersQuery(raw);
}

/** Toolbar contract scope (date / plant / contract) with fresh $1… param indices. */
export function buildUnplannedContractToolbarScope(input: {
  dateFrom?: unknown;
  dateTo?: unknown;
  contract?: unknown;
  plants: string[];
}): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let cp = 1;

  if (input.dateFrom) {
    parts.push(`c.contract_date >= $${cp}`);
    params.push(input.dateFrom);
    cp += 1;
  }
  if (input.dateTo) {
    parts.push(`c.contract_date <= $${cp}`);
    params.push(input.dateTo);
    cp += 1;
  }
  if (input.contract) {
    parts.push(`c.contract_id = $${cp}`);
    params.push(input.contract);
    cp += 1;
  }
  const groupPlantFilter = appendRegionSiteFilter(
    input.plants,
    cp,
    sqlRegionSiteRawForContract('c.contract_id', 'c.po_number'),
  );
  if (groupPlantFilter.sql) {
    parts.push(groupPlantFilter.sql.replace(/^ AND /, ''));
    params.push(...groupPlantFilter.params);
  }

  const sql = parts.length > 0 ? `AND ${parts.join(' AND ')}` : '';
  return { sql, params };
}
