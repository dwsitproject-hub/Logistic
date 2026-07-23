import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';
import { sqlTruckingPageIsCompletedExpr, sqlTruckingPagePipelineStageExpr } from './truckingPagePipelineSql';
import { TRUCKING_REALIZATIONS_JOIN } from './truckingRealizationSql';
import {
  sqlTruckingExpandedStoLineQtyKgExpr,
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingPoLevelSapDeliveryQty,
  sqlTruckingPoLevelSapReceiveQty,
  sqlTruckingResolvedDeliveryQty,
  sqlTruckingResolvedReceiveQty,
} from './truckingQuantitySql';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

import { sqlTruckingEligibleStoLineWhere } from './truckingListStoEligibleSql';

export interface TruckingListStoExpansionPaging {
  limit: number;
  offset: number;
  orderBySql: string;
}

export interface TruckingListStoExpansionOptions {
  selectOutstanding?: boolean;
  /** When true, skip SAP lateral/subqueries — shell list only. */
  skipSapJoin?: boolean;
  /** Pre-page expansion keys before SAP qty joins (toolbar-only fast path). */
  expansionPaging?: TruckingListStoExpansionPaging;
  /**
   * Read each row's pipeline stage from trucking_list_stage_snapshot (populated by the
   * same daily refresh that feeds the Summary Trucking Status circles) so status
   * filters, totals and row badges agree with the circles regardless of skipSapJoin.
   * Callers must gate this on the trucking daily summary being fresh, and it must stay
   * OFF for the refresh source query itself (which defines the snapshot).
   */
  useStageSnapshot?: boolean;
  /**
   * Restrict the expansion to an already-resolved page of row keys (from the stage
   * snapshot). Bypasses expansion_keys/ranked_expansion; the caller supplies totals.
   * Grain is one key per operation (PO); stoLine is ignored when joining.
   */
  resolvedExpansionKeys?: Array<{ operationId: string; stoLine?: string }>;
}

/** Aggregated STO display for a trucking_source / expanded row (comma-separated). */
export function sqlTruckingAggregatedStoLinesExpr(
  contractIdExpr = 'ts.contract_id',
  fallbackStoExpr = 'ts.sto_number',
): string {
  return `COALESCE(
    (
      SELECT STRING_AGG(DISTINCT csl.sto_line, ', ' ORDER BY csl.sto_line)
      FROM contract_sto_lines csl
      WHERE csl.contract_uuid = ${contractIdExpr}
    ),
    NULLIF(TRIM(${fallbackStoExpr}::text), '')
  )`;
}

export function buildContractStoLinesCte(skipSapJoin: boolean): string {
  const eligible = sqlTruckingEligibleStoLineWhere('c', 'TRIM(cs.sto_number::text)', skipSapJoin);
  if (skipSapJoin) {
    return `
      contract_sto_lines AS (
        SELECT DISTINCT c.id AS contract_uuid, TRIM(cs.sto_number::text) AS sto_line
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
        INNER JOIN contract_stos cs ON cs.contract_id = c.id
        WHERE cs.sto_number IS NOT NULL AND TRIM(cs.sto_number::text) != ''
          AND ${eligible}
      )`;
  }

  return `
      contract_sto_lines AS (
        SELECT DISTINCT c.id AS contract_uuid, TRIM(sto.sto_number) AS sto_line
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
        INNER JOIN (
          SELECT cs.contract_id, TRIM(cs.sto_number::text) AS sto_number
          FROM contract_stos cs
          INNER JOIN contracts c_cs ON c_cs.id = cs.contract_id
          WHERE cs.sto_number IS NOT NULL AND TRIM(cs.sto_number::text) != ''
            AND ${sqlTruckingEligibleStoLineWhere('c_cs', 'TRIM(cs.sto_number::text)', true)}
          UNION
          SELECT c2.id, TRIM(${SPD_EFFECTIVE_STO}) AS sto_number
          FROM sap_processed_data spd
          INNER JOIN contracts c2 ON c2.contract_id = spd.contract_number
          WHERE spd.contract_number IS NOT NULL
            AND TRIM(spd.contract_number) != ''
            AND ${SPD_EFFECTIVE_STO} IS NOT NULL
            AND ${contractEffectiveIncotermExpr('c2')} IN ('FRC', 'LCO')
            AND ${sqlTruckingEligibleStoLineWhere('c2', `TRIM(${SPD_EFFECTIVE_STO})`, false)}
        ) sto ON sto.contract_id = c.id
      )`;
}

