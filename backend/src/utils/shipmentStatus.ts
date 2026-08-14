import { isContractDeliveryClosed } from './contractDeliveryStatus';

/** Shipment execution status derived from ATA ladder (Shipments module). */
export type ShipmentAutoStatus =
  | 'UNPLANNED'
  | 'PLANNED'
  | 'ARRIVED_LP'
  | 'BERTHED_LP'
  | 'LOADING'
  | 'COMPLETED_LOADING'
  | 'SAILED'
  | 'ARRIVED_DP'
  | 'BERTHED_DP'
  | 'UNLOADING'
  | 'COMPLETED'
  | 'CANCELLED';

export const SHIPMENT_AUTO_STATUSES: readonly ShipmentAutoStatus[] = [
  'UNPLANNED',
  'PLANNED',
  'ARRIVED_LP',
  'BERTHED_LP',
  'LOADING',
  'COMPLETED_LOADING',
  'SAILED',
  'ARRIVED_DP',
  'BERTHED_DP',
  'UNLOADING',
  'COMPLETED',
  'CANCELLED',
] as const;

/** @deprecated Pre-granular keys — normalized to ShipmentAutoStatus at read/filter time. */
export const LEGACY_SHIPMENT_STATUS_ALIASES: Readonly<Record<string, ShipmentAutoStatus>> = {
  IN_PROGRESS: 'ARRIVED_LP',
  IN_TRANSIT: 'SAILED',
  ARRIVED: 'ARRIVED_DP',
};

export const SHIPMENT_AT_LOADING_PORT_STATUSES: readonly ShipmentAutoStatus[] = [
  'ARRIVED_LP',
  'BERTHED_LP',
  'LOADING',
  'COMPLETED_LOADING',
];

export const SHIPMENT_SAILED_STATUSES: readonly ShipmentAutoStatus[] = ['SAILED'];

export const SHIPMENT_AT_DISCHARGE_PORT_STATUSES: readonly ShipmentAutoStatus[] = [
  'ARRIVED_DP',
  'BERTHED_DP',
  'UNLOADING',
];

export const SHIPMENT_LOADING_ETA_PHASE_STATUSES: readonly ShipmentAutoStatus[] = [
  'UNPLANNED',
  'PLANNED',
  ...SHIPMENT_AT_LOADING_PORT_STATUSES,
];

export const SHIPMENT_DISCHARGE_ETA_PHASE_STATUSES: readonly ShipmentAutoStatus[] = [
  ...SHIPMENT_SAILED_STATUSES,
  ...SHIPMENT_AT_DISCHARGE_PORT_STATUSES,
];

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
  /** SAP import status or contracts.status — Close/Completed without ATA still resolves COMPLETED. */
  contract_import_status?: unknown;
  /** Delivery qty signals (kg) — any > 0 keeps open STO in PLANNED when ATA are all null. */
  quantity_delivered?: unknown;
  quantity_delivered_klip?: unknown;
  quantity_delivered_sap?: unknown;
};

const hasDate = (v: unknown): boolean => {
  if (v == null) return false;

  if (v instanceof Date) {
    return !Number.isNaN(v.getTime());
  }

  const s = String(v).trim();
  if (!s) return false;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const yyyy = Number(ymd[1]);
    const mm = Number(ymd[2]);
    const dd = Number(ymd[3]);
    const d = new Date(yyyy, mm - 1, dd);
    return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
  }

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

export function hasAnyAtaMilestone(m: Pick<ShipmentMilestones, keyof ShipmentMilestones>): boolean {
  return (
    hasDate(m.ata_arrival_at_loading_port) ||
    hasDate(m.ata_berthed_at_loading_port) ||
    hasDate(m.ata_start_loading) ||
    hasDate(m.ata_completed_loading) ||
    hasDate(m.ata_sailed_from_loading_port) ||
    hasDate(m.ata_arrive_at_discharge_port) ||
    hasDate(m.ata_berthed_at_discharge_port) ||
    hasDate(m.ata_start_discharging) ||
    hasDate(m.ata_complete_discharge)
  );
}

function positiveQtyKg(v: unknown): boolean {
  if (v == null || v === '') return false;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0;
}

/** True when any Delivery Qty source (KLIP / SAP / legacy) has a positive value. */
export function hasDeliveryQtySignal(m: Pick<ShipmentMilestones, keyof ShipmentMilestones>): boolean {
  return (
    positiveQtyKg(m.quantity_delivered_klip) ||
    positiveQtyKg(m.quantity_delivered_sap) ||
    positiveQtyKg(m.quantity_delivered)
  );
}

