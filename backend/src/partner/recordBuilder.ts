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
