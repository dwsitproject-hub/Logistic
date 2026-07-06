import {
  TRUCKING_REALIZATIONS_JOIN,
  sqlRealizationEndDate,
  sqlRealizationStartDate,
  sqlShellRealizationEndDate,
  sqlShellRealizationStartDate,
} from './truckingRealizationSql';
import { SQL_CONTRACT_IMPORT_STATUS } from './contractDeliveryStatus';
import { sqlTruckingPagePipelineStageExpr } from './truckingPagePipelineSql';
import {
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingQuantityDeliveredCoalesce,
  sqlTruckingQuantityReceiveCoalesce,
  sqlTruckingQuantitySentCoalesce,
} from './truckingQuantitySql';

/** Contract numbers on grouped STO / operation (no SAP). */
export const TRUCKING_LIST_CONTRACT_NUMBER_CASE = `
        CASE
          WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT cc.contract_id, ', ' ORDER BY cc.contract_id)
              FROM contracts cc
              WHERE UPPER(COALESCE(NULLIF(TRIM(cc.transport_mode), ''), 'LAND')) = 'LAND'
                AND NULLIF(TRIM(cc.sto_number::text), '') = NULLIF(TRIM(c.sto_number::text), '')
            )
          WHEN NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT cc2.contract_id, ', ' ORDER BY cc2.contract_id)
              FROM trucking_operations t2
              INNER JOIN contracts cc2 ON t2.contract_id = cc2.id
              WHERE NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
            )
          ELSE c.contract_id
        END`;

const TRUCKING_LIST_CONTRACT_EXT_NO_FULL = `
        CASE
          WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT NULLIF(TRIM(z.v), ''), ', ' ORDER BY NULLIF(TRIM(z.v), ''))
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS v
                FROM sap_processed_data spd
                WHERE spd.contract_number IN (
                  SELECT cc.contract_id
                  FROM contracts cc
                  WHERE UPPER(COALESCE(NULLIF(TRIM(cc.transport_mode), ''), 'LAND')) = 'LAND'
                    AND NULLIF(TRIM(cc.sto_number::text), '') = NULLIF(TRIM(c.sto_number::text), '')
                )
              ) z
              WHERE NULLIF(TRIM(z.v), '') IS NOT NULL
            )
          WHEN NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT NULLIF(TRIM(z.v), ''), ', ' ORDER BY NULLIF(TRIM(z.v), ''))
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS v
                FROM sap_processed_data spd
                WHERE spd.contract_number IN (
                  SELECT cc2.contract_id
                  FROM trucking_operations t2
                  INNER JOIN contracts cc2 ON t2.contract_id = cc2.id
                  WHERE NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
                )
              ) z
              WHERE NULLIF(TRIM(z.v), '') IS NOT NULL
            )
          ELSE
            (
              SELECT COALESCE(
                spd.data->'raw'->>'Contract Ext No',
                spd.data->>'Contract Ext No'
              )
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            )
        END`;

export const TRUCKING_LIST_B2B_LATERAL = `
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            spd.data->'contract'->>'contract_type',
            spd.data->>'B2B Flag',
            spd.data->'raw'->>'B2B Flag',
            spd.data->>'Contract Type'
          ) AS b2b_flag_raw,
          COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po_raw
        FROM sap_processed_data spd
        WHERE spd.contract_number = c.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ) b2b ON true`;

export const TRUCKING_LIST_STO_LATERAL = `
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers
        FROM (
          SELECT NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
        ) x
        WHERE x.effective_sto IS NOT NULL AND x.effective_sto != ''
      ) sa ON true`;

/** B2B child-contract exclusion — shell uses contract_type only (no SAP lateral). */
export function truckingListB2bExcludeSql(skipSapJoin: boolean): string {
  if (skipSapJoin) {
    return `
        AND NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(c.contract_type::text, '')), '')) = 'B2B'
        )`;
  }
  return `
        AND NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(b2b.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
          AND NULLIF(TRIM(COALESCE(b2b.contract_reference_po_raw, '')), '') IS NOT NULL
        )`;
}

