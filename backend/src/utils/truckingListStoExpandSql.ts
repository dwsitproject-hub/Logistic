import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

/**
 * Expand trucking list rows — one row per contract STO (contract_stos + SAP FRC/LCO).
 * Recomputes global contract outstanding and per-STO deliver/receive for the display STO.
 */
export function wrapTruckingListQueryWithStoExpansion(
  innerSql: string,
  opts?: { selectOutstanding?: boolean },
): string {
  const selectOutstanding = opts?.selectOutstanding !== false;
  const globalOutstanding = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'e.contract_qty',
    incotermExpr: 'e.incoterm',
    contractNumberExpr: 'e.contract_number',
  });

  const qtyDeliveredPerSto = `COALESCE((
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
  ), e.quantity_delivered, 0)`;

  const qtyReceivePerSto = `COALESCE((
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
  ), e.quantity_receive, 0)`;

  return `
      WITH trucking_source AS (
        ${innerSql}
      ),
      contract_sto_lines AS (
        SELECT DISTINCT c.id AS contract_uuid, TRIM(sto.sto_number) AS sto_line
        FROM trucking_source ts
        INNER JOIN contracts c ON c.id = ts.contract_id
        INNER JOIN (
          SELECT cs.contract_id, TRIM(cs.sto_number::text) AS sto_number
          FROM contract_stos cs
          WHERE cs.sto_number IS NOT NULL AND TRIM(cs.sto_number::text) != ''
          UNION
          SELECT c2.id, TRIM(${SPD_EFFECTIVE_STO}) AS sto_number
          FROM sap_processed_data spd
          INNER JOIN contracts c2 ON c2.contract_id = spd.contract_number
          WHERE spd.contract_number IS NOT NULL
            AND TRIM(spd.contract_number) != ''
            AND ${SPD_EFFECTIVE_STO} IS NOT NULL
            AND ${contractEffectiveIncotermExpr('c2')} IN ('FRC', 'LCO')
        ) sto ON sto.contract_id = c.id
      ),
      expanded AS (
        SELECT
          ts.*,
          COALESCE(csl.sto_line, NULLIF(TRIM(ts.sto_number::text), '')) AS sto_line_resolved
        FROM trucking_source ts
        LEFT JOIN contract_sto_lines csl ON csl.contract_uuid = ts.contract_id
      ),
      list_contracts AS (
        SELECT DISTINCT contract_number
        FROM expanded
        WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
      ),
      ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_number FROM list_contracts' })}
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
        ${qtyDeliveredPerSto} AS quantity_delivered,
        ${qtyReceivePerSto} AS quantity_receive,
        e.gain_loss_percentage,
        e.gain_loss_amount,
        e.oa_budget,
        e.oa_actual,
        e.status_db,
        e.status,
        e.created_at,
        e.updated_at,
        e.contract_number,
        e.po_number,
        e.sto_line_resolved AS sto_number,
        e.sto_numbers,
        e.contract_qty AS sto_quantity,
        e.contract_qty,
        e.contract_date,
        e.delivery_start_date,
        e.delivery_end_date,
        e.supplier,
        e.buyer,
        e.product,
        e.incoterm,
        e.group_name,
        ${selectOutstanding ? `${globalOutstanding} AS outstanding_quantity` : 'e.outstanding_quantity'},
        e.estimated_km,
        e.contract_ext_no,
        e.contract_import_status
      FROM expanded e`;
}