export function normalizeShipmentDetailStatus(raw: string | null | undefined): ShipmentAutoStatus {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!normalized) return 'UNPLANNED';
  if (normalized === 'CANCELLED') return 'CANCELLED';
  const legacy = LEGACY_SHIPMENT_STATUS_ALIASES[normalized];
  if (legacy) return legacy;
  if ((SHIPMENT_AUTO_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as ShipmentAutoStatus;
  }
  return 'UNPLANNED';
}

/**
 * Derive SEA shipment status from milestones (latest ATA stage wins).
 * Maps 1:1 with summary breakdown tiers on the Shipments page.
 * Completed is GR Close only. ATA complete discharge with GR still Open is UNLOADING.
 * Open STO without ATA ladder is PLANNED (Unplanned card = PO backlog only).
 * Delivery Qty / ETA with no ATA also resolve to PLANNED.
 */
export function deriveShipmentStatus(m: ShipmentMilestones): ShipmentAutoStatus {
  if (isContractDeliveryClosed(m.contract_import_status)) return 'COMPLETED';
  if (hasDate(m.ata_complete_discharge)) return 'UNLOADING';
  if (hasDate(m.ata_start_discharging)) return 'UNLOADING';
  if (hasDate(m.ata_berthed_at_discharge_port)) return 'BERTHED_DP';
  if (hasDate(m.ata_arrive_at_discharge_port)) return 'ARRIVED_DP';
  if (hasDate(m.ata_sailed_from_loading_port)) return 'SAILED';
  if (hasDate(m.ata_completed_loading)) return 'COMPLETED_LOADING';
  if (hasDate(m.ata_start_loading)) return 'LOADING';
  if (hasDate(m.ata_berthed_at_loading_port)) return 'BERTHED_LP';
  if (hasDate(m.ata_arrival_at_loading_port)) return 'ARRIVED_LP';
  if (hasAnyEtaMilestone(m)) return 'PLANNED';
  if (!hasAnyAtaMilestone(m) && hasDeliveryQtySignal(m)) return 'PLANNED';
  return 'PLANNED';
}

/** Monotonic rank for SAP upsert — higher = further along execution ladder. */
export const SHIPMENT_STATUS_RANK: Readonly<Record<string, number>> = {
  /** Same rank as PLANNED — Unplanned card is PO-only; STO UNPLANNED is legacy alias. */
  UNPLANNED: 1,
  PLANNED: 1,
  IN_PROGRESS: 2,
  ARRIVED_LP: 2,
  BERTHED_LP: 3,
  LOADING: 4,
  COMPLETED_LOADING: 5,
  IN_TRANSIT: 6,
  SAILED: 6,
  ARRIVED: 7,
  ARRIVED_DP: 7,
  BERTHED_DP: 8,
  UNLOADING: 9,
  COMPLETED: 10,
  CANCELLED: -1,
  CANCELED: -1,
};

/** SQL CASE ranking a shipments.status column/expression for monotonic SAP merge. */
export function sqlShipmentStatusRank(expr = 'status'): string {
  return `
CASE UPPER(TRIM(COALESCE(${expr}, '')))
  WHEN 'UNPLANNED' THEN 1
  WHEN 'PLANNED' THEN 1
  WHEN 'IN_PROGRESS' THEN 2
  WHEN 'ARRIVED_LP' THEN 2
  WHEN 'BERTHED_LP' THEN 3
  WHEN 'LOADING' THEN 4
  WHEN 'COMPLETED_LOADING' THEN 5
  WHEN 'IN_TRANSIT' THEN 6
  WHEN 'SAILED' THEN 6
  WHEN 'ARRIVED' THEN 7
  WHEN 'ARRIVED_DP' THEN 7
  WHEN 'BERTHED_DP' THEN 8
  WHEN 'UNLOADING' THEN 9
  WHEN 'COMPLETED' THEN 10
  ELSE 1
END`;
}

/** @deprecated Use sqlShipmentStatusRank('status') */
export const SQL_SHIPMENT_STATUS_RANK = sqlShipmentStatusRank('status');

/** Statuses auto-persisted on milestone update (excludes manual CANCELLED). */
export const SHIPMENT_PERSISTABLE_AUTO_STATUSES: readonly ShipmentAutoStatus[] =
  SHIPMENT_AUTO_STATUSES.filter((s) => s !== 'CANCELLED');

/** @deprecated Use deriveShipmentStatus — ATA stages only (no ETA → PLANNED). */
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

/** @deprecated Use deriveShipmentStatus — ETA-only / open STO rows resolve to PLANNED. */
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
