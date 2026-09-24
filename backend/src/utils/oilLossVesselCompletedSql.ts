/**
 * Vessel Oil Loss rows: one STO, several POs, same key as the Shipments list.
 *
 * Only shipments whose stored status is COMPLETED are members. Planned, Cancelled,
 * and every other status stay out of the group, the quantities, and R1–Loss.
 * A STO with no Completed shipment is not a row. A Completed STO with missing
 * R1–Loss quantities is still a row.
 * Qty Delivery and Qty Receive are the same STO-scoped SAP kilograms View Shipment
 * shows as Delivered Qty (SAP) and Receive Qty (SAP), summed across the STO's POs.
 * SFAL and SFBD are the opened shipment's fields (the primary row), not a sum of
 * every PO copy. The modal stores one vessel quantity in kilograms.
 */

import {
  sqlStoScopedDeliveredKgSql,
  sqlStoScopedReceiveKgSql,
} from './contractLogisticsStoDetailSql';
import { latestSpdDerivedSelectList } from './contractLatestSpdDerivedSql';
import { sqlRegionSiteRawForContract } from './regionSiteSql';
import { sqlShipmentListPrimaryFieldAgg, sqlShipmentListPrimaryIdAgg } from './shipmentListPrimaryShipmentSql';
import { shipmentPageExcludeB2bChildCond } from './shipmentPagePipelineSql';
import {
  sqlShipmentListB2bOriginContractJoins,
  sqlShipmentListExecutionCsStoJoin,
} from './shipmentB2bOriginSql';
import { buildShipmentPageSeaRowScopeSql, shipmentListSeaStoKeyExpr } from './shipmentStoTypeSql';

const LIST_STO_KEY_SQL = shipmentListSeaStoKeyExpr('c', 'l', 's');

/** Stored shipment status. This is the View Shipment badge, not the effective pipeline status. */
export function sqlOilLossVesselCompletedStatus(alias: string): string {
  return `UPPER(TRIM(COALESCE(${alias}.status, ''))) = 'COMPLETED'`;
}

function vesselFromSql(extraJoins = ''): string {
  return `
        FROM shipments s
        ${sqlShipmentListB2bOriginContractJoins()}
        ${sqlShipmentListExecutionCsStoJoin(LIST_STO_KEY_SQL)}
        ${extraJoins}
        WHERE ${buildShipmentPageSeaRowScopeSql('c', 'l', 's')}
          AND ${shipmentPageExcludeB2bChildCond('l')}
          AND ${sqlOilLossVesselCompletedStatus('s')}`;
}

/**
 * CTEs from the shared SPD prelude through `vessel_rows`.
 * No leading WITH and no trailing comma — append after the trucking CTEs.
 */
export function buildOilLossVesselCompletedCtes(): string {
  const plantExpr = sqlRegionSiteRawForContract('c.contract_id', 'c.po_number');
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
          ${sqlShipmentListPrimaryFieldAgg('NULLIF(s.sfal_qty, 0)', LIST_STO_KEY_SQL, 'c', 'l', 's', 'cs_sto')} AS shipment_sfal_kg,
          ${sqlShipmentListPrimaryFieldAgg('NULLIF(s.sfbd_qty, 0)', LIST_STO_KEY_SQL, 'c', 'l', 's', 'cs_sto')} AS shipment_sfbd_kg
        ${vesselFromSql()}
        GROUP BY ${LIST_STO_KEY_SQL}
      ),
      vessel_status AS (
        SELECT f.*
        FROM vessel_base f
        WHERE COALESCE(f.sap_presence, 'PRESENT') = 'PRESENT'
          AND f.id IS NOT NULL
      ),
      vessel_contract_qty AS (
        SELECT DISTINCT ON (sto_key, contract_id)
          sto_key,
          contract_id,
          quantity_delivery,
          quantity_received,
          quantity_contract
        FROM (
          SELECT
            ${LIST_STO_KEY_SQL} AS sto_key,
            NULLIF(TRIM(c.contract_id), '') AS contract_id,
            ${sapDeliveredKg} AS quantity_delivery,
            ${sapReceivedKg} AS quantity_received,
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
          g.shipment_sfal_kg AS quantity_sfal,
          g.shipment_sfbd_kg AS quantity_sfbd,
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
