import { groupPlantExpr } from '../utils/groupPlantSql';
import {
  sqlContractOutstandingSignedExpr,
  sqlSapGrPoStatusFromJson,
  sqlSapGrStoStatusFromJson,
} from '../utils/sapIncotermMetrics';
import { buildContractsListOuterCycleFieldSelectSql } from '../utils/contractsListCycleSql';

const CONTRACT_LIST_OUTSTANDING_SQL = sqlContractOutstandingSignedExpr({
  contractQtyExpr: 'base.quantity_ordered',
  incotermExpr: 'base.incoterm',
  receiveExpr: 'base.quantity_receive',
  deliveryExpr: 'base.quantity_delivery_sap',
});

export type ContractsListOuterSqlOptions = {
  /** Skip payments-table fallbacks and logistics/doc COUNT subqueries (Contract Performance list). */
  compact?: boolean;
};

const CONTRACTS_LIST_PAYMENT_AND_COUNT_PROJECTION = `
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'due_date_payment'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Due Date Payment'), ''), NULLIF(trim(base.latest_spd_data->>'due date payment'), '')) AS due_date_payment_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'dp_date'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'DP Date'), ''), NULLIF(trim(base.latest_spd_data->>'dp date'), '')) AS dp_date_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'payoff_date'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Payoff Date'), ''), NULLIF(trim(base.latest_spd_data->>'payoff date'), '')) AS payoff_date_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'dp_date_deviation_days'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'DP Date Deviation (Days) DP Date - Due Date'), '')) AS dp_date_deviation_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'payoff_date_deviation_days'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Payoff Date Deviation (Days) Payoff Date - Due Date'), '')) AS payoff_date_deviation_raw,
        (SELECT p.payment_due_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS due_date_payment_fb,
        (SELECT p.dp_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS dp_date_fb,
        (SELECT p.payoff_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS payoff_date_fb,
        (SELECT (p.dp_date::date - p.payment_due_date::date) FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id AND p.dp_date IS NOT NULL AND p.payment_due_date IS NOT NULL ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS dp_date_deviation_fb,
        (SELECT (p.payoff_date::date - p.payment_due_date::date) FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id AND p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS payoff_date_deviation_fb,
        (SELECT COUNT(*) FROM trucking_operations t WHERE t.contract_id = base.id) AS trucking_count,
        (SELECT COUNT(*) FROM shipments s WHERE s.contract_id = base.id) AS shipment_count,
        (SELECT COUNT(*) FROM documents d WHERE d.contract_id = base.id) AS document_count,`;

const CONTRACTS_LIST_PAYMENT_SAP_ONLY_PROJECTION = `
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'due_date_payment'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Due Date Payment'), ''), NULLIF(trim(base.latest_spd_data->>'due date payment'), '')) AS due_date_payment_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'dp_date'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'DP Date'), ''), NULLIF(trim(base.latest_spd_data->>'dp date'), '')) AS dp_date_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'payoff_date'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Payoff Date'), ''), NULLIF(trim(base.latest_spd_data->>'payoff date'), '')) AS payoff_date_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'dp_date_deviation_days'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'DP Date Deviation (Days) DP Date - Due Date'), '')) AS dp_date_deviation_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'payoff_date_deviation_days'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Payoff Date Deviation (Days) Payoff Date - Due Date'), '')) AS payoff_date_deviation_raw,`;

