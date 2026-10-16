/**
 * Vessel Oil Loss rows: one STO, several POs, same key and same Completed rule as the Shipments list.
 *
 * An STO is a row when it is Completed the way the Shipments page decides it (shipmentEffectiveStatusExpr), and its
 * members are the shipments of that STO that are not Cancelled:
 *   1. GR Close first - GR PO or GR STO by incoterm, every contract of the STO (sqlIsContractSapClosedForStoExpr),
 *   2. else ATC of the STO's own shipments filled,
 *   3. else every contract's outstanding inside the zero band (contract_qty_move_snapshot).
 * The stored shipments.status of a row is NOT the rule: it is written only by a SAP import, a save or a create, one row at a
 * time, so a PO whose row never reached COMPLETED used to be dropped from a STO that SAP had closed for every PO.
 *
 * The POs of the row are the contracts linked to the STO (contractsOnStoSubquery - contract_stos, SAP rows, shipments), the
 * ones the Shipments View Table lists, plus the contracts of the members. Qty Delivery and Qty Receive are the same
 * STO-scoped SAP kilograms View Shipment shows as Delivered Qty (SAP) and Receive Qty (SAP), summed across those POs.
 * SFAL and SFBD are the opened shipment's fields (the primary row of the STO group), including when that row is null.
 * A sibling PO that has a value must not fill the blank. The modal stores kilograms.
 *
 * The vessel is drawn the way the Shipments page draws it (sqlShipmentListDisplayVesselName): the Master Vessel the opened shipment resolves to
 * (by its code or the SAP code, the master id, or the normalised name), else, GR Close: the SAP name then KLIP's; not closed: KLIP's then SAP's.
 * The raw shipments.vessel_name of the opened row used to be drawn, so one vessel appeared under several spellings in the drilldown and as
 * several rows of By Transporter ("Mel 02" / "BG. MEL 02"), and a row with a blank KLIP name stayed blank although SAP names the vessel.
 */

import {
  sqlStoScopedDeliveredKgSql,
  sqlStoScopedReceiveKgSql,
} from './contractLogisticsStoDetailSql';
import { sqlIsContractSapClosedForStoExpr } from './contractDeliveryStatus';
import { latestSpdDerivedSelectList } from './contractLatestSpdDerivedSql';
import { sqlRegionSiteRawForContract } from './regionSiteSql';
import { sqlShipmentB2bChildDischargePort } from './b2bChildDischargePortSql';
import {
  sqlShipmentListPrimaryFieldAgg,
  sqlShipmentListPrimaryIdAgg,
  sqlShipmentListPrimaryOrderBy,
} from './shipmentListPrimaryShipmentSql';
import { shipmentPageExcludeB2bChildCond } from './shipmentPagePipelineSql';
import {
  sqlShipmentListB2bOriginContractJoins,
  sqlShipmentListExecutionCsStoJoin,
} from './shipmentB2bOriginSql';
import {
  buildShipmentPageSeaRowScopeSql,
  sapStoNumberKeyExpr,
  shipmentListSeaStoKeyExpr,
} from './shipmentStoTypeSql';
import { sqlMasterVesselLateralJoin } from './masterVesselDisplaySql';
import { sqlSapVesselNameFromSpdJsonb, sqlShipmentListDisplayVesselName } from './sapVesselFields';
import { SHIPMENT_ATA_OVERRIDES_JOIN, sqlJpsAtaWhileOpen } from './shipmentAtaOverrideSql';
import { shipmentListContractOsWithinBandExpr } from './shipmentListFilters';
import { contractsOnStoSubquery } from './stoLinkedContractSql';

const LIST_STO_KEY_SQL = shipmentListSeaStoKeyExpr('c', 'l', 's');

/** The SAP vessel code of a sap_processed_data row (the same fields SAP_VESSEL_CODE_FROM_SK_SQL reads, on `spd`). */
const SAP_VESSEL_CODE_FROM_SPD_SQL = `NULLIF(TRIM(COALESCE(
  spd.data->'shipment'->>'vessel_code',
  spd.data->'vessel'->>'vessel_code',
  spd.data->'raw'->>'Vessel Code',
  spd.data->'raw'->>'vessel code'
)), '')`;

/** The vessel name as the Shipments list draws it; needs the `mv`, `sv` and `sp` joins of vessel_rows. */
const VESSEL_DISPLAY_NAME_SQL = sqlShipmentListDisplayVesselName(
  'mv.vessel_name_master',
  'sv.vessel_name_sap',
  'COALESCE(sp.vessel_name, g.vessel_name)',
  'g.is_gr_closed',
);

/** SFAL/SFBD of the same row View Shipment opens. Null stays null. */
function sqlOpenedShipmentQty(fieldExpr: string): string {
  const orderBy = sqlShipmentListPrimaryOrderBy(LIST_STO_KEY_SQL, 'c', 'l', 's', 'cs_sto');
  return `(array_agg(${fieldExpr} ORDER BY ${orderBy}) FILTER (WHERE s.id IS NOT NULL))[1]`;
}

