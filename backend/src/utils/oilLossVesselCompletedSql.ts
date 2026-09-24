/**
 * Vessel Oil Loss rows: the same STO grain and Completed status as the Shipments view table.
 *
 * One row per `shipmentListStoKeyExpr`. Status is `shipmentEffectiveStatusExpr = 'COMPLETED'`
 * (GR Close, ATA complete discharge, or outstanding qty within tolerance). Cancelled and
 * COMPLETED_LOADING stay out. A completed STO with missing R1–Loss quantities is still a row.
 * Qty Delivery and Qty Receive are the same STO-scoped SAP kilograms View Shipment
 * shows as Delivered Qty (SAP) and Receive Qty (SAP). SFAL and SFBD are the
 * shipment fields that modal edits, stored in kilograms.
 */

import { sqlIsContractSapClosedForStoExpr } from './contractDeliveryStatus';
import {
  sqlStoScopedDeliveredKgSql,
  sqlStoScopedReceiveKgSql,
} from './contractLogisticsStoDetailSql';
import { latestSpdDerivedSelectList } from './contractLatestSpdDerivedSql';
import { sqlRegionSiteRawForContract } from './regionSiteSql';
import { buildShipmentListAtaSelectSql, SHIPMENT_ATA_OVERRIDES_JOIN } from './shipmentAtaOverrideSql';
import {
  shipmentEffectiveStatusExpr,
  shipmentListContractOsWithinBandExpr,
} from './shipmentListFilters';
import { sqlShipmentListPrimaryFieldAgg, sqlShipmentListPrimaryIdAgg } from './shipmentListPrimaryShipmentSql';
import { shipmentPageExcludeB2bChildCond } from './shipmentPagePipelineSql';
import {
  sqlShipmentListB2bOriginContractJoins,
  sqlShipmentListExecutionCsStoJoin,
} from './shipmentB2bOriginSql';
import { buildShipmentPageSeaRowScopeSql, shipmentListStoKeyExpr } from './shipmentStoTypeSql';
import { sqlGroupedMaybeCopiedQty } from './shipmentListQtySql';

const LIST_STO_KEY_SQL = shipmentListStoKeyExpr('c', 'l', 's');

/** Same Completed predicate the Shipments list and status cards use. */
export function sqlOilLossVesselCompletedStatus(alias: string): string {
  return `${shipmentEffectiveStatusExpr(alias)} = 'COMPLETED'`;
}

function vesselFromSql(extraJoins = ''): string {
  return `
        FROM shipments s
        ${sqlShipmentListB2bOriginContractJoins()}
        -- Same snapshot the Shipments Completed status reads. Displayed qty does not use it.
        LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
        ${sqlShipmentListExecutionCsStoJoin(LIST_STO_KEY_SQL)}
        LEFT JOIN vlp_load_first vlp_l ON vlp_l.shipment_id = s.id
        LEFT JOIN vlp_disc_first vlp_d ON vlp_d.shipment_id = s.id
        ${SHIPMENT_ATA_OVERRIDES_JOIN}
        ${extraJoins}
        WHERE ${buildShipmentPageSeaRowScopeSql('c', 'l', 's')}
          AND ${shipmentPageExcludeB2bChildCond('l')}`;
}

/**
 * CTEs from the shared SPD/port prelude through `vessel_rows`.
 * No leading WITH and no trailing comma — append after the trucking CTEs.
 */