function buildContractsListRowProjection(options: ContractsListOuterSqlOptions = {}): string {
  const paymentBlock = options.compact
    ? CONTRACTS_LIST_PAYMENT_SAP_ONLY_PROJECTION
    : CONTRACTS_LIST_PAYMENT_AND_COUNT_PROJECTION;

  return `
        base.contract_id,
        base.id,
        base.buyer,
        COALESCE(NULLIF(TRIM(base.company_name), ''), COALESCE(base.latest_spd_data->'raw'->>'Buyer', base.latest_spd_data->>'Buyer')) AS company_name,
        base.supplier,
        base.group_name,
        base.product,
        base.quantity_ordered,
        base.quantity_delivery,
        base.quantity_receive,
        base.unit,
        base.contract_date,
        base.delivery_start_date,
        base.delivery_end_date,
        base.contract_value,
        base.unit_price,
        base.currency,
        base.status,
        base.incoterm,
        COALESCE(NULLIF(TRIM(base.transport_mode), ''), base.latest_spd_data->'contract'->>'transport_mode', base.latest_spd_data->'contract'->>'sea_land', base.latest_spd_data->'raw'->>'Sea / Land', base.latest_spd_data->'raw'->>'Sea_Land', '') AS transport_mode,
        base.source_type,
        base.contract_type,
        base.logistics_classification,
        base.po_classification,
        base.cargo_readiness_date,
        ${groupPlantExpr('base.plant_code', 'base.company_name')} AS plant_site,
        base.created_at,
        base.po_numbers,
        base.sto_number,
        base.sto_numbers_agg AS sto_numbers,
        base.total_sto_quantity,
        (${CONTRACT_LIST_OUTSTANDING_SQL})::numeric AS outstanding_quantity,
        base.po_count,
        base.sto_count,
        COALESCE(base.latest_spd_data->'contract'->>'company_code', base.latest_spd_data->'raw'->>'Company Code', base.latest_spd_data->'raw'->>'company code', base.latest_spd_data->>'Company Code', base.latest_spd_data->>'company code') AS company_code,
        COALESCE(base.plant_code, base.latest_spd_data->'contract'->>'plant_code', base.latest_spd_data->'raw'->>'Plant Code', base.latest_spd_data->'raw'->>'plant code') AS plant_code,
        COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag') AS b2b_flag,
        COALESCE(
          base.latest_spd_data->'contract'->>'contract_reference_po',
          base.latest_spd_data->>'CONTRACT REFF PO',
          base.latest_spd_data->>'Contract Reff PO Ini',
          base.latest_spd_data->'raw'->>'Contract Reff PO Ini',
          base.latest_spd_data->'raw'->>'CONTRACT REFF PO'
        ) AS contract_reference_po,
        COALESCE(base.latest_spd_data->'raw'->>'Contract Ext No', base.latest_spd_data->>'Contract Ext No') AS contract_ext_no,
        COALESCE(base.latest_spd_data->'contract'->>'ltc_spot', base.contract_type::text) AS lt_spot,
        ${sqlSapGrPoStatusFromJson('base.latest_spd_data')} AS gr_po_status,
        ${sqlSapGrStoStatusFromJson('base.latest_spd_data')} AS gr_sto_status,
        base.import_status,
        base.sap_presence,
        base.sap_withdrawn_reason,${paymentBlock}
        base.first_trucking_start_date,
        base.last_trucking_completion_date,
        base.last_trucking_wb_actuals_date,
        base.last_trucking_daily_deliverable_date,
        base.first_ata_vessel_completed_loading,
        base.last_ata_vessel_complete_discharge,
        base.last_eta_vessel_complete_discharge,
        NULLIF(TRIM(base.last_vessel_name), '') AS vessel_name,
        base.last_eta_vessel_completed_loading AS eta_vessel_completed_loading,
        base.last_eta_vessel_complete_discharge AS eta_vessel_complete_discharge,
        base.open_standard_eta_trucking,
        base.open_standard_eta_vessel_loading`;
}

/**
 * Outer projection for GET /contracts list rows.
 * When deferCycleFromBase=true, cycle/milestone fields are computed for page rows only.
 * When compact=true, skip payments-table fallbacks and logistics/doc COUNT subqueries.
 */
export function buildContractsListOuterSql(
  deferCycleFromBase = false,
  options: ContractsListOuterSqlOptions = {},
): string {
  const rowProjection = buildContractsListRowProjection(options);
  if (!deferCycleFromBase) {
    return `
      SELECT
${rowProjection}
      FROM page AS base
`;
  }

  return `
      SELECT
${rowProjection}
      FROM (
        SELECT
          p.*,
          ${buildContractsListOuterCycleFieldSelectSql().replace(/\bbase\./g, 'p.')}
        FROM page AS p
      ) AS base
`;
}

/** Legacy export — cycle fields come from base CTE (full scope). */
export const CONTRACTS_LIST_OUTER_SQL = buildContractsListOuterSql(false);
