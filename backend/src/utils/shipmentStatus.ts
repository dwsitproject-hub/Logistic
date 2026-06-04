export type ShipmentAutoStatus =
  | 'UNPLANNED'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'LOADING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'UNLOADING'
  | 'COMPLETED';

export type ShipmentMilestones = {
  eta_arrival_at_loading_port?: unknown;
  eta_berthed_at_loading_port?: unknown;
  eta_start_loading?: unknown;
  eta_completed_loading?: unknown;
  eta_sailed_from_loading_port?: unknown;
  eta_arrive_at_discharge_port?: unknown;
  eta_berthed_at_discharge_port?: unknown;
  eta_start_discharging?: unknown;
  eta_complete_discharge?: unknown;
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

const hasDate = (v: unknown): boolean => {
  if (v == null) return false;

  if (v instanceof Date) {
    return !Number.isNaN(v.getTime());
  }

  const s = String(v).trim();
  if (!s) return false;

  // ISO / date-only inputs commonly returned by Postgres.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const yyyy = Number(ymd[1]);
    const mm = Number(ymd[2]);
    const dd = Number(ymd[3]);
    const d = new Date(yyyy, mm - 1, dd);
    return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
  }

  // Day-first display strings from UI/API payloads (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY).
  const dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    const d = new Date(yyyy, mm - 1, dd);
    return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
  }

  const t = Date.parse(s);
  return !Number.isNaN(t);
};

export function hasAnyEtaMilestone(m: Pick<ShipmentMilestones, keyof ShipmentMilestones>): boolean {
  return (
    hasDate(m.eta_arrival_at_loading_port) ||
    hasDate(m.eta_berthed_at_loading_port) ||
    hasDate(m.eta_start_loading) ||
    hasDate(m.eta_completed_loading) ||
    hasDate(m.eta_sailed_from_loading_port) ||
    hasDate(m.eta_arrive_at_discharge_port) ||
    hasDate(m.eta_berthed_at_discharge_port) ||
    hasDate(m.eta_start_discharging) ||
    hasDate(m.eta_complete_discharge)
  );
}

/**
 * Derive SEA shipment status:
 * - PLANNED / UNPLANNED from ETA
 * - IN_PROGRESS … COMPLETED from ATA milestones (latest ATA stage wins)
 */
export function deriveShipmentStatus(m: ShipmentMilestones): ShipmentAutoStatus {
  if (hasDate(m.ata_complete_discharge)) return 'COMPLETED';
  if (hasDate(m.ata_start_discharging)) return 'UNLOADING';
  if (hasDate(m.ata_arrive_at_discharge_port)) return 'ARRIVED';
  if (hasDate(m.ata_sailed_from_loading_port)) return 'IN_TRANSIT';
  if (hasDate(m.ata_start_loading)) return 'LOADING';
  if (hasDate(m.ata_arrival_at_loading_port)) return 'IN_PROGRESS';
  if (hasAnyEtaMilestone(m)) return 'PLANNED';
  return 'UNPLANNED';
}

/** @deprecated Use deriveShipmentStatus — ATA stages only (no ETA → UNPLANNED). */
export function deriveShipmentStatusFromAta(
  m: Pick<
    ShipmentMilestones,
    | 'ata_arrival_at_loading_port'
    | 'ata_berthed_at_loading_port'
    | 'ata_start_loading'
    | 'ata_completed_loading'
    | 'ata_sailed_from_loading_port'
    | 'ata_arrive_at_discharge_port'
    | 'ata_berthed_at_discharge_port'
    | 'ata_start_discharging'
    | 'ata_complete_discharge'
  >,
): ShipmentAutoStatus {
  return deriveShipmentStatus(m);
}

/** @deprecated Use deriveShipmentStatus — ETA-only rows resolve to PLANNED / UNPLANNED. */
export function deriveShipmentStatusFromEta(
  m: Pick<
    ShipmentMilestones,
    | 'eta_arrival_at_loading_port'
    | 'eta_berthed_at_loading_port'
    | 'eta_start_loading'
    | 'eta_completed_loading'
    | 'eta_sailed_from_loading_port'
    | 'eta_arrive_at_discharge_port'
    | 'eta_berthed_at_discharge_port'
    | 'eta_start_discharging'
    | 'eta_complete_discharge'
  >,
): ShipmentAutoStatus {
  return deriveShipmentStatus(m);
}
