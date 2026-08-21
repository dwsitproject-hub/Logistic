/**
 * SQL builders for shipment pipeline daily summary refresh.
 */

import { sqlIsContractSapClosedForStoExpr } from './contractDeliveryStatus';
import { groupPlantExpr } from './groupPlantSql';
import {
  sqlPipelineIncotermKey,
  sqlPipelineProductKey,
} from './pipelineDailySummaryToolbarScope';
import { buildShipmentListAtaSelectSql, SHIPMENT_ATA_OVERRIDES_JOIN } from './shipmentAtaOverrideSql';
import { shipmentEffectiveStatusExpr, sqlShipmentGroupStatusFloorAgg } from './shipmentListFilters';
import { sqlShipmentListPrimaryFieldAgg, sqlShipmentListPrimaryIdAgg } from './shipmentListPrimaryShipmentSql';
import { sqlMasterVesselLateralJoin } from './masterVesselDisplaySql';
import { SHIPMENT_LIST_SPD_AGG_CTES_FULL } from './shipmentListSapAggSql';
import {
  shipmentPagePipelineSummarySelectSql,
  shipmentPageExcludeB2bChildCond,
  shipmentPipelineEnrichedDisplayVesselKeyExpr,
} from './shipmentPagePipelineSql';
import {
  buildUnplannedContractBacklogLatestSpdCte,
  unplannedContractBacklogBaseWhereSql,
  preplannedContractBacklogBaseWhereSql,
} from './shipmentUnplannedHybridSql';
import { buildShipmentPageSeaRowScopeSql, shipmentListStoKeyExpr } from './shipmentStoTypeSql';

const NULL_CONTRACT_DATE = `DATE '1970-01-01'`;

function buildShipmentDailyBaseCteSql(): string {
  const listStoKeySql = shipmentListStoKeyExpr('c', 'l', 's');
  const seaRowScopeCond = buildShipmentPageSeaRowScopeSql('c', 'l', 's');
  const ataSelect = buildShipmentListAtaSelectSql();
  const plantSite = groupPlantExpr('c.plant_code', 'c.company_name');

  const vlpCtes = `
      vlp_load_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_vessel_arrival::date AS vlp_load_ata_va,
          ata_vessel_berthed::date AS vlp_load_ata_vb,
          ata_loading_start::date AS vlp_load_ata_ls,
          ata_loading_completed::date AS vlp_load_ata_lc,
          ata_vessel_sailed::date AS vlp_load_ata_vs
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = false AND port_sequence = 1
        ORDER BY shipment_id, id
      ),
      vlp_disc_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_vessel_arrival::date AS vlp_disc_ata_va,
          ata_vessel_berthed::date AS vlp_disc_ata_vb,
          ata_loading_start::date AS vlp_disc_ata_ls,
          ata_loading_completed::date AS vlp_disc_ata_lc
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = true
        ORDER BY shipment_id, port_sequence NULLS LAST, id
      ),`;

  const latestSpdSelectList = `
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
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
          ) AS contract_reference_po_raw,
          spd.created_at`;

  return `
      WITH ${vlpCtes}
      latest_spd_contract AS (
        ${latestSpdSelectList}
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base_core AS (
        SELECT
          ${listStoKeySql} AS sto_key,
          ${sqlShipmentListPrimaryIdAgg(listStoKeySql, 'c', 'l', 's', 'cs_sto')} AS id,
          MAX(s.status) AS status,
          -- Mixed persisted statuses on multi-contract STOs (diagnostic). Cards use MAX ATA.
          ${sqlShipmentGroupStatusFloorAgg('s')},
          -- SAP presence for the STO. MIN keeps the group WITHDRAWN only when every contract
          -- behind it is withdrawn, so a partially-cancelled STO still counts in the circles.
          MIN(COALESCE(c.sap_presence, 'PRESENT')) AS sap_presence,
          ${sqlShipmentListPrimaryFieldAgg('s.vessel_name', listStoKeySql, 'c', 'l', 's', 'cs_sto')} AS vessel_name,
          ${sqlShipmentListPrimaryFieldAgg('s.vessel_code', listStoKeySql, 'c', 'l', 's', 'cs_sto')} AS vessel_code,
          ${sqlShipmentListPrimaryFieldAgg('s.master_vessel_id::text', listStoKeySql, 'c', 'l', 's', 'cs_sto')}::uuid AS master_vessel_id,
          MAX(s.created_at) AS created_at,
          MAX(${plantSite}) AS plant_site,
          MAX(s.eta_arrival) AS eta_arrival,
          MAX(s.eta_berthed) AS eta_berthed,
          MAX(s.eta_loading_start) AS eta_loading_start,
          MAX(s.eta_loading_complete) AS eta_loading_complete,
          MAX(s.eta_sailed) AS eta_sailed,
          MAX(s.eta_discharge_arrival) AS eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) AS eta_discharge_berthed,
          MAX(s.eta_discharge_start) AS eta_discharge_start,
          MAX(s.eta_discharge_complete) AS eta_vessel_complete_discharge,
          COALESCE(SUM(s.quantity_delivered), 0) AS quantity_delivered,
          COALESCE(SUM(s.quantity_delivered_klip), 0) AS quantity_delivered_klip,
          MAX(c.contract_date) AS contract_date,
          MAX(c.product) AS product,
          MAX(c.incoterm) AS incoterm,
          BOOL_AND(${sqlIsContractSapClosedForStoExpr('c', listStoKeySql)}) AS is_contract_sap_closed,
          ${ataSelect}
          ''::text AS contract_numbers_from_join,
          ''::text AS po_numbers_from_join,
          0::bigint AS contract_count_from_join,
          ''::text AS contract_ext_no_from_join
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        LEFT JOIN contract_stos cs_sto ON cs_sto.contract_id = c.id
          AND NULLIF(TRIM(cs_sto.sto_number::text), '') IS NOT NULL
          AND TRIM(cs_sto.sto_number::text) = TRIM((${listStoKeySql})::text)
        LEFT JOIN vlp_load_first vlp_l ON vlp_l.shipment_id = s.id
        LEFT JOIN vlp_disc_first vlp_d ON vlp_d.shipment_id = s.id
        ${SHIPMENT_ATA_OVERRIDES_JOIN}
        WHERE ${seaRowScopeCond}
          AND ${shipmentPageExcludeB2bChildCond('l')}
        GROUP BY ${listStoKeySql}
      ),
      shipment_base AS (
        SELECT
          g.*,
          g.contract_numbers_from_join AS contract_numbers,
          g.po_numbers_from_join AS po_numbers,
          g.contract_count_from_join AS contract_count,
          g.contract_ext_no_from_join AS contract_ext_no
        FROM shipment_base_core g
        -- This snapshot feeds the status circles and quantity strip only, never the list, so
        -- dropping STOs whose POs SAP cancelled removes them from totals without hiding rows.
        WHERE COALESCE(g.sap_presence, 'PRESENT') = 'PRESENT'
      )`;
}

