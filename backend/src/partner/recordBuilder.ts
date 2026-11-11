import crypto from 'crypto';
import {
  STAGE_LABELS,
  isActiveStage,
  mapCharterType,
  normalizeStage,
  numberOrNull,
  stableStringify,
  toContractQuantity,
  wibIso,
} from './format';

/**
 * Turns the rows of partner/recordSql.ts into the record KMAPS reads (contract 5.2). Pure: no database, so every rule here has a unit test.
 */

export interface GroupRow {
  sto_key: string;
  primary_id: string;
  member_ids: string[];
  master_vessel_id: string | null;
  stage: string | null;
  [column: string]: unknown;
}

export interface PrimaryRow {
  primary_id: string;
  shipment_no: string | null;
  voyage_no: string | null;
  charter_type: string | null;
  shipment_vessel_name: string | null;
  shipment_vessel_code: string | null;
  mv_id: string | null;
  mv_name: string | null;
  vessel_dhm_code: string | null;
  mv_role: string | null;
  mv_vessel_code: string | null;
  mv_alias_codes: string[] | null;
  loading_port_name: string | null;
  loading_port_code: string | null;
  discharge_port_name: string | null;
  discharge_port_code: string | null;
}

export interface LegRow {
  primary_id: string;
  port_sequence: number | null;
  is_discharge: boolean;
  port_name: string | null;
  master_port_name: string | null;
  port_code: string | null;
  eta_local: string | null;
  ata_local: string | null;
}

export interface LineRow {
  sto_key: string;
  shipment_uuid: string;
  contract_uuid: string;
  contract_no: string | null;
  po_number: string | null;
  product: string | null;
  supplier: string | null;
  transport_mode: string | null;
  contract_sto_number: string | null;
  plant_code: string | null;
  unit: string | null;
  quantity_ordered: string | number | null;
  sto_quantity: string | number | null;
  quantity_delivered: string | number | null;
  unit_price: string | number | null;
  currency: string | null;
  contract_value: string | number | null;
  product_code: string | null;
  product_name: string | null;
  plant_dhm_code: string | null;
  plant_name: string | null;
}

export interface PairRow {
  pair_code: string;
  last_contract_date: string | null;
  bg_id: string;
  bg_name: string | null;
  bg_code: string | null;
  tb_id: string;
  tb_name: string | null;
  tb_code: string | null;
}

export interface BuiltRecord {
  stoKey: string;
  memberIds: string[];
  vesselDhmCode: string | null;
  vesselSapCodes: string[];
  status: string;
  active: boolean;
  payload: Record<string, unknown>;
  contentHash: string;
}

const clean = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
};

const portOf = (code: string | null, name: string | null) => (code || name ? { dhmCode: code, name } : null);

function eta(group: GroupRow, key: string): string | null {
  return clean(group[key]);
}

function milestone(group: GroupRow, etaKey: string, ataKey: string) {
  return { eta: eta(group, etaKey), ata: eta(group, ataKey) };
}

/** The pair a vessel belongs to, as `{ code, name, role }` of the OTHER vessel. The pair with the latest contract date wins, then the highest pair code. */
export function pairOf(masterVesselId: string | null, pairs: PairRow[]): { pairCode: string; other: { code: string | null; name: string | null; role: 'BARGE' | 'TUG' } } | null {
  if (!masterVesselId) return null;
  const mine = pairs
    .filter((p) => p.bg_id === masterVesselId || p.tb_id === masterVesselId)
    .sort((a, b) => {
      const da = a.last_contract_date ?? '';
      const db = b.last_contract_date ?? '';
      if (da !== db) return da < db ? 1 : -1;
      return a.pair_code < b.pair_code ? 1 : a.pair_code > b.pair_code ? -1 : 0;
    })[0];
  if (!mine) return null;
  return mine.bg_id === masterVesselId
    ? { pairCode: mine.pair_code, other: { code: mine.tb_code, name: mine.tb_name, role: 'TUG' } }
    : { pairCode: mine.pair_code, other: { code: mine.bg_code, name: mine.bg_name, role: 'BARGE' } };
}

/** Every ETA and ATA the groups query reads (partner/recordSql.ts). One of them filled is a date somebody put on the voyage. */
const SCHEDULE_COLUMNS = [
  'eta_loading_arrival',
  'eta_loading_berthed',
  'eta_loading_start',
  'eta_loading_end',
  'eta_sailed',
  'eta_discharge_arrival',
  'eta_discharge_berthed',
  'eta_discharge_start',
  'eta_discharge_end',
  'ata_loading_arrival',
  'ata_loading_berthed',
  'ata_loading_start',
  'ata_loading_end',
  'ata_sailed',
  'ata_discharge_arrival',
  'ata_discharge_berthed',
  'ata_discharge_start',
  'ata_discharge_end',
] as const;

export type PartnerIneligibleReason = 'no_vessel' | 'no_schedule' | 'no_vessel_no_schedule';

