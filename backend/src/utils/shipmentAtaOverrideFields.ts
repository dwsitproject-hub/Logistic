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

export const SHIPMENT_ATA_API_TO_DB: Record<ShipmentAtaApiField, string> = {
  ata_vessel_arrival_at_loading_port: 'ata_arrival',
  ata_vessel_berthed_at_loading_port: 'ata_berthed',
  ata_vessel_start_loading: 'ata_loading_start',
  ata_vessel_completed_loading: 'ata_loading_complete',
  ata_vessel_sailed_from_loading_port: 'ata_sailed',
  ata_vessel_arrive_at_discharge_port: 'ata_discharge_arrival',
  ata_vessel_berthed_at_discharge_port: 'ata_discharge_berthed',
  ata_vessel_start_discharging: 'ata_discharge_start',
  ata_vessel_complete_discharge: 'ata_discharge_complete',
};

export const SHIPMENT_ATA_DB_COLUMNS = Object.values(SHIPMENT_ATA_API_TO_DB);

export type ShipmentAtaOverridePayload = Partial<Record<ShipmentAtaApiField, string | null>>;