/** A shipment takes part in its STO unless it is Cancelled. Whether the STO is Completed is decided for the group. */
export function sqlOilLossVesselMemberStatus(alias: string): string {
  return `UPPER(TRIM(COALESCE(${alias}.status, ''))) NOT IN ('CANCELLED', 'CANCELED')`;
}

/**
 * ATC of a shipment, as the Shipments list reads it (buildShipmentListAtaSelectSql): the JPS lane while the shipment is open,
 * a manual override, the stored date, then the discharge port's own. Needs the `sao` and `vlp_d` joins of vesselMemberJoins().
 */
const ATC_SQL = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete')}, sao.ata_discharge_complete, s.ata_discharge_complete, vlp_d.vlp_disc_ata_lc)`;

/** Own-STO only, like ata_vessel_complete_discharge_own_sto: a sibling STO's voyage must not complete this one. */
const OWN_STO_ONLY_SQL = `NULLIF(TRIM(s.shipment_id::text), '') IS NULL
            OR TRIM(s.shipment_id::text) = TRIM((${LIST_STO_KEY_SQL})::text)`;

function vesselMemberJoins(): string {
  return `
        ${SHIPMENT_ATA_OVERRIDES_JOIN}
        LEFT JOIN LATERAL (
          SELECT vlp_df.ata_loading_completed::date AS vlp_disc_ata_lc
          FROM vessel_loading_ports vlp_df
          WHERE vlp_df.shipment_id = s.id
            AND COALESCE(vlp_df.is_discharge_port, false) = true
          ORDER BY vlp_df.port_sequence NULLS LAST, vlp_df.id
          LIMIT 1
        ) vlp_d ON TRUE
        LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id`;
}

function vesselFromSql(extraJoins = ''): string {
  return `
        FROM shipments s
        ${sqlShipmentListB2bOriginContractJoins()}
        ${sqlShipmentListExecutionCsStoJoin(LIST_STO_KEY_SQL)}
        ${extraJoins}
        WHERE ${buildShipmentPageSeaRowScopeSql('c', 'l', 's')}
          AND ${shipmentPageExcludeB2bChildCond('l')}
          AND ${sqlOilLossVesselMemberStatus('s')}`;
}

/**
 * CTEs from the shared SPD prelude through `vessel_rows`.
 * No leading WITH and no trailing comma — append after the trucking CTEs.
 */