function buildQuantitySelects(skipSapJoin: boolean): {
  qtyDelivered: string;
  qtyReceive: string;
  /** Display column — null in shell so first paint does not show misleading op-level qty. */
  outstanding: string;
  /** Pipeline stage still needs op-level OS until SAP hydrate (snapshot usually wins). */
  outstandingForStage: string;
  stoLineQty: string;
} {
  if (skipSapJoin) {
    return {
      qtyDelivered: 'NULL::numeric',
      qtyReceive: 'NULL::numeric',
      outstanding: 'NULL::numeric',
      outstandingForStage: 'e.outstanding_quantity',
      stoLineQty: 'NULL::numeric',
    };
  }

  // PO-grain: sum SAP Delivery/Receive across all STOs for the PO.
  const qtyDeliveredPoSap = sqlTruckingPoLevelSapDeliveryQty(
    'e.contract_number',
    'e.contract_id',
    'e.po_number',
  );
  const qtyReceivePoSap = sqlTruckingPoLevelSapReceiveQty(
    'e.contract_number',
    'e.contract_id',
    'e.po_number',
  );

  const qtyDelivered = sqlTruckingResolvedDeliveryQty(
    'COALESCE(e.quantity_delivered, 0)',
    qtyDeliveredPoSap,
    'e.id',
    'c',
  );
  const qtyReceive = sqlTruckingResolvedReceiveQty(
    'COALESCE(e.quantity_receive, e.quantity_delivered, 0)',
    qtyReceivePoSap,
    'e.id',
    'c',
  );
  const stoLineQty = sqlTruckingExpandedStoLineQtyKgExpr();
  // OS = Contract Qty − Σ Delivery (LCO) / Σ Receive (FRC) across all STOs on the PO.
  const outstanding = sqlTruckingOutstandingQtyByIncoterm(
    qtyDelivered,
    qtyReceive,
    'COALESCE(e.contract_qty, 0)',
    'e.incoterm',
  );

  return {
    qtyDelivered,
    qtyReceive,
    outstanding,
    outstandingForStage: outstanding,
    stoLineQty,
  };
}

