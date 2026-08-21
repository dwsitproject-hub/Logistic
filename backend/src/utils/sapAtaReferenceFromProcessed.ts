/**
 * SAP ATA reference dates for Edit Shipment chips — live from sap_processed_data only.
 * Never fall back to KLIP / effective ATA.
 */

export const SAP_ATA_UI_KEYS = [
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

export type SapAtaUiKey = (typeof SAP_ATA_UI_KEYS)[number];

/** SAP shipment JSON keys (and aliases) per UI field. */
const SAP_SHIPMENT_FIELD_CANDIDATES: Record<SapAtaUiKey, string[]> = {
  ata_vessel_arrival_at_loading_port: ['ata_vessel_arrival_at_loading_port_1'],
  ata_vessel_berthed_at_loading_port: ['ata_vessel_berthed_at_loading_port_1'],
  ata_vessel_start_loading: ['ata_vessel_start_loading'],
  ata_vessel_completed_loading: ['ata_vessel_completed_loading'],
  ata_vessel_sailed_from_loading_port: ['ata_vessel_sailed_from_loading_port'],
  ata_vessel_arrive_at_discharge_port: ['ata_vessel_arrival_at_discharge_port'],
  ata_vessel_berthed_at_discharge_port: ['ata_vessel_berthed_at_discharge_port'],
  ata_vessel_start_discharging: [
    'ata_discharging_start_at_discharge_port',
    'ata_vessel_start_discharging',
  ],
  ata_vessel_complete_discharge: [
    'ata_discharging_completed_at_discharge_port',
    'ata_vessel_completed_discharge',
  ],
};

export function normalizeSapAtaDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'number') {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const d = new Date(excelEpoch + value * 86400000);
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
        return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    if (iso) return iso[1];
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

export type SapAtaReferenceMap = Record<SapAtaUiKey, string | null>;

/** Extract SAP ATA reference map from processed shipment JSON (null when absent). */
export function extractSapAtaReferenceMap(
  sapShipment: Record<string, unknown> | null | undefined,
): SapAtaReferenceMap {
  const shp = sapShipment ?? {};
  const out = {} as SapAtaReferenceMap;
  for (const uiKey of SAP_ATA_UI_KEYS) {
    let found: string | null = null;
    for (const cand of SAP_SHIPMENT_FIELD_CANDIDATES[uiKey]) {
      if (!(cand in shp)) continue;
      found = normalizeSapAtaDate(shp[cand]);
      break;
    }
    out[uiKey] = found;
  }
  return out;
}

/**
 * Overwrite display sap_* on shipmentInfo + port rows from live SAP.
 * Explicit nulls clear stale VLP snapshot / migration backfill for the modal response.
 */
export function applyLiveSapAtaReferences(
  shipmentInfo: Record<string, unknown> | null,
  ports: Record<string, unknown>[],
  sapShipment: Record<string, unknown> | null | undefined,
): void {
  const refs = extractSapAtaReferenceMap(sapShipment);

  if (shipmentInfo) {
    for (const key of SAP_ATA_UI_KEYS) {
      shipmentInfo[`sap_${key}`] = refs[key];
    }
  }

  for (const port of ports) {
    const isDischarge = Boolean(port.is_discharge_port);
    if (isDischarge) {
      port.sap_ata_vessel_arrival = refs.ata_vessel_arrive_at_discharge_port;
      port.sap_ata_vessel_berthed = refs.ata_vessel_berthed_at_discharge_port;
      port.sap_ata_loading_start = refs.ata_vessel_start_discharging;
      port.sap_ata_loading_completed = refs.ata_vessel_complete_discharge;
      port.sap_ata_vessel_sailed = refs.ata_vessel_complete_discharge;
      continue;
    }
    const seq = Number(port.port_sequence);
    if (seq === 1) {
      port.sap_ata_vessel_arrival = refs.ata_vessel_arrival_at_loading_port;
      port.sap_ata_vessel_berthed = refs.ata_vessel_berthed_at_loading_port;
      port.sap_ata_loading_start = refs.ata_vessel_start_loading;
      port.sap_ata_loading_completed = refs.ata_vessel_completed_loading;
      port.sap_ata_vessel_sailed = refs.ata_vessel_sailed_from_loading_port;
    }
  }
}