export function buildOilLossVesselCompletedCtes(): string {
  const plantExpr = sqlRegionSiteRawForContract('c.contract_id', 'c.po_number');
  const stoQtyOpts = {
    contractNumberExpr: 'c2.contract_id',
    contractQtyExpr: 'COALESCE(c2.quantity_ordered, 0)',
    stoKeyExpr: 'vsc.sto_key',
    poNumberExpr: 'c2.po_number',
  };
  const sapDeliveredKg = `NULLIF(${sqlStoScopedDeliveredKgSql({
    ...stoQtyOpts,
    incotermExpr: 'c2.incoterm',
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
          -- the ending B2B child's port when a B2B origin's shipment has one (unless a user typed the port), else the shipment's own: the origin is the company in the middle
          COALESCE(MAX(${sqlShipmentB2bChildDischargePort('s', 'c')}), MAX(s.port_of_discharge)) AS unloading_location,
          ${sqlOpenedShipmentQty('NULLIF(s.sfal_qty, 0)')} AS shipment_sfal_kg,
          ${sqlOpenedShipmentQty('NULLIF(s.sfbd_qty, 0)')} AS shipment_sfbd_kg,
          -- Completed, the way the Shipments page decides it (see the file header): GR Close, else ATC, else outstanding inside the zero band
          BOOL_AND(COALESCE(${sqlIsContractSapClosedForStoExpr('c', LIST_STO_KEY_SQL)}, FALSE)) AS is_gr_closed,
          MAX(${ATC_SQL}) FILTER (WHERE ${OWN_STO_ONLY_SQL}) AS atc_own_sto,
          BOOL_AND(COALESCE(${shipmentListContractOsWithinBandExpr()}, FALSE)) AS is_os_within_band
        ${vesselFromSql(vesselMemberJoins())}
        GROUP BY ${LIST_STO_KEY_SQL}
      ),
      vessel_status AS (
        SELECT f.*
        FROM vessel_base f
        WHERE COALESCE(f.sap_presence, 'PRESENT') = 'PRESENT'
          AND f.id IS NOT NULL
          AND (COALESCE(f.is_gr_closed, FALSE) OR f.atc_own_sto IS NOT NULL OR COALESCE(f.is_os_within_band, FALSE))
      ),
      vessel_sto_contract AS (
        -- the POs the Shipments View Table lists for the STO (linked by contract_stos / SAP / shipments) ...
        SELECT g.sto_key, lc.contract_id
        FROM vessel_status g
        CROSS JOIN LATERAL (
          ${contractsOnStoSubquery("NULLIF(TRIM(g.sto_key::text), '')")}
        ) lc
        WHERE lc.contract_id IS NOT NULL
        UNION
        -- ... plus the contracts of the member shipments themselves (a STO with no SAP link yet)
        SELECT member.sto_key, member.contract_id
        FROM (
          SELECT
            ${LIST_STO_KEY_SQL} AS sto_key,
            NULLIF(TRIM(c.contract_id), '') AS contract_id
          ${vesselFromSql()}
        ) member
        WHERE member.contract_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM vessel_status vs WHERE vs.sto_key = member.sto_key)
      ),
      vessel_contract_qty AS (
        SELECT DISTINCT ON (sto_key, contract_id)
          sto_key,
          contract_id,
          po_number,
          contract_ext_no,
          quantity_delivery,
          quantity_received,
          quantity_contract
        FROM (
          SELECT
            vsc.sto_key,
            vsc.contract_id,
            NULLIF(TRIM(c2.po_number::text), '') AS po_number,
            NULLIF(TRIM(l2.contract_ext_no_raw), '') AS contract_ext_no,
            ${sapDeliveredKg} AS quantity_delivery,
            ${sapReceivedKg} AS quantity_received,
            c2.quantity_ordered AS quantity_contract,
            c2.created_at
          FROM vessel_sto_contract vsc
          JOIN contracts c2 ON c2.contract_id = vsc.contract_id
          LEFT JOIN latest_spd_contract l2 ON l2.contract_number = c2.contract_id
          -- a Cancelled contract is not a PO of the voyage: its quantity must not count (the SAP link still lists it)
          WHERE UPPER(TRIM(COALESCE(c2.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
        ) linked
        ORDER BY sto_key, contract_id, created_at DESC NULLS LAST
      ),
      vessel_qty AS (
        SELECT
          sto_key,
          SUM(quantity_delivery) AS quantity_delivery,
          SUM(quantity_received) AS quantity_received,
          SUM(quantity_contract) AS quantity_contract,
          STRING_AGG(DISTINCT contract_id, ', ' ORDER BY contract_id) AS contract_number,
          STRING_AGG(DISTINCT po_number, ', ' ORDER BY po_number) AS po_number,
          STRING_AGG(DISTINCT contract_ext_no, ', ' ORDER BY contract_ext_no) AS contract_ext_no
        FROM vessel_contract_qty
        GROUP BY sto_key
      ),
      vessel_sap_vessel AS MATERIALIZED (
        -- MATERIALIZED on purpose: referenced once, so it was folded into the vessel_rows join, and the planner (which sees vessel_status as 1 row) then ran
        -- it as the inner side of a nested loop - the SAP lookup repeated for every vessel row, about 70 s more on a rebuild of the dev copy.
        -- the vessel SAP names on the STO, the fallback of the display name below: ONE SAP row, picked as the Shipments list does
        -- (sap_vessel_pick): a row naming both vessel and code first, then the newest - never a name of one row beside a code of another
        SELECT DISTINCT ON (g.sto_key)
          g.sto_key,
          ${sqlSapVesselNameFromSpdJsonb('spd.data')} AS vessel_name_sap,
          ${SAP_VESSEL_CODE_FROM_SPD_SQL} AS vessel_code_sap
        FROM vessel_status g
        JOIN sap_processed_data spd ON ${sapStoNumberKeyExpr('spd')} = TRIM(g.sto_key::text)
        ORDER BY
          g.sto_key,
          (CASE
            WHEN ${sqlSapVesselNameFromSpdJsonb('spd.data')} IS NOT NULL
             AND ${SAP_VESSEL_CODE_FROM_SPD_SQL} IS NOT NULL
            THEN 0 ELSE 1 END),
          spd.created_at DESC NULLS LAST
      ),
      vessel_rows AS (
        SELECT
          g.id,
          'SEA'::text AS transport_mode,
          NULL::text AS sto_type,
          NULLIF(TRIM(g.operation_id), '') AS operation_id,
          COALESCE(vq.contract_number, g.contract_number, '') AS contract_number,
          COALESCE(vq.contract_ext_no, g.contract_ext_no, '') AS contract_ext_no,
          g.sto_key AS sto_number,
          COALESCE(vq.po_number, g.po_number, '') AS po_number,
          COALESCE(g.supplier, '') AS supplier,
          COALESCE(g.buyer, '') AS buyer,
          COALESCE(g.product, '') AS product,
          COALESCE(g.group_name, '') AS group_name,
          g.plant_site,
          COALESCE(${VESSEL_DISPLAY_NAME_SQL}, '') AS vessel_name,
          g.contract_date,
          g.contract_date AS operation_date,
          COALESCE(g.incoterm, '') AS incoterm,
          g.plant_site AS group_plant,
          vq.quantity_contract AS quantity_contract,
          COALESCE(${VESSEL_DISPLAY_NAME_SQL}, '') AS transporter,
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
        LEFT JOIN shipments sp ON sp.id = g.id
        LEFT JOIN vessel_sap_vessel sv ON sv.sto_key = g.sto_key
        ${sqlMasterVesselLateralJoin(
          'COALESCE(sp.vessel_code, sv.vessel_code_sap)',
          'COALESCE(sp.vessel_name, sv.vessel_name_sap)',
          'mv',
          'sp.master_vessel_id',
        )}
      )`;
}