export function buildOilLossVesselCompletedCtes(): string {
  const plantExpr = sqlRegionSiteRawForContract('c.contract_id', 'c.po_number');
  const ataSelect = buildShipmentListAtaSelectSql();
  const stoQtyOpts = {
    contractNumberExpr: 'c.contract_id',
    contractQtyExpr: 'COALESCE(c.quantity_ordered, 0)',
    stoKeyExpr: LIST_STO_KEY_SQL,
    poNumberExpr: 'c.po_number',
  };
  const sapDeliveredKg = `NULLIF(${sqlStoScopedDeliveredKgSql({
    ...stoQtyOpts,
    incotermExpr: 'c.incoterm',
  })}, 0)`;
  const sapReceivedKg = `NULLIF(${sqlStoScopedReceiveKgSql(stoQtyOpts)}, 0)`;

  return `
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
      ),
      latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          ${latestSpdDerivedSelectList('spd.data', 'spd.sto_number')},
          spd.created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST, spd.id DESC
      ),
      vessel_base AS (
        SELECT
          ${LIST_STO_KEY_SQL} AS sto_key,
          ${sqlShipmentListPrimaryIdAgg(LIST_STO_KEY_SQL, 'c', 'l', 's', 'cs_sto')} AS id,
          ${sqlShipmentListPrimaryFieldAgg('s.operation_id', LIST_STO_KEY_SQL, 'c', 'l', 's', 'cs_sto')} AS operation_id,
          ${sqlShipmentListPrimaryFieldAgg('s.vessel_name', LIST_STO_KEY_SQL, 'c', 'l', 's', 'cs_sto')} AS vessel_name,
          MAX(s.status) AS status,
          MIN(COALESCE(c.sap_presence, 'PRESENT')) AS sap_presence,
          STRING_AGG(DISTINCT NULLIF(TRIM(c.contract_id), ''), ', ' ORDER BY NULLIF(TRIM(c.contract_id), '')) AS contract_number,
          STRING_AGG(DISTINCT NULLIF(TRIM(c.po_number), ''), ', ' ORDER BY NULLIF(TRIM(c.po_number), '')) AS po_number,
          STRING_AGG(DISTINCT NULLIF(TRIM(l.contract_ext_no_raw), ''), ', ' ORDER BY NULLIF(TRIM(l.contract_ext_no_raw), '')) AS contract_ext_no,
          STRING_AGG(DISTINCT NULLIF(TRIM(c.supplier), ''), ', ' ORDER BY NULLIF(TRIM(c.supplier), '')) AS supplier,
          STRING_AGG(DISTINCT NULLIF(TRIM(c.buyer), ''), ', ' ORDER BY NULLIF(TRIM(c.buyer), '')) AS buyer,
          MAX(c.product) AS product,
          MAX(c.group_name) AS group_name,
          MAX(c.incoterm) AS incoterm,
          TO_CHAR(MAX(c.contract_date), 'YYYY-MM-DD') AS contract_date,
          COALESCE(MAX(${plantExpr}), 'Blank') AS plant_site,
          MAX(s.port_of_loading) AS loading_location,
          MAX(s.port_of_discharge) AS unloading_location,
          MAX(s.eta_arrival) AS eta_arrival,
          MAX(s.eta_berthed) AS eta_berthed,
          MAX(s.eta_loading_start) AS eta_loading_start,
          MAX(s.eta_loading_complete) AS eta_loading_complete,
          MAX(s.eta_sailed) AS eta_sailed,
          MAX(s.eta_discharge_arrival) AS eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) AS eta_discharge_berthed,
          MAX(s.eta_discharge_start) AS eta_discharge_start,
          MAX(s.eta_discharge_complete) AS eta_vessel_complete_discharge,
          COALESCE(${sqlGroupedMaybeCopiedQty('s.quantity_delivered')}, 0) AS quantity_delivered,
          COALESCE(${sqlGroupedMaybeCopiedQty('s.quantity_delivered_klip')}, 0) AS quantity_delivered_klip,
          MAX(NULLIF(s.sfal_qty, 0)) AS shipment_sfal_kg,
          MAX(NULLIF(s.sfbd_qty, 0)) AS shipment_sfbd_kg,
          BOOL_AND(${sqlIsContractSapClosedForStoExpr('c', LIST_STO_KEY_SQL)}) AS is_contract_sap_closed,
          BOOL_AND(${shipmentListContractOsWithinBandExpr()}) AS is_contract_os_within_band,
          ${ataSelect.replace(/,\s*$/, '')}
        ${vesselFromSql()}
        GROUP BY ${LIST_STO_KEY_SQL}
      ),
      vessel_status AS (
        SELECT f.*
        FROM vessel_base f
        WHERE COALESCE(f.sap_presence, 'PRESENT') = 'PRESENT'
          AND f.id IS NOT NULL
          AND ${sqlOilLossVesselCompletedStatus('f')}
      ),
      vessel_contract_qty AS (
        SELECT DISTINCT ON (sto_key, contract_id)
          sto_key,
          contract_id,
          quantity_delivery,
          quantity_received,
          quantity_sfal,
          quantity_sfbd,
          quantity_contract
        FROM (
          SELECT
            ${LIST_STO_KEY_SQL} AS sto_key,
            NULLIF(TRIM(c.contract_id), '') AS contract_id,
            ${sapDeliveredKg} AS quantity_delivery,
            ${sapReceivedKg} AS quantity_received,
            NULLIF(s.sfal_qty, 0) AS quantity_sfal,
            NULLIF(s.sfbd_qty, 0) AS quantity_sfbd,
            c.quantity_ordered AS quantity_contract,
            s.updated_at
          ${vesselFromSql()}
        ) member
        WHERE contract_id IS NOT NULL
        ORDER BY sto_key, contract_id, updated_at DESC NULLS LAST
      ),
      vessel_qty AS (
        SELECT
          sto_key,
          SUM(quantity_delivery) AS quantity_delivery,
          SUM(quantity_received) AS quantity_received,
          SUM(quantity_sfal) AS quantity_sfal,
          SUM(quantity_sfbd) AS quantity_sfbd,
          SUM(quantity_contract) AS quantity_contract
        FROM vessel_contract_qty
        GROUP BY sto_key
      ),
      vessel_rows AS (
        SELECT
          g.id,
          'SEA'::text AS transport_mode,
          NULL::text AS sto_type,
          NULLIF(TRIM(g.operation_id), '') AS operation_id,
          COALESCE(g.contract_number, '') AS contract_number,
          COALESCE(g.contract_ext_no, '') AS contract_ext_no,
          g.sto_key AS sto_number,
          COALESCE(g.po_number, '') AS po_number,
          COALESCE(g.supplier, '') AS supplier,
          COALESCE(g.buyer, '') AS buyer,
          COALESCE(g.product, '') AS product,
          COALESCE(g.group_name, '') AS group_name,
          g.plant_site,
          COALESCE(g.vessel_name, '') AS vessel_name,
          g.contract_date,
          g.contract_date AS operation_date,
          COALESCE(g.incoterm, '') AS incoterm,
          g.plant_site AS group_plant,
          vq.quantity_contract AS quantity_contract,
          COALESCE(g.vessel_name, '') AS transporter,
          COALESCE(g.loading_location, '') AS loading_location,
          COALESCE(g.unloading_location, '') AS unloading_location,
          'COMPLETED'::text AS status,
          vq.quantity_delivery AS quantity_delivery,
          vq.quantity_received AS quantity_received,
          vq.quantity_delivery AS quantity_sent,
          COALESCE(vq.quantity_sfal, g.shipment_sfal_kg) AS quantity_sfal,
          COALESCE(vq.quantity_sfbd, g.shipment_sfbd_kg) AS quantity_sfbd,
          CASE
            WHEN vq.quantity_delivery IS NOT NULL
             AND vq.quantity_received IS NOT NULL
            THEN vq.quantity_received - vq.quantity_delivery
            ELSE NULL
          END AS gain_loss_amount,
          CASE
            WHEN vq.quantity_delivery > 0
             AND vq.quantity_received IS NOT NULL
            THEN ROUND(
              (vq.quantity_received - vq.quantity_delivery)
              / vq.quantity_delivery * 100,
              4
            )
            ELSE NULL
          END AS gain_loss_percentage
        FROM vessel_status g
        LEFT JOIN vessel_qty vq ON vq.sto_key = g.sto_key
      )`;
}