export function buildTruckingListSelectClause(skipSapJoin: boolean): string {
  if (skipSapJoin) {
    return `
        t.id,
        t.operation_id,
        t.contract_id,
        t.location,
        t.loading_location,
        t.unloading_location,
        t.trucking_owner,
        t.cargo_readiness_date,
        t.daily_deliverables,
        t.trucking_start_date AS planning_start_date,
        t.trucking_completion_date AS planning_end_date,
        ${sqlShellRealizationStartDate()} AS realization_start_date,
        ${sqlShellRealizationEndDate()} AS realization_end_date,
        ${sqlShellRealizationStartDate()} AS trucking_start_date,
        ${sqlShellRealizationEndDate()} AS trucking_completion_date,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
        t.eta_delivery_start_date,
        t.eta_delivery_end_date,
        t.quantity_sent,
        t.quantity_delivered,
        t.quantity_delivered AS quantity_receive,
        t.gain_loss_percentage,
        t.gain_loss_amount,
        t.oa_budget,
        t.oa_actual,
        t.status AS status_db,
        ${sqlTruckingPagePipelineStageExpr(
          'c',
          `NULLIF(TRIM(COALESCE(NULLIF(TRIM(c.sto_number::text), ''), '')), '')`,
        )} AS status,
        t.created_at,
        t.updated_at,
        ${TRUCKING_LIST_CONTRACT_NUMBER_CASE} AS contract_number,
        c.po_number,
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), '') AS sto_number,
        NULL::text AS sto_numbers,
        c.quantity_ordered as sto_quantity,
        c.quantity_ordered as contract_qty,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.supplier,
        c.buyer,
        c.product,
        c.incoterm,
        c.group_name,
        c.source_type,
        ${sqlTruckingOutstandingQtyByIncoterm(
          'COALESCE(t.quantity_delivered, 0)',
          'COALESCE(t.quantity_delivered, 0)',
        )} AS outstanding_quantity,
        s.estimated_km,
        ${TRUCKING_LIST_CONTRACT_EXT_NO_FULL} AS contract_ext_no,
        ${SQL_CONTRACT_IMPORT_STATUS} AS contract_import_status`;
  }

  return `
        t.id,
        t.operation_id,
        t.contract_id,
        t.location,
        t.loading_location,
        t.unloading_location,
        t.trucking_owner,
        t.cargo_readiness_date,
        t.daily_deliverables,
        t.trucking_start_date AS planning_start_date,
        t.trucking_completion_date AS planning_end_date,
        ${sqlRealizationStartDate('c')} AS realization_start_date,
        ${sqlRealizationEndDate('c')} AS realization_end_date,
        ${sqlRealizationStartDate('c')} AS trucking_start_date,
        ${sqlRealizationEndDate('c')} AS trucking_completion_date,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
        t.eta_delivery_start_date,
        t.eta_delivery_end_date,
        ${sqlTruckingQuantitySentCoalesce()} AS quantity_sent,
        ${sqlTruckingQuantityDeliveredCoalesce()} AS quantity_delivered,
        ${sqlTruckingQuantityReceiveCoalesce()} AS quantity_receive,
        t.gain_loss_percentage,
        t.gain_loss_amount,
        t.oa_budget,
        t.oa_actual,
        t.status AS status_db,
        ${sqlTruckingPagePipelineStageExpr(
          'c',
          `NULLIF(TRIM(COALESCE(NULLIF(TRIM(c.sto_number::text), ''), sa.sto_numbers)), '')`,
        )} AS status,
        t.created_at,
        t.updated_at,
        ${TRUCKING_LIST_CONTRACT_NUMBER_CASE} AS contract_number,
        c.po_number,
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), sa.sto_numbers) AS sto_number,
        sa.sto_numbers AS sto_numbers,
        c.quantity_ordered as sto_quantity,
        c.quantity_ordered as contract_qty,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.supplier,
        c.buyer,
        c.product,
        c.incoterm,
        c.group_name,
        c.source_type,
        ${sqlTruckingOutstandingQtyByIncoterm(
          sqlTruckingQuantityDeliveredCoalesce(),
          sqlTruckingQuantityReceiveCoalesce(),
        )} AS outstanding_quantity,
        s.estimated_km,
        ${TRUCKING_LIST_CONTRACT_EXT_NO_FULL} AS contract_ext_no,
        ${SQL_CONTRACT_IMPORT_STATUS} AS contract_import_status`;
}

export function buildTruckingListFromClause(skipSapJoin: boolean): string {
  const stoJoin = skipSapJoin ? '' : TRUCKING_LIST_STO_LATERAL;
  const b2bJoin = skipSapJoin ? '' : TRUCKING_LIST_B2B_LATERAL;
  return `
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN shipments s ON t.shipment_id = s.id
      ${TRUCKING_REALIZATIONS_JOIN}
      ${b2bJoin}
      ${stoJoin}`;
}
