export type ShipmentAutoStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'LOADING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'UNLOADING'
  | 'COMPLETED';

type Milestones = {
  ata_arrival_at_loading_port?: unknown;
  ata_berthed_at_loading_port?: unknown;
  ata_start_loading?: unknown;
  ata_completed_loading?: unknown;
  ata_sailed_from_loading_port?: unknown;
  ata_arrive_at_discharge_port?: unknown;
  ata_berthed_at_discharge_port?: unknown;
  ata_start_discharging?: unknown;
  ata_complete_discharge?: unknown;
};

type EtaMilestones = {
  eta_arrival_at_loading_port?: unknown;
  eta_berthed_at_loading_port?: unknown;
  eta_start_loading?: unknown;
  eta_completed_loading?: unknown;
  eta_sailed_from_loading_port?: unknown;
  eta_arrive_at_discharge_port?: unknown;
  eta_berthed_at_discharge_port?: unknown;
  eta_start_discharging?: unknown;
  eta_complete_discharge?: unknown;
};

const hasDate = (v: unknown): boolean => {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
};

/**
 * Derive SEA shipment status from ATA milestone dates using management rules.
 * The checks are strict (each status requires all prior milestones listed).
 */
export function deriveShipmentStatusFromAta(m: Milestones): ShipmentAutoStatus {
  const a = hasDate(m.ata_arrival_at_loading_port);
  const b = hasDate(m.ata_berthed_at_loading_port);
  const c = hasDate(m.ata_start_loading);
  const d = hasDate(m.ata_completed_loading);
  const e = hasDate(m.ata_sailed_from_loading_port);
  const f = hasDate(m.ata_arrive_at_discharge_port);
  const g = hasDate(m.ata_berthed_at_discharge_port);
  const h = hasDate(m.ata_start_discharging);
  const i = hasDate(m.ata_complete_discharge);

  // Completed
  if (a && b && c && d && e && f && g && h && i) return 'COMPLETED';
  // Unloading
  if (a && b && c && d && e && f && g) return 'UNLOADING';
  // Arrived
  if (a && b && c && d && e && f) return 'ARRIVED';
  // In Transit
  if (a && b && c && d && e) return 'IN_TRANSIT';
  // Loading
  if (a && c) return 'LOADING';
  // In Progress
  if (a) return 'IN_PROGRESS';

  // Planned (no ATA activity)
  return 'PLANNED';
}

/**
 * Derive SEA shipment status from ETA milestone dates using management rules.
 * Strict ladder based on the requested ETA fields presence.
 */
export function deriveShipmentStatusFromEta(m: EtaMilestones): ShipmentAutoStatus {
  const a = hasDate(m.eta_arrival_at_loading_port);
  const b = hasDate(m.eta_berthed_at_loading_port);
  const c = hasDate(m.eta_start_loading);
  const d = hasDate(m.eta_completed_loading);
  const e = hasDate(m.eta_sailed_from_loading_port);
  const f = hasDate(m.eta_arrive_at_discharge_port);
  const g = hasDate(m.eta_berthed_at_discharge_port);
  const h = hasDate(m.eta_start_discharging);
  const i = hasDate(m.eta_complete_discharge);

  // Planned: none of the ETA ladder dates exists
  if (!(a || b || c || d || e || f || g || h || i)) return 'PLANNED';

  // Unloading: up to discharge berthed
  if (a && b && c && d && e && f && g) return 'UNLOADING';
  // Arrived: up to arrive discharge port
  if (a && b && c && d && e && f) return 'ARRIVED';
  // In transit: sailed from loading port (and all prior)
  if (a && b && c && d && e) return 'IN_TRANSIT';
  // Loading: arrival at loading port + start loading
  if (a && c) return 'LOADING';
  // In progress: arrival at loading port
  if (a) return 'IN_PROGRESS';

  // Default back to planned if data is inconsistent (missing prerequisites)
  return 'PLANNED';
}