/** INSERT shipment execution aggregates grouped by group_plant + contract_date. */
export function buildShipmentExecutionDailySummaryInsertSql(): string {
  const base = buildShipmentDailyBaseCteSql();
  const eff = shipmentEffectiveStatusExpr('f');
  return `
    INSERT INTO shipment_pipeline_daily_summary (
      group_plant,
      contract_date,
      product,
      incoterm,
      total_count,
      planned_count,
      at_loading_port_count,
      sailed_count,
      at_discharge_port_count,
      completed_count,
      cancelled_count,
      loading_port_arrived_count,
      loading_port_berthed_count,
      loading_port_loading_count,
      loading_port_completed_loading_count,
      discharge_port_arrived_count,
      discharge_port_berthed_count,
      discharge_port_unloading_count,
      unplanned_shipment_execution,
      eta_loading_more_than_7d,
      eta_loading_d_minus_2,
      eta_loading_d,
      eta_loading_delay,
      eta_loading_no_eta,
      eta_discharge_more_than_7d,
      eta_discharge_d_minus_2,
      eta_discharge_d,
      eta_discharge_delay,
      eta_discharge_no_eta
    )
    ${base},
    enriched AS (
      SELECT
        f.*,
        ${eff} AS effective_status,
        COALESCE(f.plant_site, 'Blank') AS group_plant,
        COALESCE(f.contract_date, ${NULL_CONTRACT_DATE})::date AS contract_date_key,
        ${sqlPipelineProductKey('f.product')} AS product_key,
        ${sqlPipelineIncotermKey('f.incoterm')} AS incoterm_key,
        (
          f.eta_arrival IS NULL AND f.eta_berthed IS NULL AND f.eta_loading_start IS NULL
          AND f.eta_loading_complete IS NULL AND f.eta_sailed IS NULL
        ) AS loading_no_eta,
        (
          (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) < 0) OR
          (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) < 0) OR
          (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) < 0) OR
          (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) < 0) OR
          (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) < 0)
        ) AS loading_delay,
        (
          (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) = 0) OR
          (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) = 0) OR
          (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) = 0) OR
          (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) = 0) OR
          (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) = 0)
        ) AS loading_d,
        (
          (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) BETWEEN 1 AND 2)
        ) AS loading_d_minus_2,
        (
          (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) > 7) OR
          (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) > 7) OR
          (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) > 7) OR
          (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) > 7) OR
          (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) > 7)
        ) AS loading_more_than_7d,
        (
          f.eta_discharge_arrival IS NULL AND f.eta_discharge_berthed IS NULL
          AND f.eta_discharge_start IS NULL AND f.eta_vessel_complete_discharge IS NULL
        ) AS discharge_no_eta,
        (
          (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) < 0) OR
          (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) < 0) OR
          (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) < 0) OR
          (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) < 0)
        ) AS discharge_delay,
        (
          (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) = 0) OR
          (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) = 0) OR
          (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) = 0) OR
          (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) = 0)
        ) AS discharge_d,
        (
          (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
          (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) BETWEEN 1 AND 2)
        ) AS discharge_d_minus_2,
        (
          (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) > 7) OR
          (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) > 7) OR
          (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) > 7) OR
          (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) > 7)
        ) AS discharge_more_than_7d
      FROM shipment_base f
    )
    SELECT
      group_plant,
      contract_date_key,
      product_key AS product,
      incoterm_key AS incoterm,
      COUNT(*)::bigint,
      ${shipmentPagePipelineSummarySelectSql().trim()},
      0::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND loading_more_than_7d)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND loading_d_minus_2)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND loading_d)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND loading_delay)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND loading_no_eta)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND discharge_more_than_7d)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND discharge_d_minus_2)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND discharge_d)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND discharge_delay)::bigint,
      COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND discharge_no_eta)::bigint
    FROM enriched e
    GROUP BY group_plant, contract_date_key, product_key, incoterm_key`;
}