/** paged_expansion from explicit keys (stage-snapshot fast path). Quotes are escaped. */
function buildResolvedExpansionKeysCte(
  keys: Array<{ operationId: string; stoLine?: string }>,
): string {
  if (keys.length === 0) {
    return `
      paged_expansion AS (
        SELECT NULL::uuid AS operation_id WHERE FALSE
      ),`;
  }
  // Dedupe by operation — snapshot may still carry legacy sto_line columns.
  const seen = new Set<string>();
  const values: string[] = [];
  for (const k of keys) {
    const op = String(k.operationId).replace(/'/g, "''");
    if (seen.has(op)) continue;
    seen.add(op);
    values.push(`('${op}'::uuid)`);
  }
  if (values.length === 0) {
    return `
      paged_expansion AS (
        SELECT NULL::uuid AS operation_id WHERE FALSE
      ),`;
  }
  return `
      paged_expansion AS (
        SELECT v.operation_id
        FROM (VALUES ${values.join(', ')}) v(operation_id)
      ),`;
}

function buildExpansionPagingCtes(paging: TruckingListStoExpansionPaging): string {
  const limit = Math.max(1, paging.limit);
  const offset = Math.max(0, paging.offset);
  const upper = offset + limit;
  return `
      expansion_keys AS (
        SELECT DISTINCT ts.id AS operation_id
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
      ),
      ranked_expansion AS (
        SELECT
          ek.operation_id,
          ROW_NUMBER() OVER (ORDER BY ${paging.orderBySql}) AS rn
        FROM expansion_keys ek
        INNER JOIN trucking_source ts ON ts.id = ek.operation_id
        INNER JOIN contracts c ON c.id = ts.contract_id
      ),
      paged_expansion AS (
        SELECT operation_id
        FROM ranked_expansion
        WHERE rn > ${offset} AND rn <= ${upper}
      ),`;
}

function buildExpandedJoinSql(usePaging: boolean): string {
  const stoAgg = sqlTruckingAggregatedStoLinesExpr('ts.contract_id', 'ts.sto_number');
  if (!usePaging) {
    return `
      expanded AS (
        SELECT
          ts.*,
          ${stoAgg} AS sto_line_resolved
        FROM trucking_source ts
      )`;
  }

  return `
      expanded AS (
        SELECT
          ts.*,
          ${stoAgg} AS sto_line_resolved
        FROM trucking_source ts
        INNER JOIN paged_expansion pe ON pe.operation_id = ts.id
      )`;
}

/**
 * Count expansion keys only — no SAP qty joins (toolbar-only fast path total).
 * Grain is one key per trucking operation (PO).
 */
export function buildTruckingExpansionKeysCountSql(
  innerSql: string,
  skipSapJoin: boolean,
): string {
  return `
      WITH trucking_source AS (
        ${innerSql}
      ),
      ${buildContractStoLinesCte(skipSapJoin)},
      expansion_keys AS (
        SELECT DISTINCT ts.id AS operation_id
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
      )
      SELECT COUNT(*)::bigint AS c FROM expansion_keys`;
}

/**
 * Trucking list rows — one row per operation / PO (multi-STO aggregated).
 * Delivery/receive: GR Open + WB upload → op-level WB; GR Close → SAP sum (latest per STO on the PO).
 * Outstanding = Contract Qty − Σ delivered/receive by incoterm (not per-STO).
 */
export function buildTruckingListExpansionSql(
  innerSql: string,
  opts?: TruckingListStoExpansionOptions,
): string {
  const skipSapJoin = opts?.skipSapJoin === true;
  const selectOutstanding = opts?.selectOutstanding !== false;
  const useStageSnapshot = opts?.useStageSnapshot === true;
  const resolvedKeys = opts?.resolvedExpansionKeys;
  const paging = resolvedKeys ? undefined : opts?.expansionPaging;
  const qty = buildQuantitySelects(skipSapJoin);
  const pagingBlock = resolvedKeys
    ? buildResolvedExpansionKeysCte(resolvedKeys)
    : paging
      ? buildExpansionPagingCtes(paging)
      : '';
  const filterTotalCol = paging
    ? ',\n        (SELECT COUNT(*)::bigint FROM expansion_keys) AS __filter_total'
    : '';

  // Prefer aggregated sto_line_resolved; fall back to pre-joined sto_numbers.
  const stoDisplay = `COALESCE(
        NULLIF(TRIM(e.sto_line_resolved::text), ''),
        NULLIF(TRIM(e.sto_numbers::text), '')
      )`;

  return `
      WITH trucking_source AS (
        ${innerSql}
      ),
      ${buildContractStoLinesCte(skipSapJoin)},${pagingBlock}
      ${buildExpandedJoinSql(Boolean(paging) || Boolean(resolvedKeys))}
      SELECT
        e.id,
        e.operation_id,
        e.contract_id,
        e.location,
        e.loading_location,
        e.unloading_location,
        e.trucking_owner,
        e.cargo_readiness_date,
        e.daily_deliverables,
        e.planning_start_date,
        e.planning_end_date,
        e.realization_start_date,
        e.realization_end_date,
        e.trucking_start_date,
        e.trucking_completion_date,
        e.eta_trucking_start_date,
        e.eta_trucking_completion_date,
        e.eta_delivery_start_date,
        e.eta_delivery_end_date,
        e.quantity_sent,
        ${qty.qtyDelivered} AS quantity_delivered,
        ${qty.qtyReceive} AS quantity_receive,
        e.gain_loss_percentage,
        e.gain_loss_amount,
        e.oa_budget,
        e.oa_actual,
        e.status_db,
        ${
          useStageSnapshot
            ? `CASE
          WHEN ${sqlTruckingPageIsCompletedExpr('c', qty.outstandingForStage)} THEN 'COMPLETED'
          ELSE COALESCE(sn.stage, ${sqlTruckingPagePipelineStageExpr(
            'c',
            `NULLIF(TRIM((${stoDisplay})::text), '')`,
            qty.outstandingForStage,
          )})
        END`
            : sqlTruckingPagePipelineStageExpr(
                'c',
                `NULLIF(TRIM((${stoDisplay})::text), '')`,
                qty.outstandingForStage,
              )
        } AS status,
        e.created_at,
        e.updated_at,
        e.contract_number,
        e.po_number,
        ${stoDisplay} AS sto_number,
        COALESCE(NULLIF(TRIM(e.sto_numbers::text), ''), ${stoDisplay}) AS sto_numbers,
        ${qty.stoLineQty} AS sto_quantity,
        e.contract_qty,
        e.contract_date,
        e.delivery_start_date,
        e.delivery_end_date,
        e.supplier,
        e.buyer,
        e.product,
        e.incoterm,
        e.group_name,
        e.source_type,
        ${selectOutstanding ? `${qty.outstanding} AS outstanding_quantity` : 'e.outstanding_quantity'},
        e.estimated_km,
        e.contract_ext_no,
        e.contract_import_status${filterTotalCol}
      FROM expanded e
      INNER JOIN contracts c ON c.id = e.contract_id
      INNER JOIN trucking_operations t ON t.id = e.id${
        useStageSnapshot
          ? `
      LEFT JOIN trucking_list_stage_snapshot sn
        ON sn.operation_id = e.id`
          : ''
      }
      ${TRUCKING_REALIZATIONS_JOIN}`;
}

/** @deprecated Use buildTruckingListExpansionSql — kept for existing call sites. */
export function wrapTruckingListQueryWithStoExpansion(
  innerSql: string,
  opts?: TruckingListStoExpansionOptions,
): string {
  return buildTruckingListExpansionSql(innerSql, opts);
}
