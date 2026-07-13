import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';
import { sqlTruckingPagePipelineStageExpr } from './truckingPagePipelineSql';
import { TRUCKING_REALIZATIONS_JOIN } from './truckingRealizationSql';
import {
  sqlTruckingExpandedStoLineQtyKgExpr,
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingPreferWbResolvedQty,
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
  outstanding: string;
  stoLineQty: string;
} {
  if (skipSapJoin) {
    return {
      qtyDelivered: 'e.quantity_delivered',
      qtyReceive: 'e.quantity_receive',
      outstanding: 'e.outstanding_quantity',
      stoLineQty: 'e.contract_qty',
    };
  }

  const qtyDeliveredPerStoSap = `(
    SELECT SUM(NULLIF(regexp_replace(COALESCE(
      NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivered'), ''),
      NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivery'), ''),
      ''
    ), '[^0-9\\.-]', '', 'g'), '')::numeric)
    FROM sap_processed_data spd
    WHERE spd.contract_number = e.contract_number
      AND ${SPD_EFFECTIVE_STO} = TRIM(e.sto_line_resolved::text)
      AND NULLIF(TRIM(COALESCE(
        spd.data->'raw'->>'Quantity Delivered',
        spd.data->'raw'->>'Quantity Delivery'
      )), '') IS NOT NULL
  )`;

  const qtyReceivePerStoSap = `(
    SELECT SUM(NULLIF(regexp_replace(COALESCE(
      NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
      NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
      ''
    ), '[^0-9\\.-]', '', 'g'), '')::numeric)
    FROM sap_processed_data spd
    WHERE spd.contract_number = e.contract_number
      AND ${SPD_EFFECTIVE_STO} = TRIM(e.sto_line_resolved::text)
      AND NULLIF(TRIM(COALESCE(
        spd.data->'raw'->>'Quantity Receive',
        spd.data->'raw'->>'Qty Receive'
      )), '') IS NOT NULL
  )`;

  const qtyDelivered = sqlTruckingPreferWbResolvedQty(
    'e.quantity_delivered',
    qtyDeliveredPerStoSap,
  );
  const qtyReceive = sqlTruckingPreferWbResolvedQty('e.quantity_receive', qtyReceivePerStoSap);
  const stoLineQty = sqlTruckingExpandedStoLineQtyKgExpr();
  const outstanding = sqlTruckingOutstandingQtyByIncoterm(
    qtyDelivered,
    qtyReceive,
    stoLineQty,
    'e.incoterm',
  );

  return {
    qtyDelivered,
    qtyReceive,
    outstanding,
    stoLineQty,
  };
}

function buildExpansionPagingCtes(paging: TruckingListStoExpansionPaging): string {
  const limit = Math.max(1, paging.limit);
  const offset = Math.max(0, paging.offset);
  const upper = offset + limit;
  return `
      expansion_keys AS (
        SELECT DISTINCT
          ts.id AS operation_id,
          COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) AS sto_line
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
        LEFT JOIN contract_sto_lines csl ON csl.contract_uuid = ts.contract_id
        WHERE COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) IS NOT NULL
      ),
      ranked_expansion AS (
        SELECT
          ek.operation_id,
          ek.sto_line,
          ROW_NUMBER() OVER (ORDER BY ${paging.orderBySql}) AS rn
        FROM expansion_keys ek
        INNER JOIN trucking_source ts ON ts.id = ek.operation_id
        INNER JOIN contracts c ON c.id = ts.contract_id
        LEFT JOIN contract_sto_lines csl
          ON csl.contract_uuid = ts.contract_id
          AND TRIM(csl.sto_line) = TRIM(ek.sto_line)
      ),
      paged_expansion AS (
        SELECT operation_id, sto_line
        FROM ranked_expansion
        WHERE rn > ${offset} AND rn <= ${upper}
      ),`;
}

function buildExpandedJoinSql(usePaging: boolean): string {
  if (!usePaging) {
    return `
      expanded AS (
        SELECT
          ts.*,
          COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) AS sto_line_resolved
        FROM trucking_source ts
        LEFT JOIN contract_sto_lines csl ON csl.contract_uuid = ts.contract_id
      )`;
  }

  return `
      expanded AS (
        SELECT
          ts.*,
          COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) AS sto_line_resolved
        FROM trucking_source ts
        LEFT JOIN contract_sto_lines csl ON csl.contract_uuid = ts.contract_id
        INNER JOIN paged_expansion pe
          ON pe.operation_id = ts.id
          AND TRIM(pe.sto_line) = TRIM(COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')))
      )`;
}

/**
 * Count expansion keys only — no SAP qty joins (toolbar-only fast path total).
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
        SELECT DISTINCT
          ts.id AS operation_id,
          COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) AS sto_line
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
        LEFT JOIN contract_sto_lines csl ON csl.contract_uuid = ts.contract_id
        WHERE COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) IS NOT NULL
      )
      SELECT COUNT(*)::bigint AS c FROM expansion_keys`;
}

/**
 * Expand trucking list rows — one row per contract STO (contract_stos + SAP FRC/LCO).
 * Delivery/receive prefer WB daily actuals when uploaded and GR PO/STO is Open;
 * when GR is Close, SAP per-STO qty is used. Outstanding follows the same resolved qty
 * (contract − delivered/receive by incoterm).
 */
export function buildTruckingListExpansionSql(
  innerSql: string,
  opts?: TruckingListStoExpansionOptions,
): string {
  const skipSapJoin = opts?.skipSapJoin === true;
  const selectOutstanding = opts?.selectOutstanding !== false;
  const paging = opts?.expansionPaging;
  const qty = buildQuantitySelects(skipSapJoin);
  const pagingBlock = paging ? buildExpansionPagingCtes(paging) : '';
  const filterTotalCol = paging
    ? ',\n        (SELECT COUNT(*)::bigint FROM expansion_keys) AS __filter_total'
    : '';

  return `
      WITH trucking_source AS (
        ${innerSql}
      ),
      ${buildContractStoLinesCte(skipSapJoin)},${pagingBlock}
      ${buildExpandedJoinSql(Boolean(paging))}
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
        ${sqlTruckingPagePipelineStageExpr(
          'c',
          `NULLIF(TRIM(e.sto_line_resolved::text), '')`,
          qty.outstanding,
        )} AS status,
        e.created_at,
        e.updated_at,
        e.contract_number,
        e.po_number,
        e.sto_line_resolved AS sto_number,
        e.sto_numbers,
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
      INNER JOIN trucking_operations t ON t.id = e.id
      ${TRUCKING_REALIZATIONS_JOIN}`;
}

/** @deprecated Use buildTruckingListExpansionSql — kept for existing call sites. */
export function wrapTruckingListQueryWithStoExpansion(
  innerSql: string,
  opts?: TruckingListStoExpansionOptions,
): string {
  return buildTruckingListExpansionSql(innerSql, opts);
}