/** Grouped pipeline-card stage for an enriched row alias (NULL when no stage applies). */
function shipmentPipelineStageCaseSql(alias: string): string {
  const e = alias;
  return `CASE
        WHEN ${e}.effective_status = 'PLANNED' THEN 'PLANNED'
        WHEN ${e}.effective_status IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') THEN 'AT_LOADING_PORT'
        WHEN ${e}.effective_status = 'SAILED' THEN 'SAILED'
        WHEN ${e}.effective_status IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') THEN 'AT_DISCHARGE_PORT'
        WHEN ${e}.effective_status = 'COMPLETED' THEN 'COMPLETED'
        WHEN ${e}.effective_status = 'CANCELLED' THEN 'CANCELLED'
        ELSE NULL
      END`;
}

/**
 * INSERT one row per STO key with its derived pipeline stage + toolbar dims, used to
 * page status-filtered list requests without re-deriving status for every row.
 */
export function buildShipmentStageSnapshotInsertSql(): string {
  const base = buildShipmentDailyBaseCteSql();
  const eff = shipmentEffectiveStatusExpr('f');
  const stageCase = shipmentPipelineStageCaseSql('e');
  return `
    INSERT INTO shipment_list_stage_snapshot (
      sto_key, stage, group_plant, contract_date, product, incoterm, last_created_at
    )
    ${base},
    enriched AS (
      SELECT
        f.*,
        ${eff} AS effective_status,
        COALESCE(f.plant_site, 'Blank') AS group_plant,
        COALESCE(f.contract_date, ${NULL_CONTRACT_DATE})::date AS contract_date_key,
        ${sqlPipelineProductKey('f.product')} AS product_key,
        ${sqlPipelineIncotermKey('f.incoterm')} AS incoterm_key
      FROM shipment_base f
    )
    SELECT
      TRIM(e.sto_key::text),
      ${stageCase} AS stage,
      e.group_plant,
      e.contract_date_key,
      e.product_key,
      e.incoterm_key,
      e.created_at
    FROM enriched e
    WHERE NULLIF(TRIM(e.sto_key::text), '') IS NOT NULL
      AND (${stageCase}) IS NOT NULL
    ON CONFLICT (sto_key) DO NOTHING`;
}

