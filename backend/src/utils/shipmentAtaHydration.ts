import { query } from '../database/connection';
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
} from './shipmentAtaOverrideSql';

const ATA_UI_KEYS = [
  'ata_vessel_arrival_at_loading_port',
  'ata_vessel_berthed_at_loading_port',
  'ata_vessel_start_loading',
  'ata_vessel_completed_loading',
  'ata_vessel_sailed_from_loading_port',
  'ata_vessel_arrive_at_discharge_port',
  'ata_vessel_berthed_at_discharge_port',
  'ata_vessel_start_discharging',
  'ata_vessel_complete_discharge',
] as const;

const SAP_SHIPMENT_KEY_MAP: Record<(typeof ATA_UI_KEYS)[number], string> = {
  ata_vessel_arrival_at_loading_port: 'ata_vessel_arrival_at_loading_port_1',
  ata_vessel_berthed_at_loading_port: 'ata_vessel_berthed_at_loading_port_1',
  ata_vessel_start_loading: 'ata_vessel_start_loading',
  ata_vessel_completed_loading: 'ata_vessel_completed_loading',
  ata_vessel_sailed_from_loading_port: 'ata_vessel_sailed_from_loading_port',
  ata_vessel_arrive_at_discharge_port: 'ata_vessel_arrival_at_discharge_port',
  ata_vessel_berthed_at_discharge_port: 'ata_vessel_berthed_at_discharge_port',
  ata_vessel_start_discharging: 'ata_vessel_start_discharging',
  ata_vessel_complete_discharge: 'ata_vessel_completed_discharge',
};

function normalizeSapDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = excelEpoch + value * 86400000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
    if (mdy) {
      const mm = Number(mdy[1]);
      const dd = Number(mdy[2]);
      let yyyy = Number(mdy[3]);
      if (yyyy < 100) yyyy += 2000;
      const d = new Date(yyyy, mm - 1, dd);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function mergeStoSiblingAta(
  shipmentId: string,
  shipmentInfo: Record<string, unknown>,
): Promise<void> {
  const hasGap = ATA_UI_KEYS.some((k) => shipmentInfo[k] == null);
  if (!hasGap) return;

  const activeLoadingJoinFilter = ' AND COALESCE(vlp1.is_cancelled, false) = false';
  const activeDischargeJoinFilter = ' AND COALESCE(vlpd.is_cancelled, false) = false';

  const result = await query(
    `WITH target AS (
      SELECT NULLIF(TRIM(c.sto_number::text), '') AS sto
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE s.id = $1::uuid
    ),
    latest_spd_contract AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        NULLIF(TRIM(COALESCE(
          spd.sto_number::text,
          spd.data->'raw'->>'STO No.',
          spd.data->'raw'->>'STO Number',
          spd.data->'shipment'->>'sto_no',
          spd.data->'contract'->>'sto_no'
        )), '') AS effective_sto,
        spd.created_at
      FROM sap_processed_data spd
      WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    )
    SELECT
      MAX(${sqlEffectiveAtaArrivalLoading()})::text AS ata_vessel_arrival_at_loading_port,
      MAX(${sqlEffectiveAtaBerthedLoading()})::text AS ata_vessel_berthed_at_loading_port,
      MAX(${sqlEffectiveAtaStartLoading()})::text AS ata_vessel_start_loading,
      MAX(${sqlEffectiveAtaCompletedLoading()})::text AS ata_vessel_completed_loading,
      MAX(${sqlEffectiveAtaSailedLoading()})::text AS ata_vessel_sailed_from_loading_port,
      MAX(${sqlEffectiveAtaArrivalDischarge()})::text AS ata_vessel_arrive_at_discharge_port,
      MAX(${sqlEffectiveAtaBerthedDischarge()})::text AS ata_vessel_berthed_at_discharge_port,
      MAX(${sqlEffectiveAtaStartDischarge()})::text AS ata_vessel_start_discharging,
      MAX(${sqlEffectiveAtaCompleteDischarge()})::text AS ata_vessel_complete_discharge
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    INNER JOIN target t ON c.sto_number::text = t.sto
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false${activeLoadingJoinFilter}
    LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true${activeDischargeJoinFilter}
    ${SHIPMENT_ATA_OVERRIDES_JOIN}
    WHERE t.sto IS NOT NULL`,
    [shipmentId],
  );

  const agg = result.rows[0] as Record<string, unknown> | undefined;
  if (!agg) return;

  for (const key of ATA_UI_KEYS) {
    if (shipmentInfo[key] == null && agg[key] != null) {
      shipmentInfo[key] = agg[key];
    }
    const sapKey = `sap_${key}`;
    if (shipmentInfo[sapKey] == null && agg[key] != null) {
      shipmentInfo[sapKey] = agg[key];
    }
  }
}

async function mergeSapAtaPerField(shipmentInfo: Record<string, unknown>): Promise<void> {
  const contractNumber = shipmentInfo.contract_number;
  if (!contractNumber) return;

  const needsSap = ATA_UI_KEYS.some((k) => shipmentInfo[k] == null);
  if (!needsSap) return;

  const sapResult = await query(
    `SELECT data
     FROM sap_processed_data
     WHERE contract_number = $1
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [contractNumber],
  );

  if (sapResult.rows.length === 0) return;

  const shp = ((sapResult.rows[0] as { data?: { shipment?: Record<string, unknown> } }).data
    ?.shipment ?? {}) as Record<string, unknown>;

  for (const [uiKey, sapKey] of Object.entries(SAP_SHIPMENT_KEY_MAP)) {
    const typedUiKey = uiKey as (typeof ATA_UI_KEYS)[number];
    if (shipmentInfo[typedUiKey] == null && sapKey in shp) {
      const normalized = normalizeSapDate(shp[sapKey]);
      if (normalized) shipmentInfo[typedUiKey] = normalized;
    }
    const sapRefKey = `sap_${typedUiKey}`;
    if (shipmentInfo[sapRefKey] == null && sapKey in shp) {
      const normalized = normalizeSapDate(shp[sapKey]);
      if (normalized) shipmentInfo[sapRefKey] = normalized;
    }
  }
}

/** Fill missing ATA fields on loading-ports shipmentInfo from STO siblings and SAP import. */
export async function hydrateShipmentInfoAtaGaps(
  shipmentId: string,
  shipmentInfo: Record<string, unknown> | null,
): Promise<void> {
  if (!shipmentInfo) return;
  if (UUID_RE.test(shipmentId)) {
    await mergeStoSiblingAta(shipmentId, shipmentInfo);
  }
  await mergeSapAtaPerField(shipmentInfo);
}
