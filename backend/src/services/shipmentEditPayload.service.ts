/**
 * Combined payload for Edit / View Shipment modal — one round-trip instead of 4–5 sequential calls.
 */

import { query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { buildContractDetailsForStoSql } from '../utils/contractDetailsForStoSql';
import {
  SHIPMENT_ATA_OVERRIDES_JOIN,
  sqlEffectiveAtaArrivalDischarge,
  sqlEffectiveAtaArrivalLoading,
  sqlEffectiveAtaBerthedDischarge,
  sqlEffectiveAtaBerthedLoading,
  sqlEffectiveAtaCompleteDischarge,
  sqlEffectiveAtaCompletedLoading,
  sqlEffectiveAtaSailedLoading,
  sqlEffectiveAtaStartDischarge,
  sqlEffectiveAtaStartLoading,
  sqlSapAtaArrivalDischarge,
  sqlSapAtaArrivalLoading,
  sqlSapAtaBerthedDischarge,
  sqlSapAtaBerthedLoading,
  sqlSapAtaCompleteDischarge,
  sqlSapAtaCompletedLoading,
  sqlSapAtaSailedLoading,
  sqlSapAtaStartDischarge,
  sqlSapAtaStartLoading,
} from '../utils/shipmentAtaOverrideSql';
import { groupPlantExpr } from '../utils/groupPlantSql';
import { resolvedPlantCodeSql } from '../utils/portDisplaySql';
import { resolveShipmentEditContext, type ShipmentEditContext } from './shipmentEditContext.service';

const SHIPMENT_BY_ID_SQL = `
  SELECT
    s.*,
    c.contract_id AS contract_number,
    c.sto_number AS contract_sto_number,
    c.supplier,
    c.buyer,
    c.product,
    c.group_name,
    c.quantity_ordered,
    c.unit,
    ${resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code')} AS plant_code,
    ${groupPlantExpr(
      resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code'),
      'c.company_name',
    )} AS plant_site,
    COALESCE(
      NULLIF(TRIM(c.sto_number::text), ''),
      sap_sto.effective_sto,
      CASE
        WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
        THEN NULLIF(TRIM(s.shipment_id::text), '')
        ELSE NULL
      END
    ) AS sto_number
  FROM shipments s
  LEFT JOIN contracts c ON s.contract_id = c.id
  LEFT JOIN LATERAL (
    SELECT NULLIF(TRIM(COALESCE(
      spd.sto_number::text,
      spd.data->'raw'->>'STO No.',
      spd.data->'raw'->>'STO Number',
      spd.data->'shipment'->>'sto_no',
      spd.data->'contract'->>'sto_no'
    )), '') AS effective_sto
    FROM sap_processed_data spd
    WHERE spd.contract_number = c.contract_id
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  ) sap_sto ON TRUE
  WHERE s.id = $1::uuid
  LIMIT 1`;

const ACTIVE_PORT_FILTER = 'AND COALESCE(vlp.is_cancelled, false) = false';
const ACTIVE_LOADING_JOIN = ' AND COALESCE(vlp1.is_cancelled, false) = false';
const ACTIVE_DISCHARGE_JOIN = ' AND COALESCE(vlpd.is_cancelled, false) = false';

const PORTS_SELECT = `
  vlp.id,
  vlp.shipment_id,
  vlp.port_name,
  vlp.port_sequence,
  vlp.quantity_at_loading_port,
  vlp.eta_vessel_arrival,
  vlp.ata_vessel_arrival,
  vlp.eta_vessel_berthed,
  vlp.ata_vessel_berthed,
  vlp.eta_loading_start,
  vlp.ata_loading_start,
  vlp.eta_loading_completed,
  vlp.ata_loading_completed,
  vlp.eta_vessel_sailed,
  vlp.ata_vessel_sailed,
  vlp.eta_vessel_berthed_at_loading_port,
  vlp.eta_vessel_arrive_at_discharge_port,
  vlp.eta_vessel_berthed_at_discharge_port,
  vlp.eta_vessel_start_discharging,
  vlp.eta_vessel_complete_discharge,
  vlp.loading_rate,
  vlp.quality_ffa,
  vlp.quality_mi,
  vlp.quality_dobi,
  vlp.quality_red,
  vlp.quality_ds,
  vlp.quality_stone,
  vlp.is_discharge_port,
  vlp.created_at,
  vlp.updated_at,
  c.contract_id AS contract_number`;

export interface ShipmentEditPayload {
  shipment: Record<string, unknown>;
  editContext: ShipmentEditContext;
  ports: Record<string, unknown>[];
  shipmentInfo: Record<string, unknown> | null;
  contractDetails: Record<string, unknown>[];
}

async function loadPortsAndInfo(shipmentUuid: string): Promise<{
  ports: Record<string, unknown>[];
  shipmentInfo: Record<string, unknown> | null;
}> {
  const portsResult = await query(
    `SELECT ${PORTS_SELECT}
     FROM vessel_loading_ports vlp
     LEFT JOIN shipments s ON vlp.shipment_id = s.id
     LEFT JOIN contracts c ON s.contract_id = c.id
     WHERE vlp.shipment_id = $1::uuid
     ${ACTIVE_PORT_FILTER}
     ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
    [shipmentUuid],
  );

  const shipmentInfoResult = await query(
    `SELECT
      s.quantity_delivered,
      s.actual_vessel_qty_receive,
      s.sfal_qty,
      s.sfbd_qty,
      s.vessel_oa_actual,
      s.vessel_oa_budget,
      s.bl_quantity,
      s.status,
      s.port_of_loading AS vessel_loading_port_1,
      s.port_of_discharge AS vessel_discharge_port_1,
      c.contract_id AS contract_number,
      ${sqlEffectiveAtaArrivalLoading()} AS ata_vessel_arrival_at_loading_port,
      ${sqlEffectiveAtaBerthedLoading()} AS ata_vessel_berthed_at_loading_port,
      ${sqlEffectiveAtaStartLoading()} AS ata_vessel_start_loading,
      ${sqlEffectiveAtaCompletedLoading()} AS ata_vessel_completed_loading,
      ${sqlEffectiveAtaSailedLoading()} AS ata_vessel_sailed_from_loading_port,
      ${sqlEffectiveAtaArrivalDischarge()} AS ata_vessel_arrive_at_discharge_port,
      ${sqlEffectiveAtaBerthedDischarge()} AS ata_vessel_berthed_at_discharge_port,
      ${sqlEffectiveAtaStartDischarge()} AS ata_vessel_start_discharging,
      ${sqlEffectiveAtaCompleteDischarge()} AS ata_vessel_complete_discharge,
      ${sqlSapAtaArrivalLoading()} AS sap_ata_vessel_arrival_at_loading_port,
      ${sqlSapAtaBerthedLoading()} AS sap_ata_vessel_berthed_at_loading_port,
      ${sqlSapAtaStartLoading()} AS sap_ata_vessel_start_loading,
      ${sqlSapAtaCompletedLoading()} AS sap_ata_vessel_completed_loading,
      ${sqlSapAtaSailedLoading()} AS sap_ata_vessel_sailed_from_loading_port,
      ${sqlSapAtaArrivalDischarge()} AS sap_ata_vessel_arrive_at_discharge_port,
      ${sqlSapAtaBerthedDischarge()} AS sap_ata_vessel_berthed_at_discharge_port,
      ${sqlSapAtaStartDischarge()} AS sap_ata_vessel_start_discharging,
      ${sqlSapAtaCompleteDischarge()} AS sap_ata_vessel_complete_discharge,
      sao.ata_arrival::text AS ata_override_arrival_at_loading_port,
      sao.ata_berthed::text AS ata_override_berthed_at_loading_port,
      sao.ata_loading_start::text AS ata_override_start_loading,
      sao.ata_loading_complete::text AS ata_override_completed_loading,
      sao.ata_sailed::text AS ata_override_sailed_from_loading_port,
      sao.ata_discharge_arrival::text AS ata_override_arrive_at_discharge_port,
      sao.ata_discharge_berthed::text AS ata_override_berthed_at_discharge_port,
      sao.ata_discharge_start::text AS ata_override_start_discharging,
      sao.ata_discharge_complete::text AS ata_override_complete_discharge,
      COALESCE(vlp1.eta_vessel_arrival::date, s.eta_arrival) AS eta_vessel_arrival_at_loading_port,
      COALESCE(vlp1.eta_vessel_berthed_at_loading_port::date, s.eta_berthed) AS eta_vessel_berthed_at_loading_port,
      COALESCE(vlp1.eta_loading_start::date, s.eta_loading_start) AS eta_vessel_start_loading,
      COALESCE(vlp1.eta_loading_completed::date, s.eta_loading_complete) AS eta_vessel_completed_loading,
      COALESCE(vlp1.eta_vessel_sailed::date, s.eta_sailed) AS eta_vessel_sailed_from_loading_port,
      COALESCE(vlpd.eta_vessel_arrive_at_discharge_port::date, s.eta_discharge_arrival) AS eta_vessel_arrive_at_discharge_port,
      COALESCE(vlpd.eta_vessel_berthed_at_discharge_port::date, s.eta_discharge_berthed) AS eta_vessel_berthed_at_discharge_port,
      COALESCE(vlpd.eta_vessel_start_discharging::date, s.eta_discharge_start) AS eta_vessel_start_discharging,
      COALESCE(vlpd.eta_vessel_complete_discharge::date, s.eta_discharge_complete) AS eta_vessel_complete_discharge,
      CASE
        WHEN s.actual_vessel_qty_receive > 0
          AND ${sqlEffectiveAtaCompletedLoading()} IS NOT NULL
          AND ${sqlEffectiveAtaStartLoading()} IS NOT NULL
        THEN s.actual_vessel_qty_receive / NULLIF(
          (${sqlEffectiveAtaCompletedLoading()}::date - ${sqlEffectiveAtaStartLoading()}::date)::numeric,
          0
        )
        ELSE NULL
      END AS loading_rate_kg_per_day,
      vlp1.quality_ffa AS quality_at_loading_loc_1_ffa,
      vlp1.quality_mi AS quality_at_loading_loc_1_mi,
      vlp1.quality_dobi AS quality_at_loading_loc_1_dobi,
      vlp1.quality_red AS quality_at_loading_loc_1_red,
      vlp1.quality_ds AS quality_at_loading_loc_1_ds,
      vlp1.quality_stone AS quality_at_loading_loc_1_stone,
      vlpd.quality_ffa AS quality_at_discharge_loc_1_ffa,
      vlpd.quality_mi AS quality_at_discharge_loc_1_mi,
      vlpd.quality_dobi AS quality_at_discharge_loc_1_dobi,
      vlpd.quality_red AS quality_at_discharge_loc_1_red,
      vlpd.quality_ds AS quality_at_discharge_loc_1_ds,
      vlpd.quality_stone AS quality_at_discharge_loc_1_stone
    FROM shipments s
    LEFT JOIN contracts c ON s.contract_id = c.id
    LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id
      AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false${ACTIVE_LOADING_JOIN}
    LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id
      AND vlpd.is_discharge_port = true${ACTIVE_DISCHARGE_JOIN}
    ${SHIPMENT_ATA_OVERRIDES_JOIN}
    WHERE s.id = $1::uuid
    LIMIT 1`,
    [shipmentUuid],
  );

  return {
    ports: portsResult.rows as Record<string, unknown>[],
    shipmentInfo: (shipmentInfoResult.rows[0] as Record<string, unknown>) ?? null,
  };
}

async function loadContractDetailsForEdit(
  lookupKey: string,
  contractNumbersCsv: string,
): Promise<Record<string, unknown>[]> {
  const contractList = contractNumbersCsv
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  await ensureUserStoContractAssignmentsTable();
  const result = await query(buildContractDetailsForStoSql(), [lookupKey, contractList]);
  return result.rows as Record<string, unknown>[];
}

export async function resolveShipmentEditPayload(
  shipmentUuid: string,
): Promise<ShipmentEditPayload | null> {
  const [shipmentRes, editContext, portsBundle] = await Promise.all([
    query(SHIPMENT_BY_ID_SQL, [shipmentUuid]),
    resolveShipmentEditContext(shipmentUuid),
    loadPortsAndInfo(shipmentUuid),
  ]);

  if (shipmentRes.rows.length === 0 || !editContext) {
    return null;
  }

  const lookupKey = String(editContext.lookup_key ?? '').trim();
  const contractDetails = lookupKey
    ? await loadContractDetailsForEdit(lookupKey, editContext.contract_numbers ?? '')
    : [];

  return {
    shipment: shipmentRes.rows[0] as Record<string, unknown>,
    editContext,
    ports: portsBundle.ports,
    shipmentInfo: portsBundle.shipmentInfo,
    contractDetails,
  };
}