/**
 * Why a shipment is NOT sent to KMAPS, or null when it is.
 *
 * A row with an STO is "Planned" on the Shipments page by rule, so an SAP-imported shell with nothing on it (2,445 on production on 2026-10-14) reads Planned
 * and active. KMAPS draws vessels on a map: such a row has no ports, no leg, no date and nothing delivered, so it gives the map nothing to show and hides the shipments
 * that are real. Decision of Ryan, 2026-11-11: send a shipment only when it has BOTH
 *
 *   a vessel    a name or a code, KLIP's or SAP's. A vessel with no DHM code is still sent (KMAPS lists it as unmapped, contract 4.2); no vessel at all is not.
 *   a schedule  at least one of: an ETA or ATA (shipment level or per port), a loading or discharge port, a planned leg, a delivered quantity.
 *
 * Trucking (LAND) and FOB Type T legs without a vessel never reach this point: the groups query reads the Shipments page's own sea scope.
 * A group whose primary shipment the query did not return is not judged (null): retiring a real shipment on a missing read would be worse than sending an odd one.
 */
export function partnerIneligibleReason(input: {
  group: GroupRow;
  primary: PrimaryRow | undefined;
  legs: LegRow[];
  lines: LineRow[];
}): PartnerIneligibleReason | null {
  const { group, primary, legs, lines } = input;
  if (!primary) return null;

  const hasVessel = [primary.mv_name, primary.shipment_vessel_name, primary.shipment_vessel_code, primary.mv_vessel_code, primary.vessel_dhm_code, primary.mv_id].some(
    (v) => clean(v) !== null,
  );
  const hasPort = [primary.loading_port_code, primary.loading_port_name, primary.discharge_port_code, primary.discharge_port_name].some((v) => clean(v) !== null);
  const hasDelivered = lines.some((l) => (numberOrNull(l.quantity_delivered) ?? 0) > 0);
  const hasSchedule = SCHEDULE_COLUMNS.some((k) => clean(group[k]) !== null) || legs.length > 0 || hasPort || hasDelivered;

  if (hasVessel && hasSchedule) return null;
  if (!hasVessel && !hasSchedule) return 'no_vessel_no_schedule';
  return hasVessel ? 'no_schedule' : 'no_vessel';
}

/**
 * Splits the groups into those that are sent and those that are not. `ineligibleMemberIds` lets the refresh tell a record that was SENT and is now out
 * (a tombstone: it was never a real shipment, so it must not read Cancelled) from one whose shipments left the page scope (SAP withdrew the PO).
 */
export function partitionPartnerGroups(input: {
  groups: GroupRow[];
  primaryById: Map<string, PrimaryRow>;
  legsById: Map<string, LegRow[]>;
  linesByKey: Map<string, LineRow[]>;
}): { eligible: GroupRow[]; ineligibleMemberIds: Set<string>; ineligibleByReason: Record<PartnerIneligibleReason, number> } {
  const eligible: GroupRow[] = [];
  const ineligibleMemberIds = new Set<string>();
  const ineligibleByReason: Record<PartnerIneligibleReason, number> = { no_vessel: 0, no_schedule: 0, no_vessel_no_schedule: 0 };
  for (const group of input.groups) {
    const reason = partnerIneligibleReason({
      group,
      primary: input.primaryById.get(group.primary_id),
      legs: input.legsById.get(group.primary_id) ?? [],
      lines: input.linesByKey.get(group.sto_key) ?? [],
    });
    if (reason === null) {
      eligible.push(group);
      continue;
    }
    ineligibleByReason[reason] += 1;
    for (const id of group.member_ids) ineligibleMemberIds.add(id);
  }
  return { eligible, ineligibleMemberIds, ineligibleByReason };
}