/**
 * INSERT distinct (dims, stage, vessel) facts for per-stage distinct-vessel counts.
 * Stage keys are the grouped pipeline cards; blank vessel names are excluded.
 */
export function buildShipmentVesselStageDailyInsertSql(): string {
  const base = buildShipmentDailyBaseCteSql();
  const eff = shipmentEffectiveStatusExpr('f');
  const vessel = shipmentPipelineEnrichedDisplayVesselKeyExpr('e');
  const stageCase = shipmentPipelineStageCaseSql('e');
  const masterJoin = sqlMasterVesselLateralJoin(
    'COALESCE(f.vessel_code, sl.vessel_code_sap)',
    'COALESCE(f.vessel_name, sl.vessel_name_sap)',
    'mv',
    'f.master_vessel_id',
  );
  return `
    INSERT INTO shipment_pipeline_vessel_stage_daily (
      group_plant, contract_date, product, incoterm, stage, vessel_key
    )
    ${base},
    shipment_page AS (
      SELECT * FROM shipment_base
    ),
    ${SHIPMENT_LIST_SPD_AGG_CTES_FULL},
    enriched AS (
      SELECT
        f.*,
        ${eff} AS effective_status,
        COALESCE(f.plant_site, 'Blank') AS group_plant,
        COALESCE(f.contract_date, ${NULL_CONTRACT_DATE})::date AS contract_date_key,
        ${sqlPipelineProductKey('f.product')} AS product_key,
        ${sqlPipelineIncotermKey('f.incoterm')} AS incoterm_key,
        sl.vessel_name_sap,
        sl.vessel_code_sap,
        mv.vessel_name_master
      FROM shipment_base f
      LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(f.sto_key::text)
      ${masterJoin}
    )
    SELECT DISTINCT
      e.group_plant,
      e.contract_date_key,
      e.product_key,
      e.incoterm_key,
      ${stageCase} AS stage,
      ${vessel} AS vessel_key
    FROM enriched e
    WHERE ${vessel} IS NOT NULL
      AND (${stageCase}) IS NOT NULL`;
}

/** UPSERT open contract backlog + preplanned counts grouped by group_plant + contract_date. */
export function buildShipmentBacklogDailySummaryUpsertSql(): string {
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  return `
    INSERT INTO shipment_pipeline_daily_summary (
      group_plant, contract_date, product, incoterm,
      unplanned_contract_backlog, preplanned_contract_count
    )
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    backlog AS (
      SELECT
        ${plant} AS group_plant,
        COALESCE(c.contract_date, DATE '1970-01-01')::date AS contract_date,
        ${sqlPipelineProductKey('c.product')} AS product,
        ${sqlPipelineIncotermKey('c.incoterm')} AS incoterm,
        COUNT(*)::bigint AS unplanned_contract_backlog
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')}
      GROUP BY 1, 2, 3, 4
    ),
    preplanned AS (
      SELECT
        ${plant} AS group_plant,
        COALESCE(c.contract_date, DATE '1970-01-01')::date AS contract_date,
        ${sqlPipelineProductKey('c.product')} AS product,
        ${sqlPipelineIncotermKey('c.incoterm')} AS incoterm,
        COUNT(*)::bigint AS preplanned_contract_count
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${preplannedContractBacklogBaseWhereSql('c', 'l')}
      GROUP BY 1, 2, 3, 4
    ),
    dims AS (
      SELECT group_plant, contract_date, product, incoterm FROM backlog
      UNION
      SELECT group_plant, contract_date, product, incoterm FROM preplanned
    )
    SELECT
      d.group_plant,
      d.contract_date,
      d.product,
      d.incoterm,
      COALESCE(b.unplanned_contract_backlog, 0)::bigint AS unplanned_contract_backlog,
      COALESCE(p.preplanned_contract_count, 0)::bigint AS preplanned_contract_count
    FROM dims d
    LEFT JOIN backlog b
      ON b.group_plant = d.group_plant
     AND b.contract_date = d.contract_date
     AND b.product = d.product
     AND b.incoterm = d.incoterm
    LEFT JOIN preplanned p
      ON p.group_plant = d.group_plant
     AND p.contract_date = d.contract_date
     AND p.product = d.product
     AND p.incoterm = d.incoterm
    ON CONFLICT (group_plant, contract_date, product, incoterm) DO UPDATE SET
      unplanned_contract_backlog = EXCLUDED.unplanned_contract_backlog,
      preplanned_contract_count = EXCLUDED.preplanned_contract_count`;
}
