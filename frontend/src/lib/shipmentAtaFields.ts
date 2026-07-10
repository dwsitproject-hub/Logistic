export const SHIPMENT_ATA_API_FIELDS = [
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

export type ShipmentAtaApiField = (typeof SHIPMENT_ATA_API_FIELDS)[number];

export type ShipmentAtaFields = Record<ShipmentAtaApiField, string>;

export function emptyAtaFields(): ShipmentAtaFields {
  return {
    ata_vessel_arrival_at_loading_port: '',
    ata_vessel_berthed_at_loading_port: '',
    ata_vessel_start_loading: '',
    ata_vessel_completed_loading: '',
    ata_vessel_sailed_from_loading_port: '',
    ata_vessel_arrive_at_discharge_port: '',
    ata_vessel_berthed_at_discharge_port: '',
    ata_vessel_start_discharging: '',
    ata_vessel_complete_discharge: '',
  };
}

function sliceIsoDate(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value).slice(0, 10);
}

export function ataFieldsFromShipmentInfo(info: Record<string, unknown>): ShipmentAtaFields {
  const out = emptyAtaFields();
  for (const key of SHIPMENT_ATA_API_FIELDS) {
    out[key] = sliceIsoDate(info[key]);
  }
  return out;
}

export function ataSapReferenceFromShipmentInfo(info: Record<string, unknown>): ShipmentAtaFields {
  const out = emptyAtaFields();
  for (const key of SHIPMENT_ATA_API_FIELDS) {
    const sapKey = `sap_${key}`;
    out[key] = sliceIsoDate(info[sapKey]);
  }
  return out;
}

export function buildAtaOverridePayload(
  current: ShipmentAtaFields,
  baseline: ShipmentAtaFields,
): Partial<Record<ShipmentAtaApiField, string | null>> | null {
  const payload: Partial<Record<ShipmentAtaApiField, string | null>> = {};
  let changed = false;
  for (const key of SHIPMENT_ATA_API_FIELDS) {
    const cur = current[key]?.trim() ?? '';
    const base = baseline[key]?.trim() ?? '';
    if (cur !== base) {
      changed = true;
      payload[key] = cur || null;
    }
  }
  return changed ? payload : null;
}