export function buildPartnerRecord(input: {
  group: GroupRow;
  primary: PrimaryRow | undefined;
  legs: LegRow[];
  lines: LineRow[];
  pairs: PairRow[];
}): BuiltRecord {
  const { group, primary, legs, lines, pairs } = input;
  const stage = normalizeStage(group.stage) || 'PLANNED';
  const active = isActiveStage(stage);

  const sapCode = clean(primary?.shipment_vessel_code) ?? clean(primary?.mv_vessel_code);
  const sapCodes = [
    ...new Set(
      [primary?.shipment_vessel_code, primary?.mv_vessel_code, ...(primary?.mv_alias_codes ?? [])]
        .map((c) => clean(c)?.toUpperCase() ?? null)
        .filter((c): c is string => c !== null),
    ),
  ].sort();

  const role = primary?.mv_role === 'BG' ? 'BARGE' : primary?.mv_role === 'TB' ? 'TUG' : null;
  const pair = pairOf(primary?.mv_id ?? null, pairs);

  const loadingLegs = legs.filter((l) => !l.is_discharge).sort((a, b) => (a.port_sequence ?? 0) - (b.port_sequence ?? 0));
  const dischargeLegs = legs.filter((l) => l.is_discharge).sort((a, b) => (a.port_sequence ?? 0) - (b.port_sequence ?? 0));
  const legOut = [...loadingLegs, ...dischargeLegs].map((l, i) => ({
    role: l.is_discharge ? 'discharge' : 'loading',
    sequence: i + 1,
    port: portOf(clean(l.port_code), clean(l.master_port_name) ?? clean(l.port_name)),
    eta: wibIso(l.eta_local),
    ata: wibIso(l.ata_local),
  }));

  // One line per contract: several member shipments of one contract are one PO line.
  const byContract = new Map<string, LineRow[]>();
  for (const row of lines) byContract.set(row.contract_uuid, [...(byContract.get(row.contract_uuid) ?? []), row]);
  const lineOut = [...byContract.values()].map((rows) => {
    const first = rows[0];
    const stoQty = rows.map((r) => numberOrNull(r.sto_quantity)).find((n) => n !== null && n > 0) ?? null;
    const { quantity, unit } = toContractQuantity(stoQty ?? first.quantity_ordered, first.unit);
    const deliveredRaw = rows.reduce((sum, r) => sum + (numberOrNull(r.quantity_delivered) ?? 0), 0);
    const delivered = deliveredRaw > 0 ? toContractQuantity(deliveredRaw, first.unit).quantity : null;
    return {
      contractNo: clean(first.contract_no),
      poNumber: clean(first.po_number),
      product: { dhmCode: clean(first.product_code), name: clean(first.product_name) ?? clean(first.product) },
      supplier: clean(first.supplier),
      quantity,
      unit,
      quantityShipped: null,
      quantityDelivered: delivered,
      commercial: {
        unitPrice: numberOrNull(first.unit_price),
        currency: clean(first.currency),
        contractValue: numberOrNull(first.contract_value),
      },
    };
  });

  const stoKey = String(group.sto_key);
  const stoNumber = /^\d+$/.test(stoKey) ? stoKey : (lines.map((l) => clean(l.contract_sto_number)).find((n) => n !== null) ?? null);
  const mode = lines.map((l) => clean(l.transport_mode)).find((m) => m === 'SEA' || m === 'MIX') ?? 'SEA';
  const plantRow = lines.find((l) => clean(l.plant_dhm_code) || clean(l.plant_name));

  const payload: Record<string, unknown> = {
    shipmentNo: clean(primary?.shipment_no) ?? stoKey,
    stoNumber,
    status: stage,
    statusLabel: STAGE_LABELS[stage] ?? null,
    voyageNo: clean(primary?.voyage_no),
    transportMode: mode,
    vessel: {
      code: clean(primary?.vessel_dhm_code),
      sapCode,
      name: clean(primary?.mv_name) ?? clean(primary?.shipment_vessel_name),
      role,
      pair: pair ? { code: pair.other.code, name: pair.other.name, role: pair.other.role } : null,
      charterType: mapCharterType(primary?.charter_type),
    },
    loadingPort: portOf(clean(primary?.loading_port_code), clean(primary?.loading_port_name)),
    dischargePort: portOf(clean(primary?.discharge_port_code), clean(primary?.discharge_port_name)),
    plant: plantRow ? portOf(clean(plantRow.plant_dhm_code), clean(plantRow.plant_name)) : null,
    legs: legOut,
    schedule: {
      loading: {
        arrival: milestone(group, 'eta_loading_arrival', 'ata_loading_arrival'),
        berthed: milestone(group, 'eta_loading_berthed', 'ata_loading_berthed'),
        operationStart: milestone(group, 'eta_loading_start', 'ata_loading_start'),
        operationEnd: milestone(group, 'eta_loading_end', 'ata_loading_end'),
        sailed: milestone(group, 'eta_sailed', 'ata_sailed'),
      },
      discharge: {
        arrival: milestone(group, 'eta_discharge_arrival', 'ata_discharge_arrival'),
        berthed: milestone(group, 'eta_discharge_berthed', 'ata_discharge_berthed'),
        operationStart: milestone(group, 'eta_discharge_start', 'ata_discharge_start'),
        operationEnd: milestone(group, 'eta_discharge_end', 'ata_discharge_end'),
      },
    },
    lines: lineOut,
  };

  return {
    stoKey,
    memberIds: group.member_ids,
    vesselDhmCode: clean(primary?.vessel_dhm_code),
    vesselSapCodes: sapCodes,
    status: stage,
    active,
    payload,
    contentHash: contentHashOf(payload, active),
  };
}

/** Hash of everything the record exposes, plus the flags KMAPS acts on. Equal hash = nothing KMAPS can see has changed. */
export function contentHashOf(payload: Record<string, unknown>, active: boolean): string {
  return crypto.createHash('sha256').update(stableStringify({ payload, active })).digest('hex');
}
